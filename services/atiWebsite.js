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
 * - **The site publishes no dates.** No <time>, no og:published_time, no visible
 *   date on the article pages. "New" therefore means "a URL this system has not
 *   seen before", which works from the moment monitoring starts but cannot
 *   backfill or answer "what was posted last week".
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
 * Fetch the listing and return items in the shape elearningSync expects.
 * Never throws: a failure returns an empty list with a note explaining it.
 *
 * @returns {Promise<{items: object[], note: string}>}
 */
async function fetchAtiArticles() {
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

module.exports = { fetchAtiArticles, parseListing, titleFromSlug, BASE, LISTING_PATH, USER_AGENT };
