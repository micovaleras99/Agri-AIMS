/**
 * One-off maintenance: the demo records in data/*.json carried invented barangay
 * names — there is no Brgy. San Jose in the City of Naga, no Salvacion in the
 * City of Legazpi. This rewrites them to real barangays of the same municipality
 * and re-links every record to the matching PSGC row.
 *
 *   node scripts/fix-demo-addresses.js            # show what would change
 *   node scripts/fix-demo-addresses.js --apply    # write data/*.json and the database
 *
 * The replacements were chosen by hand: a real barangay of the same LGU, keeping
 * the original name where a genuine one exists (Bitano, Poblacion) and otherwise
 * picking a rural barangay that suits a demonstration farm.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const DATA_DIR = path.join(__dirname, '..', 'data');

/** municipality → { from: invented name, to: real barangay, note } */
const MAPPING = [
  { municipality: 'Naga City',     from: 'San Jose',   to: 'San Isidro',    note: 'real barangay of the City of Naga' },
  { municipality: 'Legazpi City',  from: 'Salvacion',  to: 'Banquerohan',   note: 'Bgy. 66, a rural barangay of Legazpi' },
  { municipality: 'Legazpi City',  from: 'Bitano',     to: 'Bitano',        note: 'already real — Bgy. 37 - Bitano (Pob.)' },
  { municipality: 'Sorsogon City', from: 'Poblacion',  to: 'Poblacion',     note: 'already real' },
  { municipality: 'Pio Duran',     from: 'Tondol',     to: 'Caratagan',     note: 'real rural barangay of Pio Duran' },
  { municipality: 'Bulan',         from: 'San Roque',  to: 'N. Roque',      note: 'the real barangay closest in name' },
  { municipality: 'Caramoan',      from: 'Lupi',       to: 'Bikal',         note: 'real rural barangay of Caramoan' },
  { municipality: 'Iriga City',    from: 'Concepcion', to: 'Salvacion',     note: 'real barangay of the City of Iriga' },
];

/** Same rules as the seeder, so text and stored names compare equal. */
function normalizeName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/^(?:bgy|brgy|barangay)\.?\s*\d+\s*-\s*/, '')
    .replace(/\(\s*pob\.?\s*\)/g, ' ')
    .replace(/[.\-']/g, ' ')
    .replace(/^city of\s+/, '')
    .replace(/^municipality of\s+/, '')
    .replace(/\s+city$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseBarangay(address) {
  const m = /^\s*(?:Brgy\.?|Barangay|Bgy\.?)\s+([^,]+)/i.exec(String(address || ''));
  return m ? m[1].trim() : null;
}

function findMapping(municipality, barangay) {
  return MAPPING.find(
    (m) => normalizeName(m.municipality) === normalizeName(municipality) &&
           normalizeName(m.from) === normalizeName(barangay)
  );
}

/** "Brgy. San Jose, Naga City" → "Brgy. San Isidro, Naga City" */
function rewriteAddress(address, to) {
  return String(address).replace(/^(\s*(?:Brgy\.?|Barangay|Bgy\.?)\s+)([^,]+)/i, `$1${to}`);
}

async function resolveBarangayId(conn, municipality, barangayName) {
  const [rows] = await conn.execute(
    `SELECT b.id, b.name, m.name AS municipality
       FROM barangays b JOIN municipalities m ON m.id = b.municipality_id`
  );
  const hit = rows.find(
    (r) => normalizeName(r.municipality) === normalizeName(municipality) &&
           normalizeName(r.name) === normalizeName(barangayName)
  );
  return hit || null;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const applicants = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'applicants.json'), 'utf8'));
  const farms = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'farms.json'), 'utf8'));

  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'agri_aims',
  });

  const changes = [];
  let unmapped = 0;

  for (const a of applicants) {
    const current = parseBarangay(a.farmAddress);
    const map = findMapping(a.municipality, current);
    if (!map) { unmapped += 1; continue; }
    const hit = await resolveBarangayId(conn, a.municipality, map.to);
    changes.push({
      table: 'applicants', jsonRow: a, key: a.applicationId,
      municipality: a.municipality, from: current, to: map.to, note: map.note,
      newAddress: rewriteAddress(a.farmAddress, map.to),
      barangayId: hit ? hit.id : null, officialName: hit ? hit.name : null,
    });
  }

  for (const f of farms) {
    const current = parseBarangay(f.address);
    const map = findMapping(f.municipality, current);
    if (!map) { unmapped += 1; continue; }
    const hit = await resolveBarangayId(conn, f.municipality, map.to);
    changes.push({
      table: 'farms', jsonRow: f, key: f.name,
      municipality: f.municipality, from: current, to: map.to, note: map.note,
      newAddress: rewriteAddress(f.address, map.to),
      barangayId: hit ? hit.id : null, officialName: hit ? hit.name : null,
    });
  }

  console.log(apply ? 'Applying changes:\n' : 'Dry run — nothing written. Re-run with --apply.\n');
  for (const c of changes) {
    const status = c.barangayId ? `-> barangay #${c.barangayId} (${c.officialName})` : '-> NO MATCH IN PSGC';
    console.log(`  ${c.table.padEnd(10)} ${String(c.key).padEnd(28)} ${String(c.from).padEnd(11)} -> ${String(c.to).padEnd(12)} ${status}`);
    console.log(`             ${c.newAddress}   (${c.note})`);
  }
  if (unmapped) console.log(`\n  ${unmapped} record(s) had no mapping entry and were left alone.`);

  const missing = changes.filter((c) => !c.barangayId);
  if (missing.length) {
    console.error(`\n${missing.length} replacement(s) could not be found in the location tables. Run npm run seed:locations first.`);
    await conn.end();
    process.exit(1);
  }

  if (!apply) { await conn.end(); return; }

  for (const c of changes) {
    if (c.table === 'applicants') {
      await conn.execute('UPDATE applicants SET farm_address = ?, barangay_id = ? WHERE application_id = ?',
        [c.newAddress, c.barangayId, c.key]);
      c.jsonRow.farmAddress = c.newAddress;
    } else {
      await conn.execute('UPDATE farms SET address = ?, barangay_id = ? WHERE name = ?',
        [c.newAddress, c.barangayId, c.key]);
      c.jsonRow.address = c.newAddress;
    }
  }

  // Keep the JSON fixtures in step, so a re-migrate reproduces the same records.
  fs.writeFileSync(path.join(DATA_DIR, 'applicants.json'), JSON.stringify(applicants, null, 2) + '\n');
  fs.writeFileSync(path.join(DATA_DIR, 'farms.json'), JSON.stringify(farms, null, 2) + '\n');

  const [[appLinked]] = await conn.execute('SELECT COUNT(*) AS c FROM applicants WHERE barangay_id IS NOT NULL');
  const [[farmLinked]] = await conn.execute('SELECT COUNT(*) AS c FROM farms WHERE barangay_id IS NOT NULL');
  console.log(`\nUpdated data/applicants.json and data/farms.json.`);
  console.log(`Database: ${appLinked.c} applicant(s) and ${farmLinked.c} farm(s) now linked to a barangay.`);

  await conn.end();
}

main().catch((err) => {
  console.error('Failed:', err.message);
  process.exit(1);
});
