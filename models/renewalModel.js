/**
 * Renewal / re-accreditation applications, and the reminder ledger.
 */

const { query, pool } = require('../config/database');
const { rowToCamel } = require('../utils/caseConvert');
const { validUntilFrom } = require('../config/renewal');

/** One column list, so no read can drift from another. */
const COLUMNS = `
  r.id, r.farm_id, r.applicant_id, r.submitted_by, r.submitted_at, r.previous_expiry,
  r.status, r.operator_remarks, r.reviewed_by, r.reviewed_at, r.decision_remarks,
  r.new_certificate_no, r.new_valid_until, r.created_at, r.updated_at,
  f.name AS farm_name, f.operator AS farm_operator, f.expiry_date AS farm_expiry,
  f.province, f.municipality,
  a.application_id
`;

const FROM = `
  renewal_applications r
  JOIN farms f ON f.id = r.farm_id
  LEFT JOIN applicants a ON a.id = r.applicant_id
`;

const toDate = (v) => (v instanceof Date ? v.toISOString().split('T')[0] : v);

function format(row) {
  if (!row) return null;
  const o = rowToCamel(row);
  for (const k of ['previousExpiry', 'newValidUntil', 'farmExpiry']) o[k] = toDate(o[k]);
  return o;
}

async function findAll({ status, farmId } = {}) {
  const where = [];
  const params = [];
  if (status) { where.push('r.status = ?'); params.push(status); }
  if (farmId) { where.push('r.farm_id = ?'); params.push(farmId); }
  const sql = `SELECT ${COLUMNS} FROM ${FROM}
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY r.submitted_at DESC`;
  return (await query(sql, params)).map(format);
}

async function findById(id) {
  const rows = await query(`SELECT ${COLUMNS} FROM ${FROM} WHERE r.id = ? LIMIT 1`, [id]);
  return format(rows[0]);
}

/**
 * The renewal a farm currently has in flight, if any.
 *
 * "In flight" is deliberately submitted-or-under-review: a rejected application
 * must not block a corrected resubmission, and an approved one is finished.
 */
async function findOpenForFarm(farmId) {
  const rows = await query(
    `SELECT ${COLUMNS} FROM ${FROM}
      WHERE r.farm_id = ? AND r.status IN ('submitted','under_review')
      ORDER BY r.submitted_at DESC LIMIT 1`,
    [farmId]
  );
  return format(rows[0]);
}

async function create({ farmId, applicantId, submittedBy, previousExpiry, operatorRemarks }) {
  const [res] = await pool.execute(
    `INSERT INTO renewal_applications
       (farm_id, applicant_id, submitted_by, previous_expiry, operator_remarks)
     VALUES (?,?,?,?,?)`,
    [farmId, applicantId ?? null, submittedBy ?? null, previousExpiry || null, operatorRemarks || '']
  );
  return res.insertId;
}

/** Moves an application to under_review without deciding it. */
async function markUnderReview(id, reviewerId) {
  await query(
    `UPDATE renewal_applications SET status = 'under_review', reviewed_by = ?
      WHERE id = ? AND status = 'submitted'`,
    [reviewerId ?? null, id]
  );
}

/**
 * Approve or reject, and on approval carry the new date onto the farm and the
 * original application in the same transaction.
 *
 * The dates are the point of the whole module, so they are written together or
 * not at all: a renewal marked approved while the farm still shows the old
 * expiry is worse than a failed approval, because every screen would then
 * disagree about whether the site is accredited.
 */
async function decide(id, { approve, reviewerId, remarks, certificateNo }) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [rows] = await conn.execute(
      'SELECT farm_id, applicant_id, previous_expiry FROM renewal_applications WHERE id = ? FOR UPDATE',
      [id]
    );
    if (!rows.length) { await conn.rollback(); return null; }
    const app = rows[0];

    let newValidUntil = null;
    if (approve) {
      // Renewal runs from today, not from the old expiry: a site renewed late
      // would otherwise be handed a certificate that had already begun.
      newValidUntil = validUntilFrom(new Date());
      await conn.execute('UPDATE farms SET expiry_date = ?, status = ? WHERE id = ?',
        [newValidUntil, 'active', app.farm_id]);
      if (app.applicant_id) {
        await conn.execute(
          'UPDATE applicants SET step7_valid_until = ?, step7_certificate_no = COALESCE(?, step7_certificate_no) WHERE id = ?',
          [newValidUntil, certificateNo || null, app.applicant_id]
        );
      }
    }

    await conn.execute(
      `UPDATE renewal_applications
          SET status = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP,
              decision_remarks = ?, new_certificate_no = ?, new_valid_until = ?
        WHERE id = ?`,
      [approve ? 'approved' : 'rejected', reviewerId ?? null, remarks || '',
        certificateNo || null, newValidUntil, id]
    );

    await conn.commit();
    return { farmId: app.farm_id, applicantId: app.applicant_id, newValidUntil };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * Farms whose accreditation expires within `days`, still active, and without a
 * renewal already in flight — the set worth reminding.
 */
async function findExpiringFarms(days) {
  return (await query(
    `SELECT f.id, f.name, f.operator, f.expiry_date, f.applicant_id
       FROM farms f
      WHERE f.expiry_date IS NOT NULL
        AND f.expiry_date >= CURDATE()
        AND f.expiry_date <= DATE_ADD(CURDATE(), INTERVAL ? DAY)
        AND NOT EXISTS (
          SELECT 1 FROM renewal_applications r
           WHERE r.farm_id = f.id AND r.status IN ('submitted','under_review')
        )
      ORDER BY f.expiry_date ASC`,
    [days]
  )).map((r) => ({ ...rowToCamel(r), expiryDate: toDate(r.expiry_date) }));
}

/**
 * Claims the right to send one reminder.
 *
 * The unique key does the deciding: INSERT IGNORE returns 0 affected rows when
 * this farm has already been reminded at this window for this expiry date, so
 * two schedulers racing cannot both send. Returns true only to the caller that
 * won the insert.
 */
async function claimReminder(farmId, expiryDate, daysBefore) {
  const [res] = await pool.execute(
    'INSERT IGNORE INTO renewal_reminders (farm_id, expiry_date, days_before) VALUES (?,?,?)',
    [farmId, expiryDate, daysBefore]
  );
  return res.affectedRows > 0;
}

async function recordReminderCount(farmId, expiryDate, daysBefore, notified) {
  await query(
    'UPDATE renewal_reminders SET notified = ? WHERE farm_id = ? AND expiry_date = ? AND days_before = ?',
    [notified, farmId, expiryDate, daysBefore]
  );
}

async function remindersFor(farmId) {
  return (await query(
    'SELECT * FROM renewal_reminders WHERE farm_id = ? ORDER BY sent_at DESC', [farmId]
  )).map(rowToCamel);
}

module.exports = {
  findAll,
  findById,
  findOpenForFarm,
  create,
  markUnderReview,
  decide,
  findExpiringFarms,
  claimReminder,
  recordReminderCount,
  remindersFor,
};
