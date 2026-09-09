/**
 * Runs the e-learning check once (RSC-03).
 *
 *   npm run sync:elearning              # fetch, store, post, notify
 *   npm run sync:elearning -- --dry-run # report what would be new, change nothing
 *   npm run sync:elearning -- --quiet   # store and post without notifying
 *
 * Schedule it however the deployment allows — Windows Task Scheduler, cron, or
 * a hosting platform's scheduler. Running it twice is harmless: an item already
 * recorded is skipped, not re-posted.
 */

require('dotenv').config();
const { sync } = require('../services/elearningSync');
const { pool } = require('../config/database');

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const notifyMembers = !process.argv.includes('--quiet');

  const result = await sync({ dryRun, notifyMembers });

  console.log(`Source driver : ${result.driver}`);
  if (result.note) console.log(`                ${result.note}`);
  console.log(`Items fetched : ${result.fetched}`);
  console.log(`New           : ${result.added}${dryRun ? ' (dry run — nothing written)' : ''}`);
  console.log(`Already seen  : ${result.skipped}`);
  if (result.backfilled) {
    console.log(`Marked as seen: ${result.backfilled} older article(s) — recorded so they are` +
                `
                never posted retrospectively, not sent to the channel`);
  }
  if (!dryRun) {
    console.log(`Posted to chat: ${result.posted}`);
    console.log(`Notifications : ${result.notified}`);
  }
  if (result.newTitles.length) {
    console.log('\nNew items:');
    result.newTitles.forEach((t) => console.log(`  - ${t}`));
  }
  if (result.errors.length) {
    console.log('\nProblems:');
    result.errors.forEach((e) => console.log(`  ! ${e}`));
  }
  if (result.driver === 'manual') {
    console.log('\nNo Moodle token configured, so nothing was fetched automatically.');
    console.log('Add announcements at /admin/elearning, or set MOODLE_TOKEN and ELEARNING_SOURCE=moodle.');
  }

  await pool.end();
  process.exit(result.errors.length ? 1 : 0);
}

main().catch(async (err) => {
  console.error('Sync failed:', err.message);
  try { await pool.end(); } catch { /* already closing */ }
  process.exit(1);
});
