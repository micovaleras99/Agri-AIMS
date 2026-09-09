/**
 * Applicant model — all SQL uses prepared statements (placeholders).
 */

const { query, pool } = require('../config/database');
const { rowToCamel, normalizeApplicantForView } = require('../utils/caseConvert');
const documentModel = require('./documentModel');
const locationModel = require('./locationModel');
const { likeTerm } = require('../utils/search');

const CAMEL_TO_COL = {
  // Some route handlers still pass legacy snake_case keys from the old JSON shape:
  step1_brieferSigned: 'step1_briefer_signed',
  step1_brieferDate: 'step1_briefer_date',
  step1_acknowledgedBy: 'step1_acknowledged_by',
  step1_signatureFile: 'step1_signature_file',
  step2_selfAssessmentScore: 'step2_self_assessment_score',
  step2_qualified: 'step2_qualified',
  step2_completedDate: 'step2_completed_date',
  step2_remarks: 'step2_remarks',
  step3_submittedDate: 'step3_submitted_date',
  step3_docsSubmitted: 'step3_docs_submitted',
  step3_docsRequired: 'step3_docs_required',
  step3_receivedBy: 'step3_received_by',
  step4_evalDate: 'step4_eval_date',
  step4_evalResult: 'step4_eval_result',
  step4_evalRemarks: 'step4_eval_remarks',
  step4_evalBy: 'step4_eval_by',
  step5_validationDate: 'step5_validation_date',
  step5_validationType: 'step5_validation_type',
  step5_validationResult: 'step5_validation_result',
  step5_checkedItems: 'step5_checked_items',
  step5_twgRemarks: 'step5_twg_remarks',
  step5_inspectedBy: 'step5_inspected_by',
  step6_endorsedDate: 'step6_endorsed_date',
  step6_endorsedBy: 'step6_endorsed_by',
  step6_endorsementNo: 'step6_endorsement_no',
  step6_endorseRemarks: 'step6_endorse_remarks',
  step7_certificateNo: 'step7_certificate_no',
  step7_issueDate: 'step7_issue_date',
  step7_validUntil: 'step7_valid_until',
  step7_moaDate: 'step7_moa_date',
  step7_issuedBy: 'step7_issued_by',
  step7_moaRemarks: 'step7_moa_remarks',

  applicationId: 'application_id',
  firstName: 'first_name',
  lastName: 'last_name',
  email: 'email',
  phone: 'phone',
  rsbsaNumber: 'rsbsa_number',
  farmName: 'farm_name',
  farmArea: 'farm_area',
  farmAddress: 'farm_address',
  region: 'region',
  province: 'province',
  municipality: 'municipality',
  barangayId: 'barangay_id',
  lsaType: 'lsa_type',
  category: 'category',
  classification: 'classification',
  status: 'status',
  progress: 'progress',
  submissionDate: 'submission_date',
  accreditationStep: 'accreditation_step',
  documents: 'documents',
  totalDocs: 'total_docs',
  notDisqualified: 'not_disqualified',
  disqualificationDeclaredAt: 'disqualification_declared_at',
  assistanceType: 'assistance_type',
  latitude: 'latitude',
  longitude: 'longitude',
  geoTaggedBy: 'geo_tagged_by',
  geoTaggedDate: 'geo_tagged_date',
  geoTagStatus: 'geo_tag_status',
  step1BrieferSigned: 'step1_briefer_signed',
  step1BrieferDate: 'step1_briefer_date',
  step1AcknowledgedBy: 'step1_acknowledged_by',
  step1SignatureFile: 'step1_signature_file',
  step2SelfAssessmentScore: 'step2_self_assessment_score',
  step2Qualified: 'step2_qualified',
  step2CompletedDate: 'step2_completed_date',
  step2Remarks: 'step2_remarks',
  step3SubmittedDate: 'step3_submitted_date',
  step3DocsSubmitted: 'step3_docs_submitted',
  step3DocsRequired: 'step3_docs_required',
  step3ReceivedBy: 'step3_received_by',
  step4EvalDate: 'step4_eval_date',
  step4EvalResult: 'step4_eval_result',
  step4EvalRemarks: 'step4_eval_remarks',
  step4EvalBy: 'step4_eval_by',
  step5ValidationDate: 'step5_validation_date',
  step5ValidationType: 'step5_validation_type',
  step5ValidationResult: 'step5_validation_result',
  step5CheckedItems: 'step5_checked_items',
  step5TwgRemarks: 'step5_twg_remarks',
  step5InspectedBy: 'step5_inspected_by',
  step6EndorsedDate: 'step6_endorsed_date',
  step6EndorsedBy: 'step6_endorsed_by',
  step6EndorsementNo: 'step6_endorsement_no',
  step6EndorseRemarks: 'step6_endorse_remarks',
  step7CertificateNo: 'step7_certificate_no',
  step7IssueDate: 'step7_issue_date',
  step7ValidUntil: 'step7_valid_until',
  step7MoaDate: 'step7_moa_date',
  step7IssuedBy: 'step7_issued_by',
  step7MoaRemarks: 'step7_moa_remarks',
};

