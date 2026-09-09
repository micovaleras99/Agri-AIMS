/**
 * Per-item answers for the accreditation checklists (steps 2 and 5).
 *
 * The scores the application already stores — step2_selfAssessmentScore and
 * step5_checkedItems — are left exactly as they were, so nothing that reads
 * them changes. These rows sit alongside and answer the question the scores
 * cannot: which requirements were met.
 */

const { pool } = require('../config/database');
const { rowToCamel } = require('../utils/caseConvert');

/**
 * Replaces the answers for one applicant and step.
 *
 * The whole step is written at once inside a transaction: a half-saved
 * checklist would read as "wash area: no" when the question was never reached.
 *
 * @param {number} applicantId
 * @param {number} step               2 or 5
 * @param {Array<{id:string,category?:string,label?:string,facility?:string}>} items
 *        the checklist as presented, in order
 * @param {Record<string, unknown>} body  the submitted form body
 * @param {string} [recordedBy]
 * @returns {Promise<{ saved: number, answered: number }>}
 */
async function saveResponses(applicantId, step, items, body, recordedBy = '') {
  const id = Number(applicantId);
  if (!Number.isInteger(id) || id <= 0) throw new Error('saveResponses: bad applicantId');
  if (!items.length) return { saved: 0, answered: 0 };

  const rows = items.map((item) => [
    id,
    Number(step),
    item.id,
    item.category || '',
    item.label || '',
    item.facility || null,
    body[item.id] === 'on' || body[item.id] === true || body[item.id] === '1' ? 1 : 0,
    recordedBy || '',
  ]);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    // Re-submitting a step replaces its answers rather than accumulating them.
    await conn.execute('DELETE FROM assessment_responses WHERE applicant_id = ? AND step = ?', [id, Number(step)]);
    await conn.query(
      'INSERT INTO assessment_responses ' +
        '(applicant_id, step, item_code, category, label, facility, answer, recorded_by) VALUES ?',
      [rows]
    );
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  return { saved: rows.length, answered: rows.filter((r) => r[6] === 1).length };
}

/**
 * Answers for one applicant and step, in the order they were asked.
 * @returns {Promise<Array<object>>}
 */
async function findByStep(applicantId, step) {
  const [rows] = await pool.execute(
    'SELECT * FROM assessment_responses WHERE applicant_id = ? AND step = ? ORDER BY id',
    [Number(applicantId), Number(step)]
  );
  return rows.map(rowToCamel);
}

/**
 * A lookup of item code to boolean, for re-ticking a form the user is revisiting.
 * @returns {Promise<Record<string, boolean>>}
 */
async function answerMap(applicantId, step) {
  const rows = await findByStep(applicantId, step);
  const map = {};
  for (const r of rows) map[r.itemCode] = r.answer === 1;
  return map;
}

/**
 * The four basic facilities from PDF p.11, as claimed by the applicant in
 * step 2 and as verified by the TWG in step 5.
 *
 * @returns {Promise<Array<{facility:string,claimed:boolean|null,verified:boolean|null}>>}
 */
async function facilityStatus(applicantId) {
  const [rows] = await pool.execute(
    'SELECT facility, step, answer FROM assessment_responses ' +
      'WHERE applicant_id = ? AND facility IS NOT NULL',
    [Number(applicantId)]
  );
  const byFacility = {};
  for (const r of rows) {
    byFacility[r.facility] = byFacility[r.facility] || { claimed: null, verified: null };
    if (r.step === 2) byFacility[r.facility].claimed = r.answer === 1;
    if (r.step === 5) byFacility[r.facility].verified = r.answer === 1;
  }
  return byFacility;
}

/** Removes every answer for an applicant (used when an application is deleted). */
async function removeForApplicant(applicantId) {
  await pool.execute('DELETE FROM assessment_responses WHERE applicant_id = ?', [Number(applicantId)]);
}

module.exports = { saveResponses, findByStep, answerMap, facilityStatus, removeForApplicant };
