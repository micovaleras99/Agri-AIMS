/**
 * Re-derives region, province and municipality from the barangay each record
 * points at.
 *
 * Those three columns on `applicants` and `farms` are a cache of the PSGC
 * hierarchy — kept because the list filters group on them and because
 * `barangay_id` is optional. Until locationModel.placeNamesFor() they were
 * written from whatever the form posted, so they could disagree with the
 * barangay sitting in the very next column: one seeded farm recorded its
 * municipality as "Sorsogon City" while its own barangay said "City of
 * Sorsogon".
 *
 * Records with no barangay are left exactly as they are — their typed values
 * are the only location they have.
 *
 *   node scripts/resync-place-names.js            list what disagrees
 *   node scripts/resync-place-names.js --apply    correct it
 */

require('dotenv').config();

const { pool } = require('../config/database');

const TABLES = [
  { name: 'applicants', label: 'farm_name' },
  { name: 'farms', label: 'name' },
];

async function main() {
  const apply = process.argv.includes('--apply');
  let drifted = 0;

  for (const { name, label } of TABLES) {
    const [rows] = await pool.query(
      `SELECT t.id, t.${label} AS label, t.region, t.province, t.municipality,
              r.name AS true_region, p.name AS true_province, m.name AS true_municipality
         FROM ${name} t
         JOIN barangays b      ON b.id = t.barangay_id
         JOIN municipalities m ON m.id = b.municipality_id
         JOIN provinces p      ON p.id = m.province_id
         JOIN regions r        ON r.id = p.region_id
        WHERE t.region <> r.name OR t.province <> p.name OR t.municipality <> m.name
        ORDER BY t.id`
    );

    if (!rows.length) {
      console.log(`${name}: every record with a barangay already agrees with it.`);
      continue;
    }

    console.log(`\n${name}: ${rows.length} record(s) disagree with their own barangay`);
    for (const r of rows) {
      drifted += 1;
      console.log(`  #${r.id} ${r.label}`);
      if (r.region !== r.true_region) console.log(`      region       ${r.region} -> ${r.true_region}`);
      if (r.province !== r.true_province) console.log(`      province     ${r.province} -> ${r.true_province}`);
      if (r.municipality !== r.true_municipality) console.log(`      municipality ${r.municipality} -> ${r.true_municipality}`);

      if (apply) {
        await pool.execute(
          `UPDATE ${name} SET region = ?, province = ?, municipality = ? WHERE id = ?`,
          [r.true_region, r.true_province, r.true_municipality, r.id]
        );
        console.log('      corrected');
      }
    }
  }

  if (drifted && !apply) console.log('\nDry run. Re-run with --apply to correct these.');
}

main()
  .then(() => pool.end())
  .catch(async (err) => {
    console.error(err);
    await pool.end().catch(() => {});
    process.exit(1);
  });
