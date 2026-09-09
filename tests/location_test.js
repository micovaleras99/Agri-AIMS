/**
 * The barangay decides the place names.
 *
 * `applicants` and `farms` keep region, province and municipality as plain
 * VARCHARs beside `barangay_id`. They are a cache of the PSGC hierarchy — kept
 * because the list filters group on them, and because the barangay is optional
 * — and until locationModel.placeNamesFor() they were written from whatever the
 * form posted. A cache anyone can type into drifts: one seeded farm was
 * recording its municipality as "Sorsogon City" while the barangay in the very
 * next column said "City of Sorsogon".
 *
 *   node tests/location_test.js
 */

require('dotenv').config();

const http = require('http');
const app = require('../app');
const { pool } = require('../config/database');
const applicantModel = require('../models/applicantModel');
const locationModel = require('../models/locationModel');

let failures = 0;
function check(label, condition) {
  console.log((condition ? 'PASS  ' : 'FAIL  ') + label);
  if (!condition) failures += 1;
}

function postJson(server, path, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request({
      host: '127.0.0.1', port: server.address().port, path, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    }, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(d); } catch (_) { /* not json */ }
        resolve({ status: res.statusCode, json });
      });
    });
    req.on('error', reject);
    req.end(payload);
  });
}

async function main() {
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const madeUsers = [];
  const madeApplicants = [];

  try {
    // A real barangay to point at, with the names it implies.
    const [[bgy]] = await pool.query(
      `SELECT b.id, b.name, m.name AS municipality, p.name AS province, r.name AS region
         FROM barangays b
         JOIN municipalities m ON m.id = b.municipality_id
         JOIN provinces p      ON p.id = m.province_id
         JOIN regions r        ON r.id = p.region_id
        ORDER BY b.id LIMIT 1`
    );
    if (!bgy) {
      console.log('SKIP  no barangays seeded; run npm run seed:locations');
      await pool.end();
      return;
    }

    console.log('--- the helper reads the hierarchy ---');
    const place = await locationModel.placeNamesFor(bgy.id);
    check(`it names the municipality (${place && place.municipality})`,
      !!place && place.municipality === bgy.municipality);
    check('the province', !!place && place.province === bgy.province);
    check('and the region', !!place && place.region === bgy.region);
    check('and returns null when there is no barangay to read',
      (await locationModel.placeNamesFor(null)) === null);

    console.log('\n--- a registration cannot contradict its own barangay ---');
    const stamp = Date.now();
    const res = await postJson(server, '/api/auth/register', {
      firstName: 'Place', lastName: 'Tester',
      email: `place.${stamp}@example.com`,
      password: 'Str0ng!Pass1',
      phone: '09170000000',
      role: 'applicant',
      farmName: 'Place Test Farm',
      farmAddress: 'Purok 3, Zone II',
      barangayId: String(bgy.id),
      // Deliberately wrong: exactly what a stale hidden field or a hand-built
      // request would send.
      region: 'Region XIII', province: 'Nowhere', municipality: 'Typo City',
    });
    check(`registration succeeds -> ${res.status}`, res.status === 201);
    if (res.status !== 201) throw new Error('cannot continue');
    if (res.json.data.user) madeUsers.push(res.json.data.user.id);

    const applicant = await applicantModel.findByApplicationId(res.json.data.applicationId);
    madeApplicants.push(applicant.id);
    check(`the municipality came from the barangay, not the form (${applicant.municipality})`,
      applicant.municipality === bgy.municipality);
    check(`so did the province (${applicant.province})`, applicant.province === bgy.province);
    check(`and the region (${applicant.region})`, applicant.region === bgy.region);
    check('the street-level address is kept as given',
      applicant.farmAddress === 'Purok 3, Zone II');

    console.log('\n--- with no barangay, what was typed is all there is ---');
    const bare = await postJson(server, '/api/auth/register', {
      firstName: 'Bare', lastName: 'Place',
      email: `bare.place.${stamp}@example.com`,
      password: 'Str0ng!Pass1',
      phone: '09170000000',
      role: 'applicant',
      farmName: 'Bare Place Farm', farmAddress: 'Sitio Malaya',
      region: 'Region V', province: 'Albay', municipality: 'Tabaco City',
    });
    check(`it still registers -> ${bare.status}`, bare.status === 201);
    if (bare.json && bare.json.data) {
      if (bare.json.data.user) madeUsers.push(bare.json.data.user.id);
      const a2 = await applicantModel.findByApplicationId(bare.json.data.applicationId);
      madeApplicants.push(a2.id);
      check('and keeps the typed location',
        a2.province === 'Albay' && a2.municipality === 'Tabaco City');
      check('with no barangay recorded', a2.barangayId === null);
    }

    console.log('\n--- nothing in the database disagrees with its barangay ---');
    for (const table of ['applicants', 'farms']) {
      const [[bad]] = await pool.query(
        `SELECT COUNT(*) c
           FROM ${table} t
           JOIN barangays b      ON b.id = t.barangay_id
           JOIN municipalities m ON m.id = b.municipality_id
           JOIN provinces p      ON p.id = m.province_id
           JOIN regions r        ON r.id = p.region_id
          WHERE t.region <> r.name OR t.province <> p.name OR t.municipality <> m.name`
      );
      check(`${table}: ${bad.c} record(s) drifted`, Number(bad.c) === 0);
    }
  } finally {
    await new Promise((r) => server.close(r));
    for (const id of madeApplicants) {
      await pool.execute('DELETE FROM applicants WHERE id = ?', [id]).catch(() => {});
    }
    for (const id of madeUsers) {
      await pool.execute('DELETE FROM users WHERE id = ?', [id]).catch(() => {});
    }
    await pool.end();
  }

  console.log('');
  if (failures) {
    console.log(failures + ' CHECK(S) FAILED');
    process.exitCode = 1;
  } else {
    console.log('ALL LOCATION CHECKS PASSED');
  }
}

main().catch(async (err) => {
  console.error(err);
  try { await pool.end(); } catch (_) { /* already closed */ }
  process.exit(1);
});
