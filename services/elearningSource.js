/**
 * Where e-learning items come from (RSC-03).
 *
 * The ATI e-Learning site at https://elearn.e-extension.gov.ph runs Moodle, and
 * its Web Services REST endpoint is live — a request with an invalid token
 * answers `{"errorcode":"invalidtoken"}` rather than 404, which means the API is
 * enabled and only needs credentials.
 *
 * That token can only be issued by the ATI e-Extension administrator
 * (Site administration → Plugins → Web services → Manage tokens). Until your
 * team has one, the `manual` driver lets staff enter announcements by hand and
 * the rest of the pipeline — dedupe, store, post to Community Chat, notify —
 * works identically.
 *
 * Scraping the site's HTML is deliberately not implemented: it is brittle, and
 * the terms of a government site should not be assumed.
 */

const MOODLE_URL = (process.env.MOODLE_URL || 'https://elearn.e-extension.gov.ph').replace(/\/+$/, '');
const MOODLE_TOKEN = process.env.MOODLE_TOKEN || '';
const REQUEST_TIMEOUT_MS = Number(process.env.MOODLE_TIMEOUT_MS) || 15000;
const { fetchAtiArticles } = require('./atiWebsite');

/** Strips the HTML Moodle returns in summary fields. */
function stripHtml(html) {
  return String(html || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function truncate(text, max) {
  const s = String(text || '');
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

async function callMoodle(wsfunction, params = {}) {
  if (!MOODLE_TOKEN) {
    throw new Error(
      'MOODLE_TOKEN is not set. Ask the ATI e-Learning administrator to issue a Web Services token, ' +
      'or use the manual driver (ELEARNING_SOURCE=manual).'
    );
  }

  const url = new URL(`${MOODLE_URL}/webservice/rest/server.php`);
  url.searchParams.set('wstoken', MOODLE_TOKEN);
  url.searchParams.set('wsfunction', wsfunction);
  url.searchParams.set('moodlewsrestformat', 'json');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`Moodle responded ${res.status} ${res.statusText}`);
    const json = await res.json();
    // Moodle reports its own errors inside a 200 response.
    if (json && json.exception) {
      throw new Error(`Moodle ${json.errorcode || 'error'}: ${json.message || 'request rejected'}`);
    }
    return json;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Recently updated courses, as items.
 * Uses core_course_get_courses_by_field, which any token with the
 * moodle/course:view capability can call.
 */
async function fetchMoodleCourses() {
  const json = await callMoodle('core_course_get_courses_by_field');
  const courses = (json && json.courses) || [];
  return courses
    // Skip the site front page, which Moodle returns as course id 1.
    .filter((c) => Number(c.id) !== 1)
    .map((c) => ({
      source: 'moodle_course',
      externalId: String(c.id),
      title: stripHtml(c.fullname || c.displayname || `Course ${c.id}`),
      summary: truncate(stripHtml(c.summary), 900),
      url: `${MOODLE_URL}/course/view.php?id=${c.id}`,
      publishedAt: c.timemodified ? new Date(Number(c.timemodified) * 1000) : null,
    }));
}

/**
 * Posts from a Moodle forum — the "Site announcements" forum is the usual
 * source of "new course available" notices. Needs the forum id, which the
 * site administrator can read from the forum's URL.
 */
async function fetchMoodleAnnouncements() {
  const forumId = process.env.MOODLE_ANNOUNCEMENT_FORUM_ID;
  if (!forumId) return [];
  const json = await callMoodle('mod_forum_get_forum_discussions', { forumid: forumId });
  const discussions = (json && json.discussions) || [];
  return discussions.map((d) => ({
    source: 'moodle_announcement',
    externalId: String(d.discussion || d.id),
    title: stripHtml(d.name || d.subject || 'Announcement'),
    summary: truncate(stripHtml(d.message), 900),
    url: `${MOODLE_URL}/mod/forum/discuss.php?d=${d.discussion || d.id}`,
    publishedAt: d.timemodified ? new Date(Number(d.timemodified) * 1000) : null,
  }));
}

/**
 * @returns {Promise<{ items: object[], driver: string, note: string }>}
 */
async function fetchItems() {
  const driver = (process.env.ELEARNING_SOURCE || (MOODLE_TOKEN ? 'moodle' : 'manual')).toLowerCase();

  // Reads the ATI Bicol website itself. See services/atiWebsite.js for why this
  // parses HTML rather than a feed, and what it deliberately does not do.
  if (driver === 'ati' || driver === 'ati_website') {
    const { items, note } = await fetchAtiArticles();
    return { items, driver: 'ati_website', note };
  }

  if (driver !== 'moodle') {
    return {
      items: [],
      driver: 'manual',
      note: 'Manual mode: staff add announcements from /admin/elearning. Set ELEARNING_SOURCE=ati to read the ATI Bicol website, or MOODLE_TOKEN with ELEARNING_SOURCE=moodle for the e-learning portal.',
    };
  }

  const [courses, announcements] = await Promise.all([
    fetchMoodleCourses(),
    fetchMoodleAnnouncements().catch(() => []), // optional; a missing forum id is not fatal
  ]);

  return {
    items: [...announcements, ...courses],
    driver: 'moodle',
    note: `Fetched from ${MOODLE_URL}`,
  };
}

module.exports = { fetchItems, fetchMoodleCourses, fetchMoodleAnnouncements, stripHtml, truncate, MOODLE_URL };
