/**
 * Registration must collect what the application is then judged on.
 *
 * The self-registration form asked for name, email, phone, farm name, farm
 * address and location — and nothing else. The staff edit form marks LSA Type,
 * Applicant Category, LSA Classification and Farm Area as required, and the
 * record was created without ever asking for them:
 *
 *   farmArea       0   → checkArea() reports "not been recorded yet", so every
 *                        self-registration failed the minimum-area rule
 *   classification ''  → the Applications list showed a blank Classification
 *   category       'private' assumed
 *
 * The last one is the damaging one: `totalDocs` is computed AT REGISTRATION
 * from category and classification, so a farmers' organisation or an
 * agri-processing enterprise was handed the private-farm document list.
 *
 *   node tests/registration_test.js
 */

require('dotenv').config();

const fs = require('fs');
const http = require('http');
const app = require('../app');
const { pool } = require('../config/database');
const applicantModel = require('../models/applicantModel');
const { requirementsFor } = require('../config/documentRequirements');
const { checkArea } = require('../config/farmEligibility');

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

function get(server, path) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: server.address().port, path }, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => resolve({ status: res.statusCode, text: d }));
    }).on('error', reject);
  });
}

async function main() {
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const madeUsers = [];
  const madeApplicants = [];

  try {
    console.log('--- the form asks for them ---');
    const page = await get(server, '/');
    check('the login page renders', page.status === 200);
    for (const id of ['regFarmArea', 'regLsaType', 'regCategory', 'regClassification', 'regRsbsa']) {
      check(`the registration form has ${id}`, page.text.includes(`id="${id}"`));
    }
    // The classification list must be the real one, not a hand-typed copy.
    check('and the classification list comes from the config',
      page.text.includes('Agri-Processing LSA') && page.text.includes('Farming LSA'));

    console.log('\n--- an organisation registering keeps its own answers ---');
    const stamp = Date.now();
    const res = await postJson(server, '/api/auth/register', {
      firstName: 'Org', lastName: 'Tester',
      email: `org.reg.${stamp}@example.com`,
      password: 'Str0ng!Pass1',
      phone: '09170000000',
      role: 'applicant',
      farmName: 'Nabua Farmers Association',
      farmAddress: 'Nabua',
      region: 'Region V', province: 'Camarines Sur', municipality: 'Nabua',
      farmArea: '2500',
      lsaType: 'coco',
      category: 'organization',
      classification: 'coconut',
      rsbsaNumber: '05-24-01-001-000123',
    });
    check(`registration succeeds -> ${res.status}`, res.status === 201);
    const applicationId = res.json && res.json.data && res.json.data.applicationId;
    check('and returns an application id', !!applicationId);
    if (res.json && res.json.data && res.json.data.user) madeUsers.push(res.json.data.user.id);

    const app1 = await applicantModel.findByApplicationId(applicationId);
    if (app1) madeApplicants.push(app1.id);
    check(`the farm area was stored (${app1 && app1.farmArea})`, app1 && Number(app1.farmArea) === 2500);
    check(`the category was stored (${app1 && app1.category})`, app1 && app1.category === 'organization');
    check(`the classification was stored (${app1 && app1.classification})`,
      app1 && app1.classification === 'coconut');
    check(`the LSA type was stored (${app1 && app1.lsaType})`, app1 && app1.lsaType === 'coco');
    check('and the RSBSA number was stored', app1 && app1.rsbsaNumber === '05-24-01-001-000123');

    console.log('\n--- which changes what the application is judged on ---');
    // The area rule can now be evaluated at all; before, farmArea was 0 and
    // checkArea() returned meets: null for every self-registration.
    const area = checkArea(app1);
    check(`the minimum-area rule can be evaluated (meets: ${area.meets})`, area.meets !== null);

    // The document list follows category and classification, and is fixed at
    // registration. An organisation owes more than a private farm.
    const owed = requirementsFor(app1).length;
    const asPrivate = requirementsFor({ ...app1, category: 'private', classification: '' }).length;
    check(`an organisation owes more documents than the private default (${owed} vs ${asPrivate})`,
      owed > asPrivate);
    check(`and totalDocs was stored as that number (${app1 && app1.totalDocs})`,
      app1 && Number(app1.totalDocs) === owed);

    console.log('\n--- leaving them out still works ---');
    // The fields are new; a caller that omits them must not break, and must
    // fall back to the same defaults as before.
    const bare = await postJson(server, '/api/auth/register', {
      firstName: 'Bare', lastName: 'Tester',
      email: `bare.reg.${stamp}@example.com`,
      password: 'Str0ng!Pass1',
      phone: '09170000000',
      role: 'applicant',
      farmName: 'Bare Farm', farmAddress: 'Iriga',
      region: 'Region V', province: 'Camarines Sur', municipality: 'City of Iriga',
    });
    check(`a registration without them still succeeds -> ${bare.status}`, bare.status === 201);
    if (bare.json && bare.json.data) {
      if (bare.json.data.user) madeUsers.push(bare.json.data.user.id);
      const app2 = await applicantModel.findByApplicationId(bare.json.data.applicationId);
      if (app2) madeApplicants.push(app2.id);
      check('and falls back to the previous defaults',
        app2 && app2.category === 'private' && app2.lsaType === 'regular');
    }
  } finally {
    await new Promise((r) => server.close(r));
    for (const id of madeApplicants) {
      await pool.execute('DELETE FROM applicants WHERE id = ?', [id]).catch(() => {});
    }
    for (const id of madeUsers) {
      await pool.execute('DELETE FROM users WHERE id = ?', [id]).catch(() => {});
    }
    // Registration now returns needsOtp (no logged-in user in the body), so the
    // created accounts aren't captured above — remove them by their test emails
    // (these fixed prefixes are used only by this test).
    await pool.execute("DELETE FROM users WHERE email LIKE 'org.reg.%@example.com' OR email LIKE 'bare.reg.%@example.com'").catch(() => {});
    await pool.end();
  }

  console.log('');
  if (failures) {
    console.log(failures + ' CHECK(S) FAILED');
    process.exitCode = 1;
  } else {
    console.log('ALL REGISTRATION CHECKS PASSED');
  }
}

main().catch(async (err) => {
  console.error(err);
  try { await pool.end(); } catch (_) { /* already closed */ }
  process.exit(1);
});
