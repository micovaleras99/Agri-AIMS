/**
 * The central-office submission package (client §14, §15).
 *
 * GET /documents/package/:applicantId returns a .zip of the application's
 * verified documents, for the admin to email to ATI Central Office. Only staff
 * may download it; an application with nothing validated yet is turned away
 * rather than handed an empty archive.
 *
 *   node tests/package_test.js
 */

require('dotenv').config();

const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const app = require('../app');
const { pool } = require('../config/database');
const { UPLOAD_DIR } = require('../config/upload');
const applicantModel = require('../models/applicantModel');
const documentModel = require('../models/documentModel');
const userModel = require('../models/userModel');
const { registerFarmer } = require('../services/farmerRegistration');
const { signToken } = require('../middleware/auth');
const path = require('path');

let failures = 0;
function check(label, condition) {
  console.log((condition ? 'PASS  ' : 'FAIL  ') + label);
  if (!condition) failures += 1;
}

function get(server, p, token) {
  return new Promise((resolve, reject) => {
    http.get({
      host: '127.0.0.1', port: server.address().port, path: p,
      headers: token ? { Cookie: `agri_token=${token}` } : {},
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({
        status: res.statusCode,
        type: res.headers['content-type'] || '',
        disposition: res.headers['content-disposition'] || '',
        location: res.headers.location || '',
        body: Buffer.concat(chunks),
      }));
    }).on('error', reject);
  });
}

/** A stored file on disk under a valid random name, so packaging can read it. */
function putFile(bytes) {
  const name = crypto.randomBytes(16).toString('hex') + '.pdf';
  fs.writeFileSync(path.join(UPLOAD_DIR, name), bytes);
  return name;
}

async function main() {
  const users = await userModel.findAllPublicProfiles();
  const admin = users.find((u) => u.role === 'admin');
  if (!admin) { console.log('SKIP  no admin account'); await pool.end(); return; }

  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));

  let userId = null;
  let applicantId = null;
  const stored = [];
  try {
    const reg = await registerFarmer({
      firstName: 'Package', lastName: 'Test',
      email: `package.test.${Date.now()}@example.com`,
      password: 'Str0ng!Pass1', phone: '09170000000',
      farmName: 'Package Farm', farmAddress: 'Test', region: 'Region V',
      createdByAdmin: false,
    });
    userId = reg.userId;
    applicantId = (await applicantModel.findByApplicationId(reg.applicationId)).id;
    const token = signToken(admin);

    console.log('--- nothing validated yet ---');
    const empty = await get(server, `/documents/package/${applicantId}`, token);
    check('an application with no validated docs is turned away',
      empty.status === 302 && /nopackage=1/.test(empty.location));

    console.log('\n--- with two verified documents ---');
    const mk = async (type, name, body) => {
      const storedName = putFile(Buffer.from(body));
      stored.push(storedName);
      await documentModel.create({
        applicantId, applicationId: reg.applicationId, applicantName: 'Package Test',
        name, type, filename: `${type}.pdf`, storedName,
        mimeType: 'application/pdf', sizeBytes: body.length, size: '1 KB',
        uploadDate: new Date().toISOString().split('T')[0], status: 'verified', remarks: '',
      });
    };
    await mk('signed_briefer', 'Signed Briefer', '%PDF-1.4 briefer');
    await mk('lsa1_field_validation_report', 'Field Validation Report', '%PDF-1.4 report');

    const zip = await get(server, `/documents/package/${applicantId}`, token);
    check(`the package downloads -> ${zip.status}`, zip.status === 200);
    check('as a zip', /application\/zip/.test(zip.type));
    check('named for the application', /Application_.*_Validated_Documents\.zip/.test(zip.disposition));
    check('and it is a real zip (PK header)', zip.body.slice(0, 2).toString('latin1') === 'PK');
    check('containing both verified files', (() => {
      const s = zip.body.toString('latin1');
      return s.includes('Signed Briefer.pdf') && s.includes('Field Validation Report.pdf');
    })());

    console.log('\n--- only staff may download it ---');
    const applicant = users.find((u) => u.role === 'applicant');
    if (applicant) {
      const forbidden = await get(server, `/documents/package/${applicantId}`, signToken(applicant));
      check('an applicant is refused -> 403', forbidden.status === 403);
    } else {
      console.log('SKIP  no applicant account to check the guard');
    }
  } finally {
    await new Promise((r) => server.close(r));
    if (applicantId) await documentModel.removeWhere('applicant_id = ?', [applicantId]).catch(() => {});
    if (applicantId) await pool.execute('DELETE FROM applicants WHERE id = ?', [applicantId]);
    if (userId) await pool.execute('DELETE FROM users WHERE id = ?', [userId]);
    for (const name of stored) {
      try { fs.unlinkSync(path.join(UPLOAD_DIR, name)); } catch (_) { /* already gone */ }
    }
    await pool.end();
  }

  console.log('');
  if (failures) { console.log(failures + ' CHECK(S) FAILED'); process.exitCode = 1; }
  else console.log('ALL PACKAGE CHECKS PASSED');
}

main().catch(async (err) => {
  console.error(err);
  try { await pool.end(); } catch (_) { /* already closed */ }
  process.exit(1);
});
