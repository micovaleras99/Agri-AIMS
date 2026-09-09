/**
 * Location hierarchy: Region → Province → Municipality/City → Barangay.
 * Backs the cascading address selectors and lets reports group by real
 * administrative units instead of free-typed text.
 */

const { query } = require('../config/database');
const { rowToCamel } = require('../utils/caseConvert');

async function findRegions() {
  const rows = await query(
    'SELECT id, psgc_code, name FROM regions ORDER BY name ASC'
  );
  return rows.map(rowToCamel);
}

async function findProvinces(regionId) {
  const rows = await query(
    'SELECT id, psgc_code, region_id, name FROM provinces WHERE region_id = ? ORDER BY name ASC',
    [regionId]
  );
  return rows.map(rowToCamel);
}

async function findMunicipalities(provinceId) {
  const rows = await query(
    'SELECT id, psgc_code, province_id, name, type FROM municipalities WHERE province_id = ? ORDER BY name ASC',
    [provinceId]
  );
  return rows.map(rowToCamel);
}

async function findBarangays(municipalityId) {
  const rows = await query(
    'SELECT id, psgc_code, municipality_id, name FROM barangays WHERE municipality_id = ? ORDER BY name ASC',
    [municipalityId]
  );
  return rows.map(rowToCamel);
}

/**
 * Full ancestry for one barangay — used to pre-select the cascading dropdowns
 * when editing an existing record, and to render a complete address.
 * @param {number} barangayId
 */
async function findAncestry(barangayId) {
  const rows = await query(
    `SELECT b.id   AS barangay_id,   b.name AS barangay_name,
            m.id   AS municipality_id, m.name AS municipality_name, m.type AS municipality_type,
            p.id   AS province_id,   p.name AS province_name,
            r.id   AS region_id,     r.name AS region_name
     FROM barangays b
     JOIN municipalities m ON m.id = b.municipality_id
     JOIN provinces p      ON p.id = m.province_id
     JOIN regions r        ON r.id = p.region_id
     WHERE b.id = ?
     LIMIT 1`,
    [barangayId]
  );
  if (!rows[0]) return null;
  return rowToCamel(rows[0]);
}

/**
 * The region, province and municipality names that a barangay implies.
 *
 * `applicants` and `farms` keep those three as plain VARCHARs beside
 * `barangay_id`, because the list filters group on them and because the
 * barangay is optional — an application filed without one still has to say
 * where it is. They are a cache of this hierarchy, and a cache that anyone can
 * type into drifts: one seeded farm was already recording its municipality as
 * "Sorsogon City" while its own barangay said "City of Sorsogon".
 *
 * So wherever a record carries a barangay, these names are derived here rather
 * than taken from the form. Returns null when there is no barangay to derive
 * from, and the caller keeps whatever was typed.
 *
 * @param {number|null} barangayId
 * @returns {Promise<{region: string, province: string, municipality: string}|null>}
 */
async function placeNamesFor(barangayId) {
  if (!barangayId) return null;
  const a = await findAncestry(barangayId);
  if (!a) return null;
  return {
    region: a.regionName,
    province: a.provinceName,
    municipality: a.municipalityName,
  };
}

/** Confirms a barangay id exists before it is written to applicants/farms/users. */
async function barangayExists(barangayId) {
  const rows = await query('SELECT id FROM barangays WHERE id = ? LIMIT 1', [barangayId]);
  return rows.length > 0;
}

/**
 * Type-ahead across barangays, returning the whole address line so two barangays
 * with the same name in different towns stay distinguishable.
 * @param {string} term
 * @param {number} [limit]
 */
async function searchBarangays(term, limit = 20) {
  const capped = Math.min(50, Math.max(1, Number(limit) || 20));
  const like = `%${String(term).trim()}%`;
  const rows = await query(
    `SELECT b.id, b.name AS barangay_name, m.name AS municipality_name,
            p.name AS province_name, r.name AS region_name
     FROM barangays b
     JOIN municipalities m ON m.id = b.municipality_id
     JOIN provinces p      ON p.id = m.province_id
     JOIN regions r        ON r.id = p.region_id
     WHERE b.name LIKE ?
     ORDER BY b.name ASC
     LIMIT ?`,
    [like, capped]
  );
  return rows.map(rowToCamel);
}

/**
 * Every province the address data knows about.
 *
 * Filters were built from the provinces that happened to appear on existing
 * rows, so a region with six provinces offered three, and a user filtering for
 * Catanduanes could not tell "no applicants there" from "the filter is
 * broken". A filter should describe the region, not the current contents.
 */
async function findAllProvinceNames() {
  const rows = await query('SELECT name FROM provinces ORDER BY name ASC');
  return rows.map((r) => r.name);
}

/**
 * The province list to offer in a filter: everywhere in the region, plus
 * anything actually recorded on the rows.
 *
 * The second half matters. Addresses predating the PSGC tables, or typed by
 * hand, may not match a province in the list — dropping them would make those
 * records impossible to filter for at all.
 *
 * @param {string[]} recorded province values present on the rows being filtered
 */
async function provinceFilterOptions(recorded = []) {
  const all = await findAllProvinceNames();
  const merged = new Set(all);
  for (const p of recorded) if (p) merged.add(p);
  return [...merged].sort((a, b) => a.localeCompare(b));
}

module.exports = {
  findAllProvinceNames,
  provinceFilterOptions,
  findRegions,
  findProvinces,
  findMunicipalities,
  findBarangays,
  findAncestry,
  placeNamesFor,
  barangayExists,
  searchBarangays,
};
