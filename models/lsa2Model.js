/**
 * LSA I → LSA II up-scaling applications.
 *
 * Eligibility evidence is gathered here rather than in the route, because both
 * the "can this farm apply?" screen and the application screen need the same
 * counts and must not disagree.
 */

const { query, pool } = require('../config/database');
const { rowToCamel } = require('../utils/caseConvert');
const { evaluateEligibility } = require('../config/lsa2');

const SELECT_BASE = 'SELECT * FROM lsa2_applications';

const formatRow = (row) => (row ? rowToCamel(row) : null);

async function findByFarm(farmId) {
  const rows = await query(`${SELECT_BASE} WHERE farm_id = ? LIMIT 1`, [Number(farmId)]);
  return formatRow(rows[0]);
}

async function findById(id) {
  const rows = await query(`${SELECT_BASE} WHERE id = ? LIMIT 1`, [Number(id)]);
  return formatRow(rows[0]);
}

async function findAll() {
  const rows = await query(`${SELECT_BASE} ORDER BY id DESC`);
  return rows.map(formatRow);
}

/**
 * Counts that back the two automatic criteria on PDF p.16.
 * @returns {Promise<{approvedReports:number, completedTrainings:number}>}
 */
async function evidenceFor(farm) {
  const [[reports]] = await pool.execute(
    "SELECT COUNT(*) AS c FROM reports WHERE farm_id = ? AND status = 'approved'",
    [Number(farm.id)]
  );
  const [[trainings]] = await pool.execute(
    'SELECT COUNT(*) AS c FROM service_participants WHERE applicant_id = ? AND completed_at IS NOT NULL',
    [Number(farm.applicantId) || 0]
  );
  return { approvedReports: reports.c, completedTrainings: trainings.c };
}

/** Full eligibility picture for a farm, including any recorded ATI judgements. */
async function eligibilityFor(farm) {
  const application = await findByFarm(farm.id);
  const evidence = await evidenceFor(farm);
  const decisions = {
    competenceEnhanced: application && application.competenceEnhanced !== null
      ? application.competenceEnhanced === 1 : undefined,
    valueChainCovered: application && application.valueChainCovered !== null
      ? application.valueChainCovered === 1 : undefined,
  };
  return { ...evaluateEligibility(farm, evidence, decisions), evidence, application };
}

/** Creates the up-scaling application. Reference mirrors the LSA I format. */
async function create({ applicantId, farmId }) {
  const year = new Date().getFullYear();
  const [[mx]] = await pool.query('SELECT COALESCE(MAX(id), 0) AS m FROM lsa2_applications');
  const referenceNo = `LSA2-${year}-${String(Number(mx.m) + 1).padStart(4, '0')}`;
  const [res] = await pool.execute(
    'INSERT INTO lsa2_applications (applicant_id, farm_id, reference_no, step, status, submitted_at) ' +
      "VALUES (?, ?, ?, 1, 'submitted', ?)",
    [Number(applicantId), Number(farmId), referenceNo, new Date().toLocaleDateString('en-CA')]
  );
  return { id: res.insertId, referenceNo };
}

/** Records the two ATI judgements from PDF p.16. */
async function recordAssessment(id, { competenceEnhanced, valueChainCovered, remarks, assessedBy }) {
  await pool.execute(
    'UPDATE lsa2_applications SET competence_enhanced = ?, value_chain_covered = ?, ' +
      'eligibility_remarks = ?, assessed_by = ?, assessed_at = ? WHERE id = ?',
    [
      competenceEnhanced === null ? null : competenceEnhanced ? 1 : 0,
      valueChainCovered === null ? null : valueChainCovered ? 1 : 0,
      remarks || null,
      assessedBy || null,
      new Date().toLocaleDateString('en-CA'),
      Number(id),
    ]
  );
}

/** Column written when each step of the PDF p.21 procedure completes. */
const STEP_FIELDS = {
  2: { date: 'evaluated_at', by: 'evaluated_by', status: 'under_evaluation' },
  3: { date: 'validated_at', by: 'validated_by', status: 'validated' },
  4: { date: 'endorsed_at', by: 'endorsed_by', status: 'endorsed' },
  5: { date: 'certified_at', by: null, status: 'certified' },
};

/**
 * Advances an application to `step`, stamping who did it and when.
 * @returns {Promise<boolean>} false when the step is not a real transition
 */
async function advance(id, step, { by, remarks, certificateNo } = {}) {
  const field = STEP_FIELDS[step];
  if (!field) return false;

  const sets = ['step = ?', 'status = ?', `${field.date} = ?`];
  const params = [step, field.status, new Date().toLocaleDateString('en-CA')];
  if (field.by) { sets.push(`${field.by} = ?`); params.push(by || null); }
  if (remarks) { sets.push('remarks = ?'); params.push(remarks); }
  if (step === 5 && certificateNo) { sets.push('certificate_no = ?'); params.push(certificateNo); }

  params.push(Number(id));
  const [res] = await pool.execute(
    `UPDATE lsa2_applications SET ${sets.join(', ')} WHERE id = ?`,
    params
  );
  return res.affectedRows === 1;
}

async function remove(id) {
  await pool.execute('DELETE FROM lsa2_applications WHERE id = ?', [Number(id)]);
}

module.exports = {
  findAll, findById, findByFarm, evidenceFor, eligibilityFor,
  create, recordAssessment, advance, remove, STEP_FIELDS,
};
