/**
 * Compliance monitoring (RSC-05).
 *
 * The current status of a requirement for a farm is the most recent check
 * recorded against it; older checks stay as the audit trail.
 */

const { query, pool } = require('../config/database');
const classifications = require('../config/classifications');
const { rowToCamel } = require('../utils/caseConvert');

const STATUSES = ['compliant', 'partial', 'non_compliant', 'not_applicable', 'pending'];

const STATUS_LABELS = {
  compliant: 'Compliant',
  partial: 'Partially compliant',
  non_compliant: 'Not compliant',
  not_applicable: 'Not applicable',
  pending: 'Not yet checked',
};

const CATEGORY_LABELS = {
  facilities: 'Farm facilities',
  operations: 'Operations',
  records_reporting: 'Records and reporting',
  capability: 'Capability building',
  assistance: 'Assistance conditions',
};

function toDateString(v) {
  return v instanceof Date ? v.toISOString().split('T')[0] : v;
}

async function findRequirements({ appliesTo } = {}) {
  const clauses = ['is_active = 1'];
  const params = [];
  if (appliesTo && appliesTo !== 'all') {
    clauses.push('(applies_to = ? OR applies_to = ?)');
    params.push(appliesTo, 'all');
  }
  const rows = await query(
    `SELECT id, code, title, description, source_reference, category, applies_to, frequency, sort_order
       FROM compliance_requirements
      WHERE ${clauses.join(' AND ')}
      ORDER BY sort_order ASC, id ASC`,
    params
  );
  return rows.map((r) => {
    const o = rowToCamel(r);
    o.categoryLabel = CATEGORY_LABELS[o.category] || o.category;
    return o;
  });
}

/**
 * Requirements for one farm, each carrying its latest check.
 * @param {number} farmId
 * @param {string} [appliesTo] 'farming' | 'agri_processing'
 */
async function findChecklistForFarm(farmId, appliesTo = 'all') {
  const requirements = await findRequirements({ appliesTo });

  const rows = await query(
    `SELECT c.*, u.first_name, u.last_name
       FROM compliance_checks c
       LEFT JOIN users u ON u.id = c.checked_by
      WHERE c.farm_id = ?
        AND c.id = (SELECT MAX(c2.id) FROM compliance_checks c2
                     WHERE c2.farm_id = c.farm_id AND c2.requirement_id = c.requirement_id)`,
    [farmId]
  );

  const latest = new Map();
  for (const r of rows) {
    const o = rowToCamel(r);
    o.checkedAt = toDateString(o.checkedAt);
    o.nextCheckDate = toDateString(o.nextCheckDate);
    o.checkedByName = o.firstName ? `${o.firstName} ${o.lastName}` : null;
    o.statusLabel = STATUS_LABELS[o.status] || o.status;
    latest.set(o.requirementId, o);
  }

  return requirements.map((req) => ({
    ...req,
    check: latest.get(req.id) || null,
    status: latest.get(req.id) ? latest.get(req.id).status : 'pending',
    statusLabel: latest.get(req.id) ? latest.get(req.id).statusLabel : STATUS_LABELS.pending,
  }));
}

/**
 * Compliance score = compliant items as a share of the items that apply.
 * "Not applicable" is excluded rather than counted against the farm.
 */
function scoreFor(checklist) {
  const applicable = checklist.filter((c) => c.status !== 'not_applicable');
  if (!applicable.length) return { score: 0, compliant: 0, applicable: 0, pending: 0, findings: 0 };
  const compliant = applicable.filter((c) => c.status === 'compliant').length;
  const partial = applicable.filter((c) => c.status === 'partial').length;
  const pending = applicable.filter((c) => c.status === 'pending').length;
  const findings = applicable.filter((c) => c.status === 'non_compliant' || c.status === 'partial').length;
  return {
    // A partial counts as half — it is progress, not compliance.
    score: Math.round(((compliant + partial * 0.5) / applicable.length) * 100),
    compliant,
    applicable: applicable.length,
    pending,
    findings,
  };
}