const SELECT_BASE = `
  SELECT id, application_id, first_name, last_name, email, phone, rsbsa_number, farm_name, farm_area, farm_address,
         region, province, municipality, barangay_id, lsa_type, category, assistance_type, classification, status, progress,
         submission_date, accreditation_step, documents, total_docs, latitude, longitude,
         geo_tagged_by, geo_tagged_date, geo_tag_status,
         step1_briefer_signed, step1_briefer_date, step1_acknowledged_by, step1_signature_file,
         not_disqualified, disqualification_declared_at,
         step2_self_assessment_score, step2_qualified, step2_completed_date, step2_remarks,
         step3_submitted_date, step3_docs_submitted, step3_docs_required, step3_received_by,
         step4_eval_date, step4_eval_result, step4_eval_remarks, step4_eval_by,
         step5_validation_date, step5_validation_type, step5_validation_result, step5_checked_items,
         step5_twg_remarks, step5_inspected_by,
         step6_endorsed_date, step6_endorsed_by, step6_endorsement_no, step6_endorse_remarks,
         step7_certificate_no, step7_issue_date, step7_valid_until, step7_moa_date, step7_issued_by, step7_moa_remarks,
         created_at, updated_at
  FROM applicants
`;

function formatRow(row) {
  if (!row) return null;
  const camel = rowToCamel(row);
  return normalizeApplicantForView(camel);
}

function coerceValue(col, val) {
  if (val === undefined) return undefined;
  const boolCols = new Set(['step1_briefer_signed', 'step2_qualified']);
  if (boolCols.has(col)) {
    if (val === null) return null;
    return val ? 1 : 0;
  }
  return val;
}

function buildPatch(camelPartial) {
  const sets = [];
  const values = [];
  for (const [camel, val] of Object.entries(camelPartial)) {
    const col = CAMEL_TO_COL[camel];
    if (!col || val === undefined) continue;
    const coerced = coerceValue(col, val);
    sets.push(`\`${col}\` = ?`);
    values.push(coerced);
  }
  return { sets, values };
}

async function findAll() {
  const rows = await query(`${SELECT_BASE} ORDER BY id ASC`);
  return rows.map(formatRow);
}

