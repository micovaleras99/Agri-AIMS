/**
 * Populates regions → provinces → municipalities → barangays, then backfills
 * barangay_id on applicants and farms from their existing address text.
 *
 *   node scripts/seed-locations.js
 *
 * Two sources, in order of preference:
 *
 * 1. data/psgc.json — the authoritative list. Download the PSGC publication from
 *    the Philippine Statistics Authority (psa.gov.ph) and convert it to:
 *
 *      [
 *        { "psgcCode": "0500000000", "level": "region",       "name": "Region V", "parentCode": null },
 *        { "psgcCode": "0505000000", "level": "province",     "name": "Albay",    "parentCode": "0500000000" },
 *        { "psgcCode": "0505600000", "level": "municipality", "name": "Legazpi City", "parentCode": "0505000000", "type": "city" },
 *        { "psgcCode": "0505601000", "level": "barangay",     "name": "Bitano",   "parentCode": "0505600000" }
 *      ]
 *
 * 2. Fallback — the locations already present in data/applicants.json and
 *    data/farms.json. Enough to run and demo the app; NOT the complete list.
 *    Import the PSGC file before this is used for real accreditation records.
 *
 * Safe to re-run: every insert is an upsert keyed on the parent + name.
 *
 * Pass --strict once the PSGC list is loaded to drop any locally seeded location
 * that is not in it. Records pointing at such a row have their barangay_id
 * cleared, so the dropdowns only ever offer official entries:
 *
 *   npm run seed:locations -- --strict
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const DATA_DIR = path.join(__dirname, '..', 'data');
const PSGC_FILE = path.join(DATA_DIR, 'psgc.json');

/** "Brgy. San Jose, Naga City" → "San Jose" */
function parseBarangay(address) {
  const m = /^\s*(?:Brgy\.?|Barangay|Bgy\.?)\s+([^,]+)/i.exec(String(address || ''));
  return m ? m[1].trim() : null;
}

/**
 * PSGC writes cities as "City of Naga" while local records usually say
 * "Naga City". Reduce both to a comparable key so matching survives either form.
 */
