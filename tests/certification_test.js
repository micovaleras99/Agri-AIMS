/**
 * Issuing the certificate must create the Learning Site.
 *
 * Step 7 issues the Certificate of Accreditation and executes the MOA, and it
 * used to stamp the applicant row and stop there. No `farms` row was created —
 * farmModel had no insert at all — and the account stayed role 'applicant' with
 * farm_id NULL. Everything the certificate unlocks reads one of those two
 * things, so the newly accredited operator could not renew the certificate they
 * had just been given, could not be reminded that it was expiring, and their
 * Learning Site never appeared in the public directory it exists to be in.
 *
 *   node tests/certification_test.js
 */

require('dotenv').config();

const http = require('http');
const app = require('../app');
const { pool } = require('../config/database');
const applicantModel = require('../models/applicantModel');
const farmModel = require('../models/farmModel');
const userModel = require('../models/userModel');
const { signToken } = require('../middleware/auth');

let failures = 0;
function check(label, condition) {
  console.log((condition ? 'PASS  ' : 'FAIL  ') + label);
  if (!condition) failures += 1;
}

const CSRF = 'b'.repeat(64);

function request(server, method, path, { token, body, json } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null
      : json ? JSON.stringify(body) : new URLSearchParams(body).toString();
    const headers = {};
    if (payload !== null) {
      headers['Content-Type'] = json ? 'application/json' : 'application/x-www-form-urlencoded';
      headers['Content-Length'] = Buffer.byteLength(payload);
    }
    const cookies = [];
    if (token) cookies.push(`agri_token=${token}`);
    if (!json) cookies.push(`agri_csrf=${CSRF}`);
    if (cookies.length) headers.Cookie = cookies.join('; ');

    const req = http.request(
      { host: '127.0.0.1', port: server.address().port, path, method, headers },
      (res) => {
        let d = '';
        res.on('data', (c) => { d += c; });
        res.on('end', () => {
          let parsed = null;
          try { parsed = JSON.parse(d); } catch (_) { /* html, not json */ }
          resolve({ status: res.statusCode, location: res.headers.location, text: d, json: parsed });
        });
      }
    );
    req.on('error', reject);
    req.end(payload === null ? undefined : payload);
  });
}

async function main() {
  const staff = await userModel.findAllPublicProfiles();
  const admin = staff.find((u) => u.role === 'admin');
  if (!admin) {
    console.log('SKIP  no admin account to issue a certificate with');
    await pool.end();
    return;
  }

  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));

  let userId = null;
  let applicantId = null;
  let farmId = null;

  try {
    console.log('--- an application reaches Step 7 ---');
    const stamp = Date.now();
    const reg = await request(server, 'POST', '/api/auth/register', {
      json: true,
      body: {
        firstName: 'Cert', lastName: 'Tester',
        email: `cert.${stamp}@example.com`,
        password: 'Str0ng!Pass1',
        phone: '09170000000',
        role: 'applicant',
        farmName: `Certification Test Farm ${stamp}`,
        farmAddress: 'Bato',
        region: 'Region V', province: 'Camarines Sur', municipality: 'Bato',
        farmArea: '15000',
        lsaType: 'regular',
        category: 'private',
        classification: 'integrated',
      },
    });
    check(`registration succeeds -> ${reg.status}`, reg.status === 201);
    if (reg.status !== 201) throw new Error('cannot continue without an application');
    userId = reg.json.data.user.id;
    const applicant = await applicantModel.findByApplicationId(reg.json.data.applicationId);
    applicantId = applicant.id;

    console.log('\n--- issuing the certificate creates the Learning Site ---');
    const issued = await request(server, 'POST', `/accreditation/${applicantId}/step/7`, {
      token: signToken(admin),
      body: { _csrf: CSRF, confirmCert: 'on', issueDate: '2026-09-04', validUntil: '2031-09-04' },
    });
    check(`the certificate is issued -> ${issued.status}`, issued.status === 302);

    const farm = await farmModel.findByApplicant(applicantId);
    check('a Learning Site now exists for the application', !!farm);
    if (!farm) throw new Error('no farm was created');
    farmId = farm.id;

    check(`it carries the farm's own name (${farm.name})`, farm.name === applicant.farmName);
    check(`the operator is the applicant (${farm.operator})`, farm.operator === 'Cert Tester');
    check(`the classification came across (${farm.classification})`, farm.classification === 'integrated');
    check(`so did the area (${farm.farmArea})`, Number(farm.farmArea) === 15000);
    check(`accredited since the issue date (${farm.accreditedSince})`, farm.accreditedSince === '2026-09-04');
    check(`and expires with the certificate (${farm.expiryDate})`, farm.expiryDate === '2031-09-04');
    check(`it is an active LSA I (${farm.status}, ${farm.accreditationLevel})`,
      farm.status === 'active' && farm.accreditationLevel === 'LSA I');

    console.log('\n--- and the applicant becomes its operator ---');
    const promoted = await userModel.findById(userId);
    check(`the account is now an operator (${promoted.role})`, promoted.role === 'operator');
    check('pointed at the farm it operates', Number(promoted.farmId) === Number(farmId));

    console.log('\n--- which is the point: the certificate now works ---');
    const token = signToken(promoted);
    // Both of these answered 403 "applies to Learning Sites that are already
    // accredited" to the very people who had just been accredited.
    const renewal = await request(server, 'GET', '/renewal', { token });
    check(`the operator can reach Renewal -> ${renewal.status}`, renewal.status === 200);
    check('and their own site is listed there', renewal.text.includes(applicant.farmName));

    const lsa2 = await request(server, 'GET', '/lsa2', { token });
    check(`and LSA II up-scaling -> ${lsa2.status}`, lsa2.status === 200);

    const dash = await request(server, 'GET', '/dashboard', { token });
    check(`the operator dashboard renders -> ${dash.status}`, dash.status === 200);

    const directory = await request(server, 'GET', '/directory');
    check('the site appears in the public LSA directory',
      directory.status === 200 && directory.text.includes(applicant.farmName));

    console.log('\n--- issuing it twice does not create a second site ---');
    const again = await request(server, 'POST', `/accreditation/${applicantId}/step/7`, {
      token: signToken(admin),
      body: { _csrf: CSRF, confirmCert: 'on', issueDate: '2026-09-04', validUntil: '2031-09-04' },
    });
    check(`the re-post is accepted -> ${again.status}`, again.status === 302);
    const [dupes] = await pool.query('SELECT COUNT(*) AS c FROM farms WHERE applicant_id = ?', [applicantId]);
    check(`still exactly one Learning Site (${dupes[0].c})`, Number(dupes[0].c) === 1);
  } finally {
    await new Promise((r) => server.close(r));
    if (userId) {
      await pool.execute('DELETE FROM notifications WHERE user_id = ?', [userId]).catch(() => {});
      await pool.execute('DELETE FROM users WHERE id = ?', [userId]).catch(() => {});
    }
    if (farmId) await pool.execute('DELETE FROM farms WHERE id = ?', [farmId]).catch(() => {});
    if (applicantId) await pool.execute('DELETE FROM applicants WHERE id = ?', [applicantId]).catch(() => {});
    await pool.end();
  }

  console.log('');
  if (failures) {
    console.log(failures + ' CHECK(S) FAILED');
    process.exitCode = 1;
  } else {
    console.log('ALL CERTIFICATION CHECKS PASSED');
  }
}

main().catch(async (err) => {
  console.error(err);
  try { await pool.end(); } catch (_) { /* already closed */ }
  process.exit(1);
});