async function findFiltered(filters = {}) {
  const clauses = [];
  const params = [];

  if (filters.status) {
    clauses.push('status = ?');
    params.push(filters.status);
  }
  if (filters.province) {
    clauses.push('province = ?');
    params.push(filters.province);
  }
  if (filters.barangayId) {
    clauses.push('barangay_id = ?');
    params.push(filters.barangayId);
  }
  if (filters.applicationId) {
    clauses.push('application_id = ?');
    params.push(filters.applicationId);
  }
  if (filters.search) {
    const q = likeTerm(filters.search);
    // CONCAT_WS matters: the page prints "Juan Dela Cruz", but the name is two
    // columns, so searching exactly what is on screen matched neither of them
    // and returned nothing.
    clauses.push(
      `(CONCAT_WS(' ', first_name, last_name) LIKE ?
        OR first_name LIKE ? OR last_name LIKE ?
        OR farm_name LIKE ? OR application_id LIKE ? OR email LIKE ?)`
    );
    params.push(q, q, q, q, q, q);
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = await query(`${SELECT_BASE} ${where} ORDER BY submission_date DESC, id DESC`, params);
  return rows.map(formatRow);
}

async function findDistinctProvinces() {
  const rows = await query(
    'SELECT DISTINCT province FROM applicants WHERE province IS NOT NULL AND province <> "" ORDER BY province ASC'
  );
  // Every province in the region, not only the ones that already have an
  // applicant — see locationModel.provinceFilterOptions.
  return locationModel.provinceFilterOptions(rows.map((r) => r.province));
}

async function findById(id) {
  const rows = await query(`${SELECT_BASE} WHERE id = ? LIMIT 1`, [id]);
  return formatRow(rows[0]);
}

async function findByApplicationId(applicationId) {
  const rows = await query(`${SELECT_BASE} WHERE application_id = ? LIMIT 1`, [applicationId]);
  return formatRow(rows[0]);
}

async function countAll() {
  const rows = await query('SELECT COUNT(*) AS c FROM applicants');
  return rows[0].c;
}

async function emailExists(email, excludeId = null) {
  const sql = excludeId
    ? 'SELECT id FROM applicants WHERE email = ? AND id <> ? LIMIT 1'
    : 'SELECT id FROM applicants WHERE email = ? LIMIT 1';
  const params = excludeId ? [email, excludeId] : [email];
  const rows = await query(sql, params);
  return rows.length > 0;
}

async function create(data, opts = {}) {
  const executor = opts.connection || pool;
  const sql = `
    INSERT INTO applicants (
      application_id, first_name, last_name, email, phone, rsbsa_number, farm_name, farm_area, farm_address,
      region, province, municipality, barangay_id, lsa_type, category, assistance_type, classification, status, progress,
      submission_date, accreditation_step, documents, total_docs
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `;
  const params = [
    data.applicationId,
    data.firstName,
    data.lastName,
    data.email,
    data.phone,
    data.rsbsaNumber || '',
    data.farmName,
    data.farmArea,
    data.farmAddress,
    data.region,
    data.province,
    data.municipality,
    data.barangayId ?? null,
    data.lsaType,
    data.category,
    data.assistanceType || '',
    data.classification,
    data.status,
    data.progress,
    data.submissionDate,
    data.accreditationStep,
    data.documents,
    data.totalDocs,
  ];
  const [result] = await executor.execute(sql, params);
  return result.insertId;
}

async function update(id, data) {
  const sql = `
    UPDATE applicants SET
      first_name = ?, last_name = ?, email = ?, phone = ?, farm_name = ?, farm_area = ?,
      farm_address = ?, region = ?, province = ?, municipality = ?, barangay_id = ?, lsa_type = ?, category = ?,
      classification = ?, status = ?, total_docs = ?, assistance_type = ?, rsbsa_number = ?
    WHERE id = ?
  `;
  await query(sql, [
    data.firstName,
    data.lastName,
    data.email,
    data.phone,
    data.farmName,
    data.farmArea,
    data.farmAddress,
    data.region,
    data.province,
    data.municipality,
    data.barangayId ?? null,
    data.lsaType,
    data.category,
    data.classification,
    data.status,
    data.totalDocs,
    data.assistanceType || '',
    data.rsbsaNumber || '',
    id,
  ]);
}

async function patch(id, camelPartial) {
  const { sets, values } = buildPatch(camelPartial);
  if (!sets.length) return;
  const sql = `UPDATE applicants SET ${sets.join(', ')} WHERE id = ?`;
  await query(sql, [...values, id]);
}

async function remove(id) {
  // documents.applicant_id cascades, so the rows go by themselves — but the
  // uploaded files would be left on disk with nothing referencing them.
  // Remove them first, while we can still read their stored names.
  await documentModel.removeForApplicant(id);
  await query('DELETE FROM applicants WHERE id = ?', [id]);
}

async function findGeoTagged() {
  const rows = await query(
    `${SELECT_BASE} WHERE latitude IS NOT NULL AND longitude IS NOT NULL ORDER BY id ASC`
  );
  return rows.map(formatRow);
}

async function findGeoPendingStatuses() {
  const rows = await query(
    `${SELECT_BASE}
     WHERE (latitude IS NULL OR longitude IS NULL)
       AND status IN ('under_review','document_review','submitted')
     ORDER BY id ASC`
  );
  return rows.map(formatRow);
}

async function listIdNamePairs() {
  const rows = await query(
    'SELECT id, application_id, first_name, last_name FROM applicants ORDER BY id ASC'
  );
  return rows.map((r) => ({
    id: r.id,
    applicationId: r.application_id,
    firstName: r.first_name,
    lastName: r.last_name,
  }));
}

async function nextApplicantId() {
  const rows = await query('SELECT MAX(id) AS m FROM applicants');
  return (rows[0].m || 0) + 1;
}

module.exports = {
  findAll,
  findFiltered,
  findDistinctProvinces,
  findById,
  findByApplicationId,
  countAll,
  emailExists,
  create,
  update,
  patch,
  remove,
  findGeoTagged,
  findGeoPendingStatuses,
  listIdNamePairs,
  formatRow,
  nextApplicantId,
};
