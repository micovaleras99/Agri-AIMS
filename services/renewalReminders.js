/**
 * The job behind Table 10's "Renewal Notification".
 *
 * Runs on the same timer as the article sync. It looks for accreditations
 * approaching their expiry date and sends one notice per farm per window —
 * `renewalModel.claimReminder` is what makes it "one", not a check here, so two
 * copies of the scheduler cannot both send.
 *
 * Farms with a renewal already submitted are excluded by the query: an operator
 * who has acted should not keep being told to act.
 */

const logger = require('../utils/logger');
const notify = require('./notify');
const renewalModel = require('../models/renewalModel');
const { REMINDER_DAYS, EXPIRING_SOON_DAYS, reminderWindow, daysUntil } = require('../config/renewal');

/**
 * @returns {Promise<{ checked: number, sent: number, skipped: number, errors: string[] }>}
 */
async function run() {
  const result = { checked: 0, sent: 0, skipped: 0, errors: [] };

  let farms;
  try {
    farms = await renewalModel.findExpiringFarms(EXPIRING_SOON_DAYS);
  } catch (err) {
    result.errors.push('lookup failed: ' + err.message);
    logger.error('renewal reminders: lookup failed', err);
    return result;
  }

  result.checked = farms.length;

  for (const farm of farms) {
    const window = reminderWindow(farm.expiryDate);
    // Between two windows — nothing due yet.
    if (window === null) { result.skipped += 1; continue; }

    try {
      const claimed = await renewalModel.claimReminder(farm.id, farm.expiryDate, window);
      if (!claimed) { result.skipped += 1; continue; }

      const days = daysUntil(farm.expiryDate);
      const notified = await notify.renewalDue(farm, days);
      await renewalModel.recordReminderCount(farm.id, farm.expiryDate, window, notified);
      result.sent += 1;
      console.log(`Renewal reminder: ${farm.name} expires ${farm.expiryDate} (${days}d, ${window}d window), notified ${notified}`);
    } catch (err) {
      result.errors.push(`${farm.name}: ${err.message}`);
      logger.error('renewal reminders: send failed', err);
    }
  }

  return result;
}

module.exports = { run, REMINDER_DAYS };
