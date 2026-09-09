/**
 * Runs the article sync on a timer, so "new ATI post appears in chat" happens
 * without anyone typing a command.
 *
 * `setInterval` rather than a cron dependency: one interval, in-process, no new
 * package. If the team later wants runs to survive a server restart or to fire
 * while the app is down, Windows Task Scheduler calling `npm run sync:elearning`
 * is the better tool — this is documented in SETUP.md and the two can coexist,
 * because the sync deduplicates by unique key either way.
 *
 * Off unless SYNC_INTERVAL_MINUTES is set, so nothing reaches out to the
 * internet on its own during a demo or a marking session unless asked.
 */

const logger = require('../utils/logger');

/** Anything under this hammers a site that sends `no-cache` on a 121 KB page. */
const MIN_MINUTES = 15;

let timer = null;
let firstRun = null;
let running = false;

/**
 * Renewal reminders get their own timer rather than riding the article sync.
 *
 * The article sync is off unless SYNC_INTERVAL_MINUTES is set, deliberately, so
 * that nothing reaches the internet during a demo. Reminders touch nothing
 * outside this database and cost nothing, and an accreditation that lapses
 * because a demo setting was left unset is a real failure — so they default to
 * on, once a day.
 */
let reminderTimer = null;
let reminderFirstRun = null;
let remindersRunning = false;

const REMINDER_FIRST_RUN_DELAY_MS = 90 * 1000;

/** Last reminder pass, for the admin page. */
const lastReminderRun = { at: null, checked: 0, sent: 0, skipped: 0, errors: [] };

async function runRemindersOnce(reason) {
  if (remindersRunning) return null;
  remindersRunning = true;
  try {
    // Lazy, for the same reason the sync is: this pulls in the DB pool.
    const { run } = require('./renewalReminders');
    const result = await run();
    Object.assign(lastReminderRun, { at: new Date(), ...result });
    if (result.sent > 0) {
      console.log(`Renewal reminders (${reason}): ${result.sent} sent, ${result.checked} farm(s) inside the window`);
    }
    if (result.errors.length) logger.error('Renewal reminders reported: ' + result.errors.join('; '));
    return result;
  } catch (err) {
    Object.assign(lastReminderRun, { at: new Date(), errors: [err.message] });
    logger.error('Renewal reminders failed', err);
    return null;
  } finally {
    remindersRunning = false;
  }
}

/** Long enough that booting is never held up by a slow site. */
const FIRST_RUN_DELAY_MS = 60 * 1000;

/** Last run, for the admin page to show rather than leaving staff guessing. */
const lastRun = { at: null, driver: null, posted: 0, added: 0, note: '', errors: [] };

async function runOnce(reason) {
  // A slow run must never overlap the next tick and post twice.
  if (running) {
    console.log('Article sync: previous run still in progress, skipping this tick');
    return null;
  }
  running = true;
  try {
    // Required lazily: the sync pulls in the DB pool, and requiring it at module
    // load would connect before app.js has checked the database is reachable.
    const { sync } = require('./elearningSync');
    const result = await sync({});
    Object.assign(lastRun, {
      at: new Date(),
      driver: result.driver,
      posted: result.posted,
      added: result.added,
      note: result.note,
      errors: result.errors,
    });
    console.log(result.posted > 0
      ? `Article sync (${reason}): posted ${result.posted} new item(s) from ${result.driver}`
      : `Article sync (${reason}): checked ${result.driver}, nothing new`);
    if (result.errors.length) {
      logger.error('Article sync reported: ' + result.errors.join('; '));
    }
    return result;
  } catch (err) {
    // A scheduled job must never take the web server down with it.
    Object.assign(lastRun, { at: new Date(), errors: [err.message] });
    logger.error('Article sync failed', err);
    return null;
  } finally {
    running = false;
  }
}

/**
 * Start the timer if configured.
 * @returns {{started: boolean, minutes?: number, reason?: string}}
 */
function start() {
  const raw = process.env.SYNC_INTERVAL_MINUTES;
  if (!raw) return { started: false, reason: 'SYNC_INTERVAL_MINUTES not set' };

  const requested = Number(raw);
  if (!Number.isFinite(requested) || requested <= 0) {
    return { started: false, reason: `SYNC_INTERVAL_MINUTES="${raw}" is not a positive number` };
  }

  const minutes = Math.max(MIN_MINUTES, requested);
  const ms = minutes * 60 * 1000;

  timer = setInterval(() => { runOnce('scheduled'); }, ms);
  if (typeof timer.unref === 'function') timer.unref(); // never hold the process open

  firstRun = setTimeout(() => { runOnce('startup'); }, FIRST_RUN_DELAY_MS);
  if (typeof firstRun.unref === 'function') firstRun.unref();

  return {
    started: true,
    minutes,
    firstRunInSeconds: FIRST_RUN_DELAY_MS / 1000,
    reason: requested < MIN_MINUTES
      ? `requested ${requested} min, raised to the ${MIN_MINUTES} min floor`
      : '',
  };
}

/**
 * Start the renewal reminder timer.
 * Set RENEWAL_REMINDER_HOURS=0 to switch it off; anything else is hours.
 * @returns {{started: boolean, hours?: number, reason?: string}}
 */
function startReminders() {
  const raw = process.env.RENEWAL_REMINDER_HOURS;
  if (raw !== undefined && Number(raw) === 0) {
    return { started: false, reason: 'RENEWAL_REMINDER_HOURS=0' };
  }
  const requested = raw === undefined ? 24 : Number(raw);
  const hours = Number.isFinite(requested) && requested > 0 ? requested : 24;
  const ms = hours * 60 * 60 * 1000;

  reminderTimer = setInterval(() => { runRemindersOnce('scheduled'); }, ms);
  if (typeof reminderTimer.unref === 'function') reminderTimer.unref();

  reminderFirstRun = setTimeout(() => { runRemindersOnce('startup'); }, REMINDER_FIRST_RUN_DELAY_MS);
  if (typeof reminderFirstRun.unref === 'function') reminderFirstRun.unref();

  return { started: true, hours, firstRunInSeconds: REMINDER_FIRST_RUN_DELAY_MS / 1000 };
}

function stop() {
  if (timer) clearInterval(timer);
  if (firstRun) clearTimeout(firstRun);
  if (reminderTimer) clearInterval(reminderTimer);
  if (reminderFirstRun) clearTimeout(reminderFirstRun);
  timer = null;
  firstRun = null;
  reminderTimer = null;
  reminderFirstRun = null;
}

module.exports = {
  start, stop, runOnce, lastRun, MIN_MINUTES,
  startReminders, runRemindersOnce, lastReminderRun,
};
