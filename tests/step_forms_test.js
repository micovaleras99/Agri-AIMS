/**
 * Steps 1 (Briefer) and 2 (Self-Assessment) now use the prescribed-form
 * workflow: download the official form, complete it offline, upload the copy.
 *
 * This replaces the old signature-pad / generated-PDF tests. It confirms the
 * uploaded form is filed as the applicant's submission for that requirement,
 * that the step advances, and that Step 1 refuses to advance with the
 * declaration unticked or no file attached.
 *
 *   node tests/step_forms_test.js
 */

require('dotenv').config();

const http = require('http');
const app = require('../app');
const { pool } = require('../config/database');
const applicantModel = require('../models/applicantModel');
const documentModel = require('../models/documentModel');
const userModel = require('../models/userModel');
const { registerFarmer } = require('../services/farmerRegistration');
const { signToken } = require('../middleware/auth');
const { resolveStored } = require('../config/upload');
const fs = require('fs');

let failures = 0;
function check(label, condition) {
  console.log((condition ? 'PASS  ' : 'FAIL  ') + label);
  if (!condition) failures += 1;
}

const CSRF = 'a'.repeat(64);

/** Multipart POST with arbitrary fields and an optional file part. */
function post(server, path, token, fields, withFile) {
  return new Promise((resolve, reject) => {
    const b = '----agri' + Math.random().toString(16).slice(2);
    const f = (n, v) => `--${b}\r\nContent-Disposition: form-data; name="${n}"\r\n\r\n${v}\r\n`;
    const head = [f('_csrf', CSRF), ...Object.entries(fields).map(([k, v]) => f(k, v))].join('');
    const chunks = [Buffer.from(head, 'utf8')];
    if (withFile) {
      chunks.push(Buffer.from(
        `--${b}\r\nContent-Disposition: form-data; name="file"; filename="form.pdf"\r\n`
        + 'Content-Type: application/pdf\r\n\r\n', 'utf8'));
      chunks.push(Buffer.from('%PDF-1.4 completed form'));
      chunks.push(Buffer.from('\r\n', 'utf8'));
    }
    chunks.push(Buffer.from(`--${b}--\r\n`, 'utf8'));
    const payload = Buffer.concat(chunks);
    const req = http.request({
      host: '127.0.0.1', port: server.address().port, path, method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${b}`,
        'Content-Length': payload.length,
        Cookie: `agri_token=${token}; agri_csrf=${CSRF}`,
      },
    }, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => resolve({ status: res.statusCode, location: res.headers.location || '' }));
    });
    req.on('error', reject);
    req.end(payload);
  });
}

async function main() {
  const admin = (await userModel.findAllPublicProfiles()).find((u) => u.role === 'admin');
  if (!admin) { console.log('SKIP  no admin account'); await pool.end(); return; }

  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const token = signToken(admin);

  let userId = null;
  let applicantId = null;
  const written = [];
  try {
    const reg = await registerFarmer({
      firstName: 'Form', lastName: 'Flow',
      email: `form.flow.${Date.now()}@example.com`,
      password: 'Str0ng!Pass1', phone: '09170000000',
      farmName: 'Form Flow Farm', farmAddress: 'Test', region: 'Region V',
      createdByAdmin: false,
    });
    userId = reg.userId;
    applicantId = (await applicantModel.findByApplicationId(reg.applicationId)).id;

    console.log('--- Step 1: declaration must be ticked ---');
    const noDecl = await post(server, `/accreditation/${applicantId}/step/1`, token,
      { readBriefer: 'on' }, true);
    check('missing declaration is turned away', /error=declaration/.test(noDecl.location));
    check('and nothing was filed',
      !(await documentModel.findByApplicant(applicantId)).some((d) => d.type === 'signed_briefer'));

    console.log('\n--- Step 1: a file is required ---');
    const noFile = await post(server, `/accreditation/${applicantId}/step/1`, token,
      { readBriefer: 'on', notDisqualified: 'on', agreeResponsibilities: 'on' }, false);
    check('no upload is turned away', /error=file/.test(noFile.location));

    console.log('\n--- Step 1: download-and-upload files the briefer ---');
    const s1 = await post(server, `/accreditation/${applicantId}/step/1`, token,
      { readBriefer: 'on', notDisqualified: 'on', agreeResponsibilities: 'on' }, true);
    check(`it advances to step 2 -> ${s1.status}`, /\/step\/2/.test(s1.location));
    const briefer = (await documentModel.findByApplicant(applicantId)).find((d) => d.type === 'signed_briefer');
    check('the signed briefer is on file', !!briefer);
    check('named as the requirement, not "Document"', !!briefer && briefer.name === 'Signed Briefer');
    check('and awaiting review, not self-verified', !!briefer && briefer.status === 'pending_review');
    if (briefer) written.push(briefer.storedName);
    const after1 = await applicantModel.findById(applicantId);
    check('the application records the briefer as signed', !!after1.step1_brieferSigned);

    console.log('\n--- Step 2: upload files the self-assessment ---');
    const s2 = await post(server, `/accreditation/${applicantId}/step/2`, token, {}, true);
    check(`it advances to step 3 -> ${s2.status}`, /\/step\/3/.test(s2.location));
    const sa = (await documentModel.findByApplicant(applicantId)).find((d) => d.type === 'self_assessment');
    check('the self-assessment is on file', !!sa);
    check('pending review', !!sa && sa.status === 'pending_review');
    if (sa) written.push(sa.storedName);

    console.log('\n--- re-uploading replaces, never duplicates ---');
    await post(server, `/accreditation/${applicantId}/step/1`, token,
      { readBriefer: 'on', notDisqualified: 'on', agreeResponsibilities: 'on' }, true);
    const briefers = (await documentModel.findByApplicant(applicantId)).filter((d) => d.type === 'signed_briefer');
    check('still exactly one signed briefer', briefers.length === 1);
    if (briefers[0]) written.push(briefers[0].storedName);
  } finally {
    await new Promise((r) => server.close(r));
    if (applicantId) await pool.execute('DELETE FROM applicants WHERE id = ?', [applicantId]);
    if (userId) await pool.execute('DELETE FROM users WHERE id = ?', [userId]);
    for (const name of new Set(written.filter(Boolean))) {
      const p = resolveStored(name);
      if (p && fs.existsSync(p)) fs.unlinkSync(p);
    }
    await pool.end();
  }

  console.log('');
  if (failures) { console.log(failures + ' CHECK(S) FAILED'); process.exitCode = 1; }
  else console.log('ALL STEP-FORM CHECKS PASSED');
}

main().catch(async (err) => {
  console.error(err);
  try { await pool.end(); } catch (_) { /* already closed */ }
  process.exit(1);
});
