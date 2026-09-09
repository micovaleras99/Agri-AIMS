/**
 * Farm (LSA) records.
 */

const { query, pool } = require('../config/database');
const { rowToCamel } = require('../utils/caseConvert');
const locationModel = require('./locationModel');
const { likeTerm } = require('../utils/search');
const classifications = require('../config/classifications');

const SELECT_BASE = `
  SELECT id, applicant_id, name, operator, region, province, municipality, address, classification,
         lsa_type, accreditation_level, accredited_since, expiry_date, farm_area, compliance_score,
         visitors_this_year, training_sessions, main_crops, latitude, longitude, status,
         created_at, updated_at
  FROM farms
`;

function formatRow(row) {
  if (!row) return null;
  const o = rowToCamel(row);
  if (o.latitude != null) o.latitude = Number(o.latitude);
  if (o.longitude != null) o.longitude = Number(o.longitude);
  if (o.accreditedSince instanceof Date) o.accreditedSince = o.accreditedSince.toISOString().split('T')[0];
  if (o.expiryDate instanceof Date) o.expiryDate = o.expiryDate.toISOString().split('T')[0];
  return o;
}

async function findAll() {
  const rows = await query(`${SELECT_BASE} ORDER BY id ASC`);
  return rows.map(formatRow);
}

async function findById(id) {
  const rows = await query(`${SELECT_BASE} WHERE id = ? LIMIT 1`, [id]);
  return formatRow(rows[0]);
}

/**
 * @param {{ province?: string, classification?: string, search?: string }} filters
 */
async function findFiltered(filters = {}) {
  const clauses = [];
  const params = [];
  if (filters.province) {
    clauses.push('province = ?');
    params.push(filters.province);
  }
  if (filters.classification) {
    clauses.push('classification = ?');
    params.push(filters.classification);
  }
  if (filters.search) {
    const q = likeTerm(filters.search);
    // Province is a column on the page, so it should be searchable from the
    // same box; typing "Albay" found nothing before.
    clauses.push('(name LIKE ? OR operator LIKE ? OR municipality LIKE ? OR province LIKE ?)');
    params.push(q, q, q, q);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = await query(`${SELECT_BASE} ${where} ORDER BY name ASC`, params);
  return rows.map(formatRow);
}

async function findDistinctProvinces() {
  const rows = await query(
    'SELECT DISTINCT province FROM farms WHERE province IS NOT NULL AND province <> "" ORDER BY province'
  );
  // Every province in the region — see locationModel.provinceFilterOptions.
  return locationModel.provinceFilterOptions(rows.map((r) => r.province));
}

async function findDistinctClassifications() {
  const rows = await query(
    'SELECT DISTINCT classification FROM farms WHERE classification IS NOT NULL AND classification <> "" ORDER BY classification'
  );
  // The whole vocabulary, not only what a farm already uses — see
  // config/classifications.js. Returns {value, label} because the column
  // stores keys and the filter has to show words.
  return classifications.filterOptions(rows.map((r) => r.classification));
}

/** Province counts for charts */
async function countByProvince() {
  const rows = await query(
    'SELECT province, COUNT(*) AS cnt FROM farms GROUP BY province ORDER BY province ASC'
  );
  const map = {};
  for (const r of rows) {
    map[r.province] = r.cnt;
  }
  return map;
}

/** Applicant id linked to a farm (for operator document scope) */
async function getApplicantIdForFarm(farmId) {
  const rows = await query('SELECT applicant_id FROM farms WHERE id = ? LIMIT 1', [farmId]);
  if (!rows[0]) return null;
  return rows[0].applicant_id;
}

/** The Learning Site created from one application, if it has been certified. */
async function findByApplicant(applicantId) {
  const rows = await query(`${SELECT_BASE} WHERE applicant_id = ? ORDER BY id ASC LIMIT 1`, [applicantId]);
  return formatRow(rows[0]);
}

/**
 * The Learning Site that a Certificate of Accreditation creates.
 *
 * Until this existed the application ended at Step 7 with a certificate number
 * and nothing else: renewal, the reminder job, LSA II up-scaling, compliance,
 * the public directory and the registry export all read the `farms` table, so
 * a certified site with no row there was invisible to every one of them.
 *
 * Everything is copied from the application rather than re-asked — the farm was
 * named, measured, classified and geo-tagged during Steps 1-5. The level is
 * 'LSA I' because that is what the Step 7 certificate and MOA award; up-scaling
 * to LSA II is a separate procedure with its own criteria.
 *
 * @param {object} applicant
 * @param {{accreditedSince: string, expiryDate: string}} dates  from the certificate
 * @returns {Promise<number>} the new farm id
 */
async function createFromApplicant(applicant, dates) {
  const [res] = await pool.execute(
    `INSERT INTO farms
       (applicant_id, name, operator, region, province, municipality, barangay_id, address,
        classification, lsa_type, accreditation_level, accredited_since, expiry_date,
        farm_area, latitude, longitude, status)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'active')`,
    [
      applicant.id,
      applicant.farmName,
      `${applicant.firstName} ${applicant.lastName}`.trim(),
      applicant.region || '',
      applicant.province || '',
      applicant.municipality || '',
      applicant.barangayId ?? null,
      applicant.farmAddress || '',
      applicant.classification || '',
      applicant.lsaType || '',
      'LSA I',
      dates.accreditedSince,
      dates.expiryDate,
      Number(applicant.farmArea) || 0,
      applicant.latitude ?? null,
      applicant.longitude ?? null,
    ]
  );
  return res.insertId;
}

module.exports = {
  findAll,
  findById,
  findFiltered,
  findDistinctProvinces,
  findDistinctClassifications,
  countByProvince,
  getApplicantIdForFarm,
  findByApplicant,
  createFromApplicant,
  formatRow,
};
