/**
 * Uploaded / tracked documentary requirements per applicant.
 */

const { query, pool } = require('../config/database');
const { likeTerm } = require('../utils/search');
const { rowToCamel } = require('../utils/caseConvert');
const { removeStored } = require('../config/upload');
const documentReviewModel = require('./documentReviewModel');

const SELECT_BASE = `
  SELECT d.id, d.applicant_id, d.application_id, d.applicant_name, d.name, d.type, d.filename,
         d.stored_name, d.mime_type, d.size_bytes, d.size, d.upload_date,
         d.status, d.remarks, d.reviewed_by, d.reviewed_at,
         TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))) AS reviewed_by_name,
         d.created_at, d.updated_at
  FROM documents d
  LEFT JOIN users u ON u.id = d.reviewed_by
`;

/**
 * The three states a document can be in. They are the ones the rest of the
 * app already filters, counts and colours by — the status dropdown on the
 * documents page, statsGlobal(), and the .status-badge classes — so a review
 * writes one of these rather than introducing a fourth word for the same idea.
 *
 *   verified       accepted; counts towards the endorsement packet
 *   incomplete     rejected; the applicant is told why and re-uploads
 *   pending_review not yet looked at, the state every upload starts in
 */
const DOCUMENT_STATUSES = ['verified', 'incomplete', 'pending_review'];

function formatRow(row) {
  if (!row) return null;
  return rowToCamel(row);
}

async function findAll() {
  const rows = await query(`${SELECT_BASE} ORDER BY d.upload_date DESC, d.id DESC`);
  return rows.map(formatRow);
}

/**
 * @param {{ status?: string, type?: string, search?: string, applicantId?: number, applicantIds?: number[] }} filters
 */
