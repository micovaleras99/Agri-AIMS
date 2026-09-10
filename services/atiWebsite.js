/**
 * RSC-03 — reading new posts from the ATI Bicol website.
 *
 * WHY THIS SCRAPES, having checked the alternatives first
 * ------------------------------------------------------
 * https://ati2.da.gov.ph/ati-5/content/ was inspected on 2026-08-21:
 *
 *   /robots.txt                      404  — no crawl directives published
 *   /rss.xml, /ati-5/rss.xml         404  — no RSS
 *   /sitemap.xml                     404  — no sitemap
 *   /jsonapi                         404  — Drupal JSON:API not enabled
 *   /ati-5/content/?_format=json     406  — REST module present, format not enabled
 *   <link rel="alternate">           none — no feed advertised in the markup
 *
 * The site is Drupal 9 / Varbase and renders its article list server-side, so
 * the listing is readable without a browser. There is no feed to prefer, which
 * is the only reason this parses HTML.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO
 * ----------------------------------
 * - One request per run, for the listing page only. Article pages are never
 *   fetched; 50 extra requests to decorate a chat message is not a fair trade.
 * - No ETag or Last-Modified is offered by the server and it sends `no-cache`,
 *   so every run is a full download. Run this hourly at most — daily is kinder
 *   and still well ahead of anyone refreshing the page by hand.
 * - It identifies itself honestly in the User-Agent, with a contact address.
 *
 * KNOWN LIMITATIONS, to state plainly rather than paper over
 * ---------------------------------------------------------
 * - **The raw HTML exposes no usable dates** — no <time>, no og:published_time —
 *   so the direct reader below dates nothing and "new" means "a URL this system
 *   has not seen before". Firecrawl (used when FIRECRAWL_API_KEY is set) does
 *   surface the listing's per-article dates, so with a key the posts are dated;
 *   without one this limitation still applies.
 * - Scraping breaks when markup changes. This returns an empty list and an
 *   explanatory note rather than throwing, and the sync records the note, so a
 *   silent stop is visible instead of looking like "no new posts".
 * - Absence of robots.txt is not permission. ATI-RTC V should be asked; the
 *   team has the relationship, and a feed or a token is better than this.
 */

const logger = require('../utils/logger');

const BASE = process.env.ATI_SITE_URL || 'https://ati2.da.gov.ph';
const LISTING_PATH = process.env.ATI_LISTING_PATH || '/ati-5/content/';
const TIMEOUT_MS = Number(process.env.ATI_TIMEOUT_MS) || 20000;

/** Says who we are and how to reach us, as a well-behaved reader should. */
const USER_AGENT =
  process.env.ATI_USER_AGENT ||
  'agri-aims/1.0 (ATI-RTC V Learning Site monitor; +mailto:rtc5_dcc@ati.da.gov.ph)';

// Firecrawl renders the listing and, unlike the raw HTML, surfaces each article's
// publish date. Used as the primary reader when FIRECRAWL_API_KEY is set; the
// direct fetch below stays as the no-key, no-third-party fallback.
const FIRECRAWL_ENDPOINT = 'https://api.firecrawl.dev/v1/scrape';
const FIRECRAWL_TIMEOUT_MS = Number(process.env.FIRECRAWL_TIMEOUT_MS) || 45000;

/** Only real articles; the listing also links to section pages. */
const ARTICLE_RE = /^\/ati-5\/content\/article\/[^/]+\/[^/]+$/;

function decodeEntities(s) {
  return String(s)
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** A readable fallback when the title markup changes: the URL slug. */
function titleFromSlug(pathname) {
  const slug = pathname.split('/').pop() || '';
  return decodeEntities(slug.replace(/-/g, ' ')).replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Pull articles out of the listing HTML.
 *
 * The view renders each row as
 *   <span class="field-content owwl-title"><a href="PATH">TITLE</a></span>
 * The thumbnail's `alt` is a photo caption, not a title, so it is not used.
 *
 * @param {string} html
 * @returns {Array<{path: string, title: string}>}
 */
function parseListing(html) {
  const found = new Map();

  const titled = /<a[^>]+href="(\/ati-5\/content\/article\/[^"]+)"[^>]*>([^<]{3,300})<\/a>/g;
  let m;
  while ((m = titled.exec(html)) !== null) {
    const path = m[1].split('?')[0].split('#')[0];
    if (!ARTICLE_RE.test(path)) continue;
    const title = decodeEntities(m[2]);
    // Skip anchors whose text is an image or empty after decoding.
    if (!title || title.length < 3) continue;
    if (!found.has(path)) found.set(path, title);
  }

  // Any article linked only by its thumbnail still counts; name it from the slug
  // rather than the caption in `alt`.
  const anyLink = /href="(\/ati-5\/content\/article\/[^"]+)"/g;
  while ((m = anyLink.exec(html)) !== null) {
    const path = m[1].split('?')[0].split('#')[0];
    if (!ARTICLE_RE.test(path) || found.has(path)) continue;
    found.set(path, titleFromSlug(path));
  }

  return [...found].map(([path, title]) => ({ path, title }));
}

/**
 * Read the listing and return items in the shape elearningSync expects.
 * Never throws: a failure returns an empty list with a note explaining it.
 *
 * Firecrawl is preferred when FIRECRAWL_API_KEY is set — it renders the listing
 * and exposes the per-article publish dates the raw HTML does not, and is far
 * less brittle than regex over markup. On any Firecrawl failure (no key, an
 * outage, out of credits, an empty parse) it falls back to the direct
 * fetch-and-regex reader, so monitoring never stops.
 *
 * @returns {Promise<{items: object[], note: string}>}
 */
