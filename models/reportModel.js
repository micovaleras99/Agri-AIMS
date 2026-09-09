/**
 * Semestral monitoring reports per farm.
 */

const { query, pool } = require('../config/database');
const { rowToCamel } = require('../utils/caseConvert');

/** The two decisions ATI can record on a submitted report. */
const DECIDABLE = ['approved', 'returned'];

const SELECT_BASE = `
  SELECT id, farm_id, farm_name, operator, period, submission_date, visitors, training_sessions,
         tech_demos, status, remarks, reviewed_by, reviewed_at, created_at, updated_at
  FROM reports
`;

function formatRow(row) {
  if (!row) return null;
  const o = rowToCamel(row);
  if (o.submissionDate instanceof Date) {
    o.submissionDate = o.submissionDate.toISOString().split('T')[0];
  }
  return o;
}

async function findAll() {
  const rows = await query(`${SELECT_BASE} ORDER BY submission_date DESC, id DESC`);
  return rows.map(formatRow);
}

async function findById(id) {
  const rows = await query(`${SELECT_BASE} WHERE id = ? LIMIT 1`, [id]);
  return formatRow(rows[0]);
}

async function findByFarmId(farmId) {
  const rows = await query(`${SELECT_BASE} WHERE farm_id = ? ORDER BY submission_date DESC`, [farmId]);
  return rows.map(formatRow);
}

async function findFiltered({ farmId } = {}) {
  if (farmId == null) return findAll();
  return findByFarmId(farmId);
}

/**
 * Re-derives farms.visitors_this_year and farms.training_sessions from the
 * reports themselves.
 *
 * Those two columns are shown on the operator dashboard, the farm record and
 * the directory as "Visitors This Year" and "Training Sessions", and nothing in
 * the application had ever written them — they held whatever the seed put
 * there, so a farm accredited through the system displayed 0 for ever, however
 * many reports its operator filed.
 *
 * Re-derived rather than incremented: a recount is idempotent, so a report
 * corrected or removed later cannot leave the counters drifting, and running
 * this over an existing farm repairs it.
 */
async function syncFarmCounters(farmId) {
  await query(
    `UPDATE farms f SET
       f.visitors_this_year = (SELECT COALESCE(SUM(r.visitors), 0) FROM reports r
                                WHERE r.farm_id = f.id AND YEAR(r.submission_date) = YEAR(CURDATE())),
       f.training_sessions  = (SELECT COALESCE(SUM(r.training_sessions), 0) FROM reports r
                                WHERE r.farm_id = f.id AND YEAR(r.submission_date) = YEAR(CURDATE()))
     WHERE f.id = ?`,
    [farmId]
  );
}

/**
 * Files one report. Returns null if that farm has already filed that period.
 *
 * The route checks the same thing against the farm's calendar; this catches the
 * race and anything that reaches the model another way. Duplicates mattered
 * because syncFarmCounters sums every row, so each one inflated the farm's
 * visitor and training totals.
 */
async function create(r) {
  let res;
  try {
    [res] = await pool.execute(
      `INSERT INTO reports
         (farm_id, farm_name, operator, period, submission_date, visitors, training_sessions, tech_demos, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
      [r.farmId, r.farmName, r.operator, r.period, r.submissionDate,
       r.visitors, r.trainingSessions, r.techDemos]
    );
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return null;
    throw err;
  }
  await syncFarmCounters(r.farmId);
  return res.insertId;
}

/**
 * ATI's decision on a submitted report.
 *
 * Nothing could write 'approved' before this existed: reports were created
 * 'pending' and stayed there for ever, while the Reports page counted approved
 * ones and models/lsa2Model counted them as an up-scaling criterion — so no
 * farm could satisfy that criterion however many reports it filed.
 *
 * A return carries its reason for the same reason a returned document does:
 * "your report was rejected" with no remarks tells the operator nothing to act on.
 *
 * @param {number} id
 * @param {{status: 'approved'|'returned', remarks?: string, reviewerName?: string}} decision
 * @returns {Promise<object|null>} the decided report, or null if refused
 */
async function decide(id, decision) {
  const status = decision.status;
  if (!DECIDABLE.includes(status)) return null;
  const remarks = String(decision.remarks || '').trim();
  if (status === 'returned' && !remarks) return null;

  const [res] = await pool.execute(
    `UPDATE reports
        SET status = ?, remarks = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
    [status, remarks, decision.reviewerName || null, id]
  );
  if (!res.affectedRows) return null;
  return findById(id);
}

module.exports = {
  findAll,
  findById,
  decide,
  DECIDABLE,
  findByFarmId,
  findFiltered,
  formatRow,
  create,
  syncFarmCounters,
};