function normalizeName(name) {
  return String(name || '')
    .toLowerCase()
    // Legazpi and similar cities number their barangays: "Bgy. 37 - Bitano (Pob.)"
    // is written "Brgy. Bitano" by everyone else, so drop the number and the
    // Poblacion marker before comparing.
    .replace(/^(?:bgy|brgy|barangay)\.?\s*\d+\s*-\s*/, '')
    .replace(/\(\s*pob\.?\s*\)/g, ' ')
    .replace(/[.\-']/g, ' ')
    .replace(/^city of\s+/, '')
    .replace(/^municipality of\s+/, '')
    .replace(/\s+city$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Cities are flagged by name here; the PSGC file carries an explicit type. */
function guessType(name) {
  return /\bcity\b/i.test(name) ? 'city' : 'municipality';
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** Rows from the project's own seed data, when no PSGC file is present. */
function collectFromSeedData() {
  const records = [];
  for (const file of ['applicants.json', 'farms.json']) {
    const full = path.join(DATA_DIR, file);
    if (!fs.existsSync(full)) continue;
    for (const r of readJson(full)) {
      const barangay = parseBarangay(r.farmAddress || r.address);
      if (!r.region || !r.province || !r.municipality) continue;
      records.push({
        region: String(r.region).trim(),
        province: String(r.province).trim(),
        municipality: String(r.municipality).trim(),
        barangay: barangay ? String(barangay).trim() : null,
      });
    }
  }
  return records;
}

async function upsert(conn, sql, params, selectSql, selectParams) {
  await conn.execute(sql, params);
  const [rows] = await conn.execute(selectSql, selectParams);
  return rows[0] ? rows[0].id : null;
}

async function seedFromPsgc(conn, entries) {
  const byCode = new Map();
  const counts = { region: 0, province: 0, municipality: 0, barangay: 0 };

  const order = ['region', 'province', 'municipality', 'barangay'];
  for (const level of order) {
    for (const e of entries.filter((x) => x.level === level)) {
      const parentId = e.parentCode ? byCode.get(e.parentCode) : null;
      if (level !== 'region' && !parentId) {
        console.warn(`  skipped ${level} "${e.name}" — parent ${e.parentCode} not found`);
        continue;
      }
      let id;
      if (level === 'region') {
        id = await upsert(
          conn,
          'INSERT INTO regions (psgc_code, name) VALUES (?,?) ON DUPLICATE KEY UPDATE psgc_code = VALUES(psgc_code)',
          [e.psgcCode || null, e.name],
          'SELECT id FROM regions WHERE name = ? LIMIT 1',
          [e.name]
        );
      } else if (level === 'province') {
        id = await upsert(
          conn,
          'INSERT INTO provinces (psgc_code, region_id, name) VALUES (?,?,?) ON DUPLICATE KEY UPDATE psgc_code = VALUES(psgc_code)',
          [e.psgcCode || null, parentId, e.name],
          'SELECT id FROM provinces WHERE region_id = ? AND name = ? LIMIT 1',
          [parentId, e.name]
        );
      } else if (level === 'municipality') {
        id = await upsert(
          conn,
          'INSERT INTO municipalities (psgc_code, province_id, name, type) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE psgc_code = VALUES(psgc_code), type = VALUES(type)',
          [e.psgcCode || null, parentId, e.name, e.type || guessType(e.name)],
          'SELECT id FROM municipalities WHERE province_id = ? AND name = ? LIMIT 1',
          [parentId, e.name]
        );
      } else {
        // Two barangays in one municipality can share a name, so an official row
        // is matched on its code; only uncoded local rows fall back to the name.
        if (e.psgcCode) {
          id = await upsert(
            conn,
            `INSERT INTO barangays (psgc_code, municipality_id, name) VALUES (?,?,?)
               ON DUPLICATE KEY UPDATE municipality_id = VALUES(municipality_id), name = VALUES(name)`,
            [e.psgcCode, parentId, e.name],
            'SELECT id FROM barangays WHERE psgc_code = ? LIMIT 1',
            [e.psgcCode]
          );
        } else {
          const [existing] = await conn.execute(
            'SELECT id FROM barangays WHERE municipality_id = ? AND name = ? AND psgc_code IS NULL LIMIT 1',
            [parentId, e.name]
          );
          if (existing[0]) {
            id = existing[0].id;
          } else {
            const [ins] = await conn.execute(
              'INSERT INTO barangays (municipality_id, name) VALUES (?,?)',
              [parentId, e.name]
            );
            id = ins.insertId;
          }
        }
      }
      if (e.psgcCode) byCode.set(e.psgcCode, id);
      counts[level] += 1;
    }
  }
  return counts;
}

async function seedFromRecords(conn, records) {
  const counts = { region: 0, province: 0, municipality: 0, barangay: 0 };
  const seen = { region: new Set(), province: new Set(), municipality: new Set(), barangay: new Set() };

  for (const r of records) {
    const regionId = await upsert(
      conn,
      'INSERT IGNORE INTO regions (name) VALUES (?)',
      [r.region],
      'SELECT id FROM regions WHERE name = ? LIMIT 1',
      [r.region]
    );
    if (!seen.region.has(r.region)) { seen.region.add(r.region); counts.region += 1; }

    const provKey = `${regionId}|${r.province}`;
    const provinceId = await upsert(
      conn,
      'INSERT IGNORE INTO provinces (region_id, name) VALUES (?,?)',
      [regionId, r.province],
      'SELECT id FROM provinces WHERE region_id = ? AND name = ? LIMIT 1',
      [regionId, r.province]
    );
    if (!seen.province.has(provKey)) { seen.province.add(provKey); counts.province += 1; }

    const munKey = `${provinceId}|${r.municipality}`;
    const municipalityId = await upsert(
      conn,
      'INSERT IGNORE INTO municipalities (province_id, name, type) VALUES (?,?,?)',
      [provinceId, r.municipality, guessType(r.municipality)],
      'SELECT id FROM municipalities WHERE province_id = ? AND name = ? LIMIT 1',
      [provinceId, r.municipality]
    );
    if (!seen.municipality.has(munKey)) { seen.municipality.add(munKey); counts.municipality += 1; }

    if (!r.barangay) continue;
    const brgyKey = `${municipalityId}|${r.barangay}`;
    const [known] = await conn.execute(
      'SELECT id FROM barangays WHERE municipality_id = ? AND name = ? LIMIT 1',
      [municipalityId, r.barangay]
    );
    if (!known[0]) {
      await conn.execute('INSERT INTO barangays (municipality_id, name) VALUES (?,?)', [municipalityId, r.barangay]);
    }
    if (!seen.barangay.has(brgyKey)) { seen.barangay.add(brgyKey); counts.barangay += 1; }
  }
  return counts;
}

/**
 * Builds a lookup of every barangay in the database, keyed on the normalised
 * province + municipality + barangay names. PSGC-coded rows win over locally
 * seeded ones so records end up pointing at the authoritative entry.
 */
async function buildBarangayIndex(conn) {
  const [rows] = await conn.execute(
    `SELECT b.id, b.psgc_code, b.name AS barangay, m.name AS municipality, p.name AS province
       FROM barangays b
       JOIN municipalities m ON m.id = b.municipality_id
       JOIN provinces p      ON p.id = m.province_id`
  );
  const index = new Map();
  for (const r of rows) {
    const key = [normalizeName(r.province), normalizeName(r.municipality), normalizeName(r.barangay)].join('|');
    const existing = index.get(key);
    if (!existing || (!existing.psgc_code && r.psgc_code)) index.set(key, r);
  }
  return index;
}

/**
 * Points applicants and farms at a barangay row, matching the municipality and
 * province columns plus the "Brgy. X" prefix of their address text. Records that
 * already carry a barangay_id are re-pointed only when a PSGC row is a better fit.
 */
async function backfill(conn, table, addressColumn, index) {
  const [rows] = await conn.execute(
    `SELECT id, ${addressColumn} AS address, municipality, province, barangay_id FROM ${table}`
  );
  let linked = 0;
  let repointed = 0;
  const unmatched = [];

  for (const row of rows) {
    const name = parseBarangay(row.address);
    if (!name || !row.municipality) {
      if (!row.barangay_id) unmatched.push(row.id);
      continue;
    }
    const key = [normalizeName(row.province), normalizeName(row.municipality), normalizeName(name)].join('|');
    const hit = index.get(key);
    if (!hit) {
      if (!row.barangay_id) unmatched.push(row.id);
      continue;
    }
    if (row.barangay_id === hit.id) continue;
    await conn.execute(`UPDATE ${table} SET barangay_id = ? WHERE id = ?`, [hit.id, row.id]);
    if (row.barangay_id) repointed += 1; else linked += 1;
  }
  return { linked, repointed, unmatched };
}

/**
 * Clears references to barangays that are absent from the official list. Only
 * used with --strict: it trades a demo record's barangay link for a location
 * list that contains nothing invented.
 */
async function clearUnofficialReferences(conn) {
  let cleared = 0;
  for (const table of ['applicants', 'farms', 'users']) {
    const [res] = await conn.execute(
      `UPDATE ${table} t
         JOIN barangays b ON b.id = t.barangay_id
          SET t.barangay_id = NULL
        WHERE b.psgc_code IS NULL`
    );
    cleared += res.affectedRows || 0;
  }
  return cleared;
}

/**
 * Removes the locally seeded placeholder rows (no PSGC code) once the official
 * list is in and nothing references them any more. Children go before parents.
 */
async function pruneUncodedRows(conn) {
  const removed = { barangays: 0, municipalities: 0, provinces: 0, regions: 0 };

  const [brgys] = await conn.execute(
    `SELECT b.id FROM barangays b
      WHERE b.psgc_code IS NULL
        AND NOT EXISTS (SELECT 1 FROM applicants a WHERE a.barangay_id = b.id)
        AND NOT EXISTS (SELECT 1 FROM farms f      WHERE f.barangay_id = b.id)
        AND NOT EXISTS (SELECT 1 FROM users u      WHERE u.barangay_id = b.id)`
  );
  for (const r of brgys) {
    await conn.execute('DELETE FROM barangays WHERE id = ?', [r.id]);
    removed.barangays += 1;
  }

  const [munis] = await conn.execute(
    `SELECT m.id FROM municipalities m
      WHERE m.psgc_code IS NULL
        AND NOT EXISTS (SELECT 1 FROM barangays b WHERE b.municipality_id = m.id)`
  );
  for (const r of munis) {
    await conn.execute('DELETE FROM municipalities WHERE id = ?', [r.id]);
    removed.municipalities += 1;
  }

  const [provs] = await conn.execute(
    `SELECT p.id FROM provinces p
      WHERE p.psgc_code IS NULL
        AND NOT EXISTS (SELECT 1 FROM municipalities m WHERE m.province_id = p.id)`
  );
  for (const r of provs) {
    await conn.execute('DELETE FROM provinces WHERE id = ?', [r.id]);
    removed.provinces += 1;
  }

  const [regs] = await conn.execute(
    `SELECT r.id FROM regions r
      WHERE r.psgc_code IS NULL
        AND NOT EXISTS (SELECT 1 FROM provinces p WHERE p.region_id = r.id)`
  );
  for (const r of regs) {
    await conn.execute('DELETE FROM regions WHERE id = ?', [r.id]);
    removed.regions += 1;
  }

  return removed;
}

async function main() {
  const strict = process.argv.includes('--strict');

  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'agri_aims',
  });

  try {
    let counts;
    const usingPsgc = fs.existsSync(PSGC_FILE);
    if (usingPsgc) {
      console.log(`Loading the official PSGC list from ${PSGC_FILE} ...`);
      counts = await seedFromPsgc(conn, readJson(PSGC_FILE));
    } else {
      console.log('No data/psgc.json found — seeding from the locations in data/*.json instead.');
      console.log('This is a starter set, not the complete PSGC list. See the notes at the top of this file.');
      counts = await seedFromRecords(conn, collectFromSeedData());
    }

    console.log(
      `\nLocations: ${counts.region} region(s), ${counts.province} province(s), ` +
      `${counts.municipality} municipality/city, ${counts.barangay} barangay(s).`
    );

    const index = await buildBarangayIndex(conn);
    const applicants = await backfill(conn, 'applicants', 'farm_address', index);
    const farms = await backfill(conn, 'farms', 'address', index);
    console.log(`Linked ${applicants.linked} applicant(s) and ${farms.linked} farm(s) to a barangay.`);
    if (applicants.repointed || farms.repointed) {
      console.log(
        `Re-pointed ${applicants.repointed} applicant(s) and ${farms.repointed} farm(s) at their official PSGC barangay.`
      );
    }

    if (strict && usingPsgc) {
      const cleared = await clearUnofficialReferences(conn);
      if (cleared) {
        console.log(
          `--strict: cleared ${cleared} barangay reference(s) that pointed at a location absent from the PSGC list.`
        );
      }
    }

    const pruned = await pruneUncodedRows(conn);
    const prunedTotal = pruned.barangays + pruned.municipalities + pruned.provinces + pruned.regions;
    if (prunedTotal) {
      console.log(
        `Removed ${prunedTotal} placeholder row(s) superseded by the PSGC list ` +
        `(${pruned.barangays} barangay, ${pruned.municipalities} municipality, ` +
        `${pruned.provinces} province, ${pruned.regions} region).`
      );
    }

    if (!strict && usingPsgc) {
      const [[left]] = await conn.execute('SELECT COUNT(*) AS c FROM barangays WHERE psgc_code IS NULL');
      if (left.c) {
        console.log(
          `\n${left.c} locally seeded barangay(s) are not in the PSGC list and are still offered in the dropdowns. ` +
          'Re-run with --strict to remove them (records pointing at one will have their barangay cleared).'
        );
      }
    }

    const stragglers = [...applicants.unmatched, ...farms.unmatched];
    if (stragglers.length) {
      console.log(
        `${stragglers.length} record(s) still have no barangay — their address text did not match any barangay. ` +
        'Set those from the admin form.'
      );
    }
    console.log('\nDone.');
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error('Seeding failed:', err.message);
  process.exit(1);
});
