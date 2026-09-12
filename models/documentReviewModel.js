/**
 * Immutable audit trail for document submissions and validation decisions
 * (see database/migrations/039). One row per event, so the history survives even
 * when a re-upload replaces the current `documents` row.
 */

const { query, pool } = require('../config/database');
const { rowToCamel } = require('../utils/caseConvert');

/**
 * Record one event. Never throws into the caller's flow — a failed audit write
 * must not break an upload or a review, so errors are logged and swallowed.
 * @param {{applicantId:number, applicationId?:string, docType:string,
 *          docName?:string, filename?:string, action:'submitted'|'accepted'|'rejected',
 *          remarks?:string, actor?:string}} e
 */
async function log(e) {
  try {
    await pool.execute(
      `INSERT INTO document_reviews
         (applicant_id, application_id, doc_type, doc_name, filename, action, remarks, actor)
       VALUES (?,?,?,?,?,?,?,?)`,
      [e.applicantId || null, e.applicationId || '', e.docType || '', e.docName || '',
        e.filename || '', e.action, e.remarks || null, e.actor || '']
    );
  } catch (err) {
    console.error('documentReviewModel.log failed:', err.message);
  }
}

/** Every event for one requirement (applicant + type), oldest first. */
async function historyFor(applicantId, docType) {
  const rows = await query(
    `SELECT id, action, remarks, actor, filename, created_at
       FROM document_reviews
      WHERE applicant_id = ? AND doc_type = ?
      ORDER BY created_at ASC, id ASC`,
    [Number(applicantId), String(docType)]
  );
  return rows.map(rowToCamel);
}

/** How many times this requirement has been rejected (for a quick badge). */
async function rejectionCount(applicantId, docType) {
  const rows = await query(
    `SELECT COUNT(*) AS c FROM document_reviews
      WHERE applicant_id = ? AND doc_type = ? AND action = 'rejected'`,
    [Number(applicantId), String(docType)]
  );
  return rows[0] ? Number(rows[0].c) : 0;
}

module.exports = { log, historyFor, rejectionCount };