async function fetchAtiArticles() {
  if (process.env.FIRECRAWL_API_KEY) {
    const viaFirecrawl = await fetchViaFirecrawl();
    if (viaFirecrawl && viaFirecrawl.items.length) return viaFirecrawl;
    // else fall through to the raw reader
  }
  return fetchRawListing();
}

/**
 * Scrape the listing through Firecrawl and parse title, URL and publish date.
 * Returns null on any failure so the caller can fall back to the raw reader.
 *
 * @returns {Promise<{items: object[], note: string}|null>}
 */
async function fetchViaFirecrawl() {
  const url = BASE + LISTING_PATH;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FIRECRAWL_TIMEOUT_MS);
    const res = await fetch(FIRECRAWL_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.FIRECRAWL_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url, formats: ['markdown'], onlyMainContent: true }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.success || !json.data || !json.data.markdown) {
      logger.error(`Firecrawl ATI scrape failed (HTTP ${res.status}); falling back to direct read`);
      return null;
    }

    const items = parseFirecrawlListing(json.data.markdown);
    if (!items.length) {
      logger.error('Firecrawl ATI scrape returned no parseable articles; falling back to direct read');
      return null;
    }
    const dated = items.filter((i) => i.publishedAt).length;
    return { items, note: `Read ${items.length} article(s) from ${url} via Firecrawl (${dated} dated).` };
  } catch (err) {
    logger.error(`Firecrawl ATI scrape error: ${err.message}; falling back to direct read`);
    return null;
  }
}

/** Month abbreviations as they appear in the listing ("Sep 02, 2026"). */
const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
// A text title link to an article: [Title](…/article/…). The leading [^\]!]
// skips the thumbnail link that precedes it, whose text starts with "!".
const FC_LINK_RE = /\[([^\]!][^\]]*)\]\((https?:\/\/[^)]*\/ati-5\/content\/article\/[^)]+)\)/g;
const FC_DATE_RE = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+(\d{1,2}),\s+(20\d{2})\b/;

/**
 * Turn the Firecrawl markdown of the listing into items with dates.
 *
 * Each row renders as a thumbnail link, then a text title link to the same
 * article, then a "Mon DD, YYYY" line. The date for a row is the first one that
 * appears after its title link and before the next row's.
 *
 * @param {string} markdown
 * @returns {Array<object>}
 */
function parseFirecrawlListing(markdown) {
  const seen = new Map();
  let m;
  FC_LINK_RE.lastIndex = 0;
  while ((m = FC_LINK_RE.exec(markdown)) !== null) {
    let path;
    try { path = new URL(m[2]).pathname; } catch { continue; }
    path = path.split('?')[0].split('#')[0];
    if (!ARTICLE_RE.test(path)) continue;
    const title = decodeEntities(m[1]);
    if (!title || title.length < 3) continue;
    if (!seen.has(path)) seen.set(path, { path, title, at: FC_LINK_RE.lastIndex });
  }

  const rows = [...seen.values()];
  return rows.map((row, i) => {
    const stop = i + 1 < rows.length ? rows[i + 1].at : markdown.length;
    const d = markdown.slice(row.at, stop).match(FC_DATE_RE);
    let publishedAt = null;
    if (d) {
      const dt = new Date(Date.UTC(Number(d[3]), MONTHS[d[1].toLowerCase()], Number(d[2])));
      if (!Number.isNaN(dt.getTime())) publishedAt = dt;
    }
    return {
      source: 'ati_website',
      externalId: row.path,
      title: row.title,
      summary: '',
      url: BASE + row.path,
      publishedAt,
    };
  });
}

/**
 * The original direct read: one GET of the listing page, regex-parsed. Kept as
 * the fallback for when Firecrawl is unavailable — it needs no key and no third
 * party, but it gets no dates and breaks if the markup changes.
 *
 * @returns {Promise<{items: object[], note: string}>}
 */
async function fetchRawListing() {
  const url = BASE + LISTING_PATH;
  let html;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
      signal: controller.signal,
      redirect: 'follow',
    });
    clearTimeout(timer);

    if (!res.ok) {
      return { items: [], note: `ATI website returned HTTP ${res.status} for ${url}. Nothing was read.` };
    }
    html = await res.text();
  } catch (err) {
    logger.error('ATI website fetch failed', err);
    return { items: [], note: `Could not reach ${url}: ${err.message}` };
  }

  const articles = parseListing(html);
  if (!articles.length) {
    // Loud rather than silent: an empty parse almost always means the markup
    // changed, and that must not read as "no new posts".
    return {
      items: [],
      note: `Fetched ${url} but found no articles. The page layout has probably changed and the reader needs updating.`,
    };
  }

  // The listing renders newest first, but elearningSync takes the TAIL of the
  // array as "most recent" (the Moodle driver hands back oldest first). Reverse
  // here so the convention holds and the newest articles are the ones posted.
  const oldestFirst = articles.slice().reverse();

  return {
    items: oldestFirst.map((a) => ({
      source: 'ati_website',
      externalId: a.path,
      title: a.title,
      summary: '',
      url: BASE + a.path,
      // The site publishes no dates; "new" is decided by URL, not time.
      publishedAt: null,
    })),
    note: `Read ${articles.length} article(s) from ${url}`,
  };
}

module.exports = {
  fetchAtiArticles, fetchViaFirecrawl, fetchRawListing,
  parseListing, parseFirecrawlListing, titleFromSlug,
  BASE, LISTING_PATH, USER_AGENT,
};
