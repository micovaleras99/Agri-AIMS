/**
 * Account lifecycle: One User = One Applicant, but deactivating the user must
 * never delete the applicant's records (the six scenarios in the spec).
 *
 * Requires migration 040_account_lifecycle.sql to be applied first.
 *
 *   node tests/account_lifecycle_test.js
 */

require('dotenv').config();

const http = require('http');
const app = require('../app');
const { pool } = require('../config/database');
const userModel = require('../models/userModel');
const applicantModel = require('../models/applicantModel');
const { signToken } = require('../middleware/auth');

let failures = 0;
function check(label, condition) {
  console.log((condition ? 'PASS  ' : 'FAIL  ') + label);
  if (!condition) failures += 1;
}

function request(server, method, path, { token, body } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const headers = { 'Content-Type': 'application/json' };
    if (payload) headers['Content-Length'] = Buffer.byteLength(payload);
    if (token) headers.Authorization = `Bearer ${token}`;
    const req = http.request(
      { host: '127.0.0.1', port: server.address().port, path, method, headers },
      (res) => {
        let d = '';
        res.on('data', (c) => { d += c; });
        res.on('end', () => {
          let json = null;
          try { json = JSON.parse(d); } catch (_) { /* not json */ }
          resolve({ status: res.statusCode, json });
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function main() {
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));

  const madeUsers = [];
  const madeApplicants = [];
  const stamp = Date.now();
  const pass = 'Str0ng!Pass1';

  try {
    const admin = (await userModel.findAllPublicProfiles()).find((u) => u.role === 'admin');
    if (!admin) { console.log('SKIP  no admin account to act as'); return; }
    const adminToken = signToken(admin);

    console.log('--- Test 1: normal registration creates exactly one applicant ---');
    const email = `lifecycle.${stamp}@example.com`;
    const reg = await request(server, 'POST', '/api/auth/register', {
      body: {
        firstName: 'Life', lastName: 'Cycle', email, password: pass,
        role: 'applicant', farmName: 'Lifecycle Farm', farmAddress: 'Naga',
        region: 'Region V', province: 'Camarines Sur', municipality: 'Naga City',
      },
    });
    check(`registration succeeds -> ${reg.status}`, reg.status === 201);
    const userId = reg.json && reg.json.data && reg.json.data.user && reg.json.data.user.id;
    const applicationId = reg.json && reg.json.data && reg.json.data.applicationId;
    if (userId) madeUsers.push(userId);
    const applicant = applicationId ? await applicantModel.findByApplicationId(applicationId) : null;
    if (applicant) madeApplicants.push(applicant.id);
    check('an applicant profile exists', !!applicant);
    const dupCount = (await pool.query('SELECT COUNT(*) AS c FROM applicants WHERE application_id = ?', [applicationId]))[0][0].c;
    check(`exactly one applicant for the application id (${dupCount})`, Number(dupCount) === 1);

    // Seed one accreditation record to prove it is preserved later.
    await pool.execute(
      "INSERT INTO documents (applicant_id, application_id, name, type, status) VALUES (?,?,?,?,?)",
      [applicant.id, applicationId, 'Letter of Intent', 'letter_of_intent', 'pending_review']
    );

    console.log('\n--- Test 2: duplicate registration is prevented ---');
    const dup = await request(server, 'POST', '/api/auth/register', {
      body: {
        firstName: 'Life', lastName: 'Cycle', email, password: pass,
        role: 'applicant', farmName: 'Second Farm', farmAddress: 'Naga',
        region: 'Region V', province: 'Camarines Sur', municipality: 'Naga City',
      },
    });
    check(`a second registration with the same email is rejected -> ${dup.status}`, dup.status === 409);
    const stillOne = (await pool.query('SELECT COUNT(*) AS c FROM applicants WHERE application_id = ?', [applicationId]))[0][0].c;
    check(`no duplicate applicant was created (${stillOne})`, Number(stillOne) === 1);

    console.log('\n--- Test 3: deactivation disables login but preserves records ---');
    const deact = await request(server, 'POST', `/api/users/${userId}/deactivate`, { token: adminToken });
    check(`deactivate succeeds -> ${deact.status}`, deact.status === 200);
    const loginBlocked = await request(server, 'POST', '/api/auth/login', { body: { email, password: pass } });
    check(`login is blocked while deactivated -> ${loginBlocked.status}`, loginBlocked.status === 403);
    const applicantAfter = await applicantModel.findByApplicationId(applicationId);
    check('the applicant record still exists', !!applicantAfter);
    const docsAfter = (await pool.query('SELECT COUNT(*) AS c FROM documents WHERE applicant_id = ?', [applicant.id]))[0][0].c;
    check(`the applicant's documents are preserved (${docsAfter})`, Number(docsAfter) === 1);

    console.log('\n--- Test 4: reactivation restores login, no duplicate applicant ---');
    const react = await request(server, 'POST', `/api/users/${userId}/reactivate`, { token: adminToken });
    check(`reactivate succeeds -> ${react.status}`, react.status === 200);
    const loginOk = await request(server, 'POST', '/api/auth/login', { body: { email, password: pass } });
    check(`login works again -> ${loginOk.status}`, loginOk.status === 200);
    const oneApplicant = (await pool.query('SELECT COUNT(*) AS c FROM applicants WHERE application_id = ?', [applicationId]))[0][0].c;
    check(`still exactly one applicant (${oneApplicant})`, Number(oneApplicant) === 1);

    console.log('\n--- Test 5: re-link a new account to the existing applicant ---');
    const newAcct = await request(server, 'POST', '/api/users', {
      token: adminToken,
      body: {
        firstName: 'Recovered', lastName: 'Login', email: `recovered.${stamp}@example.com`,
        password: pass, role: 'applicant',
      },
    });
    check(`admin creates a replacement account -> ${newAcct.status}`, newAcct.status === 201);
    const newUserId = newAcct.json && newAcct.json.data && newAcct.json.data.id;
    if (newUserId) madeUsers.push(newUserId);

    // The original account is still active, so re-linking a second active
    // account to the same applicant must be refused by the DB constraint.
    const blockedRelink = await request(server, 'POST', `/api/users/${newUserId}/relink`, {
      token: adminToken, body: { applicationId },
    });
    check(`a second active account cannot claim the applicant -> ${blockedRelink.status}`, blockedRelink.status === 409);

    // Deactivate the original, then re-link the new account. This is the real
    // recovery flow: old login retired, new login attached to the same record.
    await request(server, 'POST', `/api/users/${userId}/deactivate`, { token: adminToken });
    const relink = await request(server, 'POST', `/api/users/${newUserId}/relink`, {
      token: adminToken, body: { applicationId },
    });
    check(`re-link to the existing applicant succeeds -> ${relink.status}`, relink.status === 200);
    const afterRelink = await userModel.findById(newUserId);
    check('the new account points at the original applicant', afterRelink && afterRelink.applicationId === applicationId);
    const noDup = (await pool.query('SELECT COUNT(*) AS c FROM applicants WHERE application_id = ?', [applicationId]))[0][0].c;
    check(`no duplicate applicant profile was created (${noDup})`, Number(noDup) === 1);

    console.log('\n--- Test 6: the audit trail recorded the actions ---');
    const audit = await request(server, 'GET', `/api/users/${newUserId}/audit`, { token: adminToken });
    const actions = (audit.json && audit.json.data || []).map((e) => e.action);
    check('re-link is in the audit trail', actions.includes('relinked'));
    check('deactivation is in the audit trail (by application id)', actions.includes('deactivated'));
  } finally {
    await new Promise((r) => server.close(r));
    for (const id of madeApplicants) {
      await pool.execute('DELETE FROM applicants WHERE id = ?', [id]).catch(() => {});
    }
    for (const id of madeUsers) {
      await pool.execute('DELETE FROM account_audit WHERE user_id = ?', [id]).catch(() => {});
      await pool.execute('DELETE FROM users WHERE id = ?', [id]).catch(() => {});
    }
    await pool.end();
  }

  console.log('');
  if (failures) {
    console.log(failures + ' CHECK(S) FAILED');
    process.exitCode = 1;
  } else {
    console.log('ALL ACCOUNT LIFECYCLE CHECKS PASSED');
  }
}

main().catch(async (err) => {
  console.error(err);
  try { await pool.end(); } catch (_) { /* already closed */ }
  process.exit(1);
});
