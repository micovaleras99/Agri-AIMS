/**
 * RSC-03 admin screen: what the sync has seen, and manual entry for use while
 * no Moodle token is available.
 */

const articleModel = require('../models/articleModel');
const { lastRun, MIN_MINUTES } = require('../services/syncScheduler');
const { addManual, sync } = require('../services/elearningSync');
const { MOODLE_URL } = require('../services/elearningSource');

function driverInfo() {
  const configured = Boolean(process.env.MOODLE_TOKEN);
  const driver = (process.env.ELEARNING_SOURCE || (configured ? 'moodle' : 'manual')).toLowerCase();
  // The panel used to show the Moodle address and a "no Moodle token" warning
  // whatever the mode was, so an admin reading it while the ATI website driver
  // was running saw the address of a system this install is not using.
  const isAti = driver === 'ati';
  return {
    driver,
    configured,
    isAti,
    moodleUrl: MOODLE_URL,
    siteUrl: isAti
      ? (process.env.ATI_SITE_URL || 'https://ati2.da.gov.ph') +
        (process.env.ATI_LISTING_PATH || '/ati-5/content/')
      : MOODLE_URL,
    forumConfigured: Boolean(process.env.MOODLE_ANNOUNCEMENT_FORUM_ID),
  };
}

async function render(res, extra = {}) {
  const [articles, stats] = await Promise.all([articleModel.findRecent(30), articleModel.stats()]);
  return res.render('pages/admin/elearning', {
    title: 'e-Learning Monitoring — Agri-AIMS',
    page: 'community',
    articles,
    stats,
    source: driverInfo(),
    // So staff can see the timer working instead of taking it on trust.
    schedule: {
      intervalMinutes: Number(process.env.SYNC_INTERVAL_MINUTES) || 0,
      minMinutes: MIN_MINUTES,
      lastRun,
    },
    error: null,
    notice: null,
    result: null,
    ...extra,
  });
}

/** GET /admin/elearning */
async function index(req, res) {
  return render(res);
}

/** POST /admin/elearning/manual */
async function createManual(req, res) {
  const title = String(req.body.title || '').trim();
  if (!title) return render(res, { error: 'A title is required.' });

  const outcome = await addManual({
    title,
    summary: String(req.body.summary || '').trim(),
    url: String(req.body.url || '').trim(),
    publishedAt: req.body.publishedAt || null,
    notifyMembers: req.body.notifyMembers === 'on',
  });

  return render(res, {
    notice: outcome.added
      ? `Posted to Community Chat${outcome.notified ? ` and notified ${outcome.notified} member(s)` : ''}.`
      : 'That item was already recorded, so nothing was posted again.',
  });
}

/** POST /admin/elearning/sync — run the check now */
async function runSync(req, res) {
  const result = await sync({ dryRun: req.body.dryRun === 'on' });
  return render(res, { result });
}

module.exports = { index, createManual, runSync };