async function findFiltered(filters = {}) {
  const clauses = [];
  const params = [];

  if (filters.applicantId != null) {
    clauses.push('d.applicant_id = ?');
    params.push(filters.applicantId);
  } else if (filters.applicantIds && filters.applicantIds.length) {
    const ph = filters.applicantIds.map(() => '?').join(',');
    clauses.push(`d.applicant_id IN (${ph})`);
    params.push(...filters.applicantIds);
  }

  if (filters.status) {
    clauses.push('d.status = ?');
    params.push(filters.status);
  }
  if (filters.type) {
    clauses.push('d.type = ?');
    params.push(filters.type);
  }
  if (filters.search) {
    const q = likeTerm(filters.search);
    clauses.push('(d.name LIKE ? OR d.applicant_name LIKE ? OR d.application_id LIKE ?)');
    params.push(q, q, q);
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = await query(`${SELECT_BASE} ${where} ORDER BY d.upload_date DESC, d.id DESC`, params);
  return rows.map(formatRow);
}

async function statsGlobal() {
  const rows = await query(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status = 'verified' THEN 1 ELSE 0 END) AS verified,
      SUM(CASE WHEN status = 'pending_review' THEN 1 ELSE 0 END) AS pending_review,
      SUM(CASE WHEN status = 'incomplete' THEN 1 ELSE 0 END) AS incomplete
    FROM documents
  `);
  const r = rows[0];
  return {
    total: r.total || 0,
    verified: r.verified || 0,
    pending: r.pending_review || 0,
    incomplete: r.incomplete || 0,
  };
}

async function countVerifiedForApplicantIds(docType) {
  const rows = await query(
    `SELECT COUNT(DISTINCT applicant_id) AS c FROM documents WHERE type = ? AND status = 'verified'`,
    [docType]
  );
  return rows[0].c || 0;
}

async function create(data) {
  const sql = `
    INSERT INTO documents (
      applicant_id, application_id, applicant_name, name, type, filename, stored_name,
      mime_type, size_bytes, size, upload_date, status, remarks
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
  `;
  // pool.execute exposes the OkPacket; query() returns rows only, so insertId lives here.
  const [result] = await pool.execute(sql, [
    data.applicantId,
    data.applicationId,
    data.applicantName,
    data.name,
    data.type,
    data.filename,
    data.storedName || null,
    data.mimeType || null,
    data.sizeBytes || null,
    data.size,
    data.uploadDate,
    data.status,
    data.remarks || '',
  ]);
  // Audit trail: record the submission so history survives a later re-upload.
  await documentReviewModel.log({
    applicantId: data.applicantId,
    applicationId: data.applicationId,
    docType: data.type,
    docName: data.name,
    filename: data.filename,
    action: 'submitted',
    actor: data.applicantName,
  });
  return result.insertId;
}

async function findByApplicant(applicantId) {
  const rows = await query(`${SELECT_BASE} WHERE d.applicant_id = ? ORDER BY d.id ASC`, [applicantId]);
  return rows.map(formatRow);
}

async function findVerifiedByApplicant(applicantId) {
  const rows = await query(
    `${SELECT_BASE} WHERE d.applicant_id = ? AND d.status = 'verified' ORDER BY d.id ASC`,
    [applicantId]
  );
  return rows.map(formatRow);
}

async function findById(id) {
  const rows = await query(`${SELECT_BASE} WHERE d.id = ? LIMIT 1`, [id]);
  return formatRow(rows[0]);
}

/**
 * Deletes rows and their uploaded files together.
 * Any DELETE on documents must go through here, or the bytes are orphaned on
 * disk with nothing left in the database pointing at them.
 * @param {string} where  SQL after WHERE
 * @param {unknown[]} params
 * @returns {Promise<number>} rows removed
 */
async function removeWhere(where, params) {
  const rows = await query(`SELECT id, stored_name FROM documents WHERE ${where}`, params);
  const [res] = await pool.execute(`DELETE FROM documents WHERE ${where}`, params);
  // Files last: if the DELETE fails we have not destroyed anything.
  for (const r of rows) removeStored(r.stored_name);
  return res.affectedRows;
}

/** Everything belonging to one applicant, files included. */
const removeForApplicant = (applicantId) => removeWhere('applicant_id = ?', [Number(applicantId)]);

/** A previous submission of the same requirement, replaced by a new upload. */
const removeSameType = (applicantId, type) =>
  removeWhere('applicant_id = ? AND type = ?', [Number(applicantId), String(type)]);

/**
 * Records an evaluator's decision on one document.
 *
 * @param {number} id
 * @param {{ status: string, remarks?: string, reviewerId?: number|null }} decision
 * @returns {Promise<object|null>} the document as it now stands, or null if
 *          the id does not exist or the status is not one we recognise
 */
async function review(id, { status, remarks, reviewerId }) {
  if (!DOCUMENT_STATUSES.includes(status)) return null;
  // A rejection with no reason is the thing this whole feature exists to
  // avoid: the applicant is told to fix a document and not told what is wrong.
  if (status === 'incomplete' && !String(remarks || '').trim()) return null;

  const [result] = await pool.execute(
    `UPDATE documents
        SET status = ?, remarks = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
    [status, String(remarks || '').trim(), reviewerId || null, id]
  );
  if (!result.affectedRows) return null;
  const doc = await findById(id);
  // Audit trail: record the decision (accepted / rejected) with its reason.
  if (doc) {
    await documentReviewModel.log({
      applicantId: doc.applicantId,
      applicationId: doc.applicationId,
      docType: doc.type,
      docName: doc.name,
      filename: doc.filename,
      action: status === 'verified' ? 'accepted' : 'rejected',
      remarks: doc.remarks,
      actor: doc.reviewedByName,
    });
  }
  return doc;
}

/**
 * Re-derives `applicants.documents`, the stored count shown on the application
 * list and the Step 3 tracker.
 *
 * It was maintained in one place — the upload route — by counting rows after an
 * insert. Anything else that created a document left the number behind, which is
 * what happened as soon as Steps 1 and 2 began filing their own forms. Counting
 * belongs next to the rows being counted.
 *
 * @param {number} applicantId
 * @returns {Promise<number>} the count now stored
 */
async function syncCount(applicantId) {
  const [rows] = await pool.execute(
    'SELECT COUNT(*) AS c FROM documents WHERE applicant_id = ?', [applicantId]
  );
  const count = Number(rows[0].c) || 0;
  await pool.execute('UPDATE applicants SET documents = ? WHERE id = ?', [count, applicantId]);
  return count;
}

module.exports = {
  syncCount,
  DOCUMENT_STATUSES,
  review,
  findAll,
  findById,
  removeWhere,
  removeForApplicant,
  removeSameType,
  findFiltered,
  statsGlobal,
  countVerifiedForApplicantIds,
  create,
  findByApplicant,
  findVerifiedByApplicant,
  formatRow,
};
