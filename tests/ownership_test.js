/**
 * One applicant must not reach another applicant's file.
 *
 * The Applications LIST was filtered to the caller's own application, so this
 * looked contained. It was not: the detail page, the accreditation overview and
 * Steps 1-3 checked the caller's ROLE and never which application they were
 * opening. Any signed-in applicant could change the id in the URL and:
 *
 *   read   name, email, phone, RSBSA number, farm details and document list
 *   write  sign somebody else's LSA briefer under their own name, answer their
 *          self-assessment, and advance their application a step
 *
 * Both were reproduced against throwaway accounts before the guards were added
 * — the victim's record came back reading "acknowledged by: Al Nosy", moved
 * from step 1 to step 2.
 *
 *   node tests/ownership_test.js
 */

require('dotenv').config();

const http = require('http');
const app = require('../app');
const { pool } = require('../config/database');
const applicantModel = require('../models/applicantModel');
const userModel = require('../models/userModel');
const { registerFarmer } = require('../services/farmerRegistration');
const { signToken } = require('../middleware/auth');

let failures = 0;
function check(label, condition) {
  console.log((condition ? 'PASS  ' : 'FAIL  ') + label);
  if (!condition) failures += 1;
}

const CSRF = 'e'.repeat(64);

function get(server, path, token) {
  return new Promise((resolve, reject) => {
    http.get({
      host: '127.0.0.1', port: server.address().port, path,
      headers: { Cookie: `agri_token=${token}` },
    }, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => resolve({ status: res.statusCode, text: d }));
    }).on('error', reject);
  });
}

function post(server, path, token, body) {
  return new Promise((resolve, reject) => {
    const payload = new URLSearchParams(body).toString();
    const req = http.request({
      host: '127.0.0.1', port: server.address().port, path, method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(payload),
        Cookie: `agri_token=${token}; agri_csrf=${CSRF}`,
      },
    }, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => resolve({ status: res.statusCode, location: res.headers.location }));
    });
    req.on('error', reject);
    req.end(payload);
  });
}

async function main() {
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));

  const stamp = Date.now();
  const made = { users: [], applicants: [] };

  try {
    const victim = await registerFarmer({
      firstName: 'Bea', lastName: 'Private', email: `own.bea.${stamp}@example.com`,
      password: 'Str0ng!Pass1', phone: '09170000001', role: 'applicant',
      farmName: 'Beas Private Farm', farmAddress: 'Nabua',
      region: 'Region V', province: 'Camarines Sur', municipality: 'Nabua',
    });
    const theirs = await applicantModel.findByApplicationId(victim.applicationId);
    made.users.push(victim.userId);
    made.applicants.push(theirs.id);

    const other = await registerFarmer({
      firstName: 'Al', lastName: 'Nosy', email: `own.al.${stamp}@example.com`,
      password: 'Str0ng!Pass1', phone: '09170000002', role: 'applicant',
      farmName: 'Als Farm', farmAddress: 'Iriga',
      region: 'Region V', province: 'Camarines Sur', municipality: 'City of Iriga',
    });
    const mine = await applicantModel.findByApplicationId(other.applicationId);
    made.users.push(other.userId);
    made.applicants.push(mine.id);
    const token = signToken(await userModel.findById(other.userId));

    console.log("--- reading someone else's application ---");
    for (const path of [`/applicants/${theirs.id}`, `/accreditation/${theirs.id}`,
      `/accreditation/${theirs.id}/step/1`, `/accreditation/${theirs.id}/step/2`,
      `/accreditation/${theirs.id}/step/3`]) {
      const r = await get(server, path, token);
      const leaks = r.text.includes(`own.bea.${stamp}@example.com`)
        || r.text.includes('Beas Private Farm');
      check(`${path} -> ${r.status}, no data leaked`, r.status === 403 && !leaks);
    }

    console.log('\n--- and their own application still opens ---');
    for (const path of [`/applicants/${mine.id}`, `/accreditation/${mine.id}`,
      `/accreditation/${mine.id}/step/1`]) {
      const r = await get(server, path, token);
      check(`${path} -> ${r.status}`, r.status === 200);
    }

    console.log("--- \nsigning someone else's briefer ---");
    const before = await applicantModel.findById(theirs.id);
    const wrote = await post(server, `/accreditation/${theirs.id}/step/1`, token, {
      _csrf: CSRF, readBriefer: 'on', notDisqualified: 'on',
      agreeResponsibilities: 'on', acknowledgedBy: 'Al Nosy',
    });
    check(`the post is refused -> ${wrote.status}`, wrote.status === 403);
    const after = await applicantModel.findById(theirs.id);
    check('their briefer is still unsigned', !after.step1_brieferSigned);
    check('nobody else is recorded as acknowledging it',
      after.step1_acknowledgedBy === before.step1_acknowledgedBy);
    check(`their application did not advance (step ${after.accreditationStep})`,
      after.accreditationStep === before.accreditationStep
      && after.progress === before.progress);

    console.log("\n--- answering someone else's self-assessment ---");
    const s2 = await post(server, `/accreditation/${theirs.id}/step/2`, token, {
      _csrf: CSRF, f1: 'on', f2: 'on', o1: 'on', d1: 'on',
    });
    check(`the post is refused -> ${s2.status}`, s2.status === 403);
    const afterS2 = await applicantModel.findById(theirs.id);
    check('their self-assessment score is untouched',
      afterS2.step2_selfAssessmentScore === before.step2_selfAssessmentScore);

    console.log('\n--- ATI staff are unaffected ---');
    const staff = (await userModel.findAllPublicProfiles())
      .find((u) => u.role === 'evaluator' || u.role === 'admin');
    if (staff) {
      const r = await get(server, `/applicants/${theirs.id}`, signToken(staff));
      check(`an ${staff.role} still opens any application -> ${r.status}`, r.status === 200);
    } else {
      console.log('SKIP  no ATI staff account to check the allowed path with');
    }
  } finally {
    await new Promise((r) => server.close(r));
    for (const id of made.applicants) {
      await pool.execute('DELETE FROM applicants WHERE id = ?', [id]).catch(() => {});
    }
    for (const id of made.users) {
      await pool.execute('DELETE FROM notifications WHERE user_id = ?', [id]).catch(() => {});
      await pool.execute('DELETE FROM users WHERE id = ?', [id]).catch(() => {});
    }
    await pool.end();
  }

  console.log('');
  if (failures) {
    console.log(failures + ' CHECK(S) FAILED');
    process.exitCode = 1;
  } else {
    console.log('ALL OWNERSHIP CHECKS PASSED');
  }
}

main().catch(async (err) => {
  console.error(err);
  try { await pool.end(); } catch (_) { /* already closed */ }
  process.exit(1);
});
