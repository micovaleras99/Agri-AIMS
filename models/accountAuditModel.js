/**
 * Account lifecycle audit trail (req. 13).
 *
 * Records who did what to a login account — created, deactivated, reactivated,
 * re-linked, permanently deleted — with the acting administrator and a timestamp.
 * The applicant's application_id is stored alongside the user id so the history
 * survives even if the user row is later removed. No secrets are logged.
 */

const { query } = require('../config/database');
const { rowToCamel } = require('../utils/caseConvert');

/**
 * @param {object} e
 * @param {number|null} [e.userId]        the account acted upon
 * @param {string} [e.applicationId]      the applicant it is/was linked to
 * @param {string} e.action               one of the account_audit enum values
 * @param {number|null} [e.actorId]       the admin who performed it
 * @param {string} [e.actorName]
 * @param {string} [e.detail]             short human note; never a secret
 */
async function log(e) {
  await query(
    `INSERT INTO account_audit (user_id, application_id, action, actor_id, actor_name, detail)
     VALUES (?,?,?,?,?,?)`,
    [
      e.userId ?? null,
      e.applicationId || '',
      e.action,
      e.actorId ?? null,
      (e.actorName || '').slice(0, 255),
      (e.detail || '').slice(0, 500),
    ]
  );
}

/** Newest-first history for one account (or its application_id after deletion). */
async function listForUser(userId, applicationId = '') {
  const rows = await query(
    `SELECT * FROM account_audit
      WHERE user_id = ? OR (application_id <> '' AND application_id = ?)
      ORDER BY id DESC LIMIT 200`,
    [userId ?? 0, applicationId || '']
  );
  return rows.map(rowToCamel);
}

module.exports = { log, listForUser };