async function recordCheck(data) {
  const [res] = await pool.execute(
    `INSERT INTO compliance_checks
       (requirement_id, farm_id, applicant_id, status, checked_at, checked_by,
        evidence_document_id, remarks, corrective_action, next_check_date)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [
      data.requirementId,
      data.farmId ?? null,
      data.applicantId ?? null,
      STATUSES.includes(data.status) ? data.status : 'pending',
      data.checkedAt || new Date().toISOString().split('T')[0],
      data.checkedBy ?? null,
      data.evidenceDocumentId ?? null,
      data.remarks || '',
      data.correctiveAction || '',
      data.nextCheckDate || null,
    ]
  );
  return res.insertId;
}

async function findRequirementById(id) {
  const rows = await query(
    'SELECT id, code, title, description, source_reference, category, applies_to, frequency FROM compliance_requirements WHERE id = ? LIMIT 1',
    [id]
  );
  return rows[0] ? rowToCamel(rows[0]) : null;
}

/** History for one requirement on one farm, newest first. */
async function findHistory(farmId, requirementId, limit = 10) {
  const rows = await query(
    `SELECT c.*, u.first_name, u.last_name
       FROM compliance_checks c
       LEFT JOIN users u ON u.id = c.checked_by
      WHERE c.farm_id = ? AND c.requirement_id = ?
      ORDER BY c.id DESC
      LIMIT ?`,
    [farmId, requirementId, Math.min(50, Math.max(1, Number(limit) || 10))]
  );
  return rows.map((r) => {
    const o = rowToCamel(r);
    o.checkedAt = toDateString(o.checkedAt);
    o.nextCheckDate = toDateString(o.nextCheckDate);
    o.checkedByName = o.firstName ? `${o.firstName} ${o.lastName}` : null;
    o.statusLabel = STATUS_LABELS[o.status] || o.status;
    return o;
  });
}

/** One row per farm with its score — the monitoring overview. */
async function findFarmSummaries() {
  const farms = await query(
    `SELECT f.id, f.name, f.operator, f.classification, f.municipality, f.province, f.status,
            f.applicant_id, f.expiry_date
       FROM farms f
      ORDER BY f.name ASC`
  );

  const summaries = [];
  for (const f of farms) {
    const appliesTo = classifications.appliesTo(f.classification);
    const checklist = await findChecklistForFarm(f.id, appliesTo);
    const score = scoreFor(checklist);
    const withDates = checklist.filter((c) => c.check && c.check.nextCheckDate).map((c) => c.check.nextCheckDate).sort();
    const lastChecked = checklist
      .filter((c) => c.check && c.check.checkedAt)
      .map((c) => c.check.checkedAt)
      .sort()
      .pop() || null;

    summaries.push({
      ...rowToCamel(f),
      expiryDate: toDateString(f.expiry_date),
      appliesTo,
      ...score,
      nextCheckDate: withDates[0] || null,
      lastChecked,
    });
  }
  return summaries;
}

/**
 * Recompute a farm's stored compliance score from its recorded checks.
 *
 * farms.compliance_score used to be seed data that no code ever updated, so
 * the Farms list showed 95% for a farm with no checks at all. It is now a
 * cache of what scoreFor() says, refreshed on every check, and NULL until
 * somebody has actually assessed the farm.
 *
 * @param {number} farmId
 * @param {string} appliesTo 'farming' or 'agri_processing'
 * @returns {Promise<number|null>} the stored score, or null if unassessed
 */
async function recomputeFarmScore(farmId, appliesTo) {
  const checklist = await findChecklistForFarm(farmId, appliesTo);
  const summary = scoreFor(checklist);

  // Every requirement still pending means nobody has assessed this farm.
  // Writing 0 would read as "assessed, met nothing", which is a different and
  // much worse claim to make about someone's farm.
  const assessed = summary.applicable > 0 && summary.pending < summary.applicable;
  const value = assessed ? summary.score : null;

  await pool.execute('UPDATE farms SET compliance_score = ? WHERE id = ?', [value, farmId]);
  return value;
}

module.exports = {
  STATUSES,
  STATUS_LABELS,
  CATEGORY_LABELS,
  findRequirements,
  findChecklistForFarm,
  findRequirementById,
  findHistory,
  findFarmSummaries,
  recordCheck,
  scoreFor,
  recomputeFarmScore,
};
