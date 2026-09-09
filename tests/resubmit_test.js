/**
 * The reject -> re-submit -> accept cycle.
 *
 * Confirms the behaviour end to end:
 *   - a rejected document keeps its file on disk (nothing is destroyed on a
 *     rejection — the applicant and reviewer can still see what was returned);
 *   - the rejection notice links the owner straight to the re-submission form
 *     for that requirement, not just back to the list;
 *   - re-uploading the same requirement REPLACES the returned file (the old
 *     stored file is deleted from disk) and the new one returns to
 *     pending_review;
 *   - the evaluator can then accept it.
 *
 *   node tests/resubmit_test.js
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const http = require('http');
const app = require('../app');
const { pool } = require('../config/database');
const documentModel = require('../models/documentModel');
const applicantModel = require('../models/applicantModel');
const userModel = require('../models/userModel');
const notificationModel = require('../models/notificationModel');
const { registerFarmer } = require('../services/farmerRegistration');
const { signToken } = require('../middleware/auth');
const { UPLOAD_DIR } = require('../config/upload');

let failures = 0;
function check(label, condition) {
  console.log((condition ? 'PASS  ' : 'FAIL  ') + label);
  if (!condition) failures += 1;
}

const CSRF = 'f'.repeat(64);

function post(server, p, token, body) {
  return new Promise((resolve, reject) => {
    const payload = new URLSearchParams(body).toString();
    const req = http.request({
      host: '127.0.0.1', port: server.address().port, path: p, method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(payload),
        Cookie: `agri_token=${token}; agri_csrf=${CSRF}`,
      },
    }, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => resolve({ status: res.statusCode, location: res.headers.location, text: d }));
    });
    req.on('error', reject);
    req.end(payload);
  });
}

/** Multipart upload of a tiny PDF for one requirement. */
function upload(server, token, applicantId, docType, docName, bytes) {
  return new Promise((resolve, reject) => {
    const b = '----agriTest' + Math.random().toString(16).slice(2);
    const parts = [];
    const field = (n, v) => `--${b}\r\nContent-Disposition: form-data; name="${n}"\r\n\r\n${v}\r\n`;
    parts.push(field('_csrf', CSRF));
    parts.push(field('applicantId', String(applicantId)));
    parts.push(field('docType', docType));
    parts.push(field('docName', docName));
    parts.push(`--${b}\r\nContent-Disposition: form-data; name="file"; filename="doc.pdf"\r\n`
      + 'Content-Type: application/pdf\r\n\r\n');
    const head = Buffer.from(parts.join(''), 'utf8');
    const file = Buffer.from(bytes);
    const tail = Buffer.from(`\r\n--${b}--\r\n`, 'utf8');
    const payload = Buffer.concat([head, file, tail]);
    const req = http.request({
      host: '127.0.0.1', port: server.address().port, path: '/documents/submit', method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${b}`,
        'Content-Length': payload.length,
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

const PDF = '%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n';

async function main() {
  const staff = (await userModel.findAllPublicProfiles()).find((u) => u.role === 'evaluator')
    || (await userModel.findAllPublicProfiles()).find((u) => u.role === 'admin');
  if (!staff) { console.log('SKIP  no reviewer account'); await pool.end(); return; }

  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const stamp = Date.now();
  let userId = null;
  let applicantId = null;

  try {
    const reg = await registerFarmer({
      firstName: 'Resub', lastName: 'Mitter', email: `resub.${stamp}@my.cspc.edu.ph`,
      password: 'Str0ng!Pass1', phone: '09170000000', role: 'applicant',
      farmName: 'Resubmit Farm', farmAddress: 'Nabua',
      region: 'Region V', province: 'Camarines Sur', municipality: 'Nabua',
    });
    userId = reg.userId;
    const applicant = await applicantModel.findByApplicationId(reg.applicationId);
    applicantId = applicant.id;
    const applicantToken = signToken(await userModel.findById(userId));
    const staffToken = signToken(staff);

    console.log('--- first upload ---');
    const first = await upload(server, applicantToken, applicantId, 'endorsement',
      'LGU Endorsement', PDF + 'FIRST');
    check(`accepted -> ${first.status}`, /success=(submitted|replaced)/.test(first.location || ''));
    let docs = await documentModel.findByApplicant(applicantId);
    let doc = docs.find((d) => d.type === 'endorsement');
    check('the document exists and is pending review', !!doc && doc.status === 'pending_review');
    const firstStored = doc.storedName;
    check('its file is on disk', !!firstStored && fs.existsSync(path.join(UPLOAD_DIR, firstStored)));

    console.log('\n--- the reviewer rejects it with a reason ---');
    const rejected = await post(server, `/documents/${doc.id}/review`, staffToken,
      { _csrf: CSRF, status: 'incomplete', remarks: 'The endorsement is unsigned.' });
    check('the rejection is recorded', /success=rejected/.test(rejected.location || ''));
    doc = await documentModel.findById(doc.id);
    check(`the document is marked incomplete (${doc.status})`, doc.status === 'incomplete');
    check('with the reason stored', doc.remarks === 'The endorsement is unsigned.');
    check('and the returned file is STILL on disk', fs.existsSync(path.join(UPLOAD_DIR, firstStored)));

    console.log('\n--- the applicant is told, and pointed at re-submission ---');
    const notes = await notificationModel.findForUser(userId, { limit: 10 });
    const reject = notes.find((n) => n.type === 'document_rejected');
    check('a rejection notice was sent', !!reject);
    check('linking to the re-submit form for this requirement',
      !!reject && reject.link.includes('/documents/submit')
      && reject.link.includes('type=endorsement'));

    console.log('\n--- the documents page offers the owner a Re-submit action ---');
    const page = await new Promise((res) => http.get({
      host: '127.0.0.1', port: server.address().port, path: '/documents',
      headers: { Cookie: `agri_token=${applicantToken}` },
    }, (r) => { let d = ''; r.on('data', (c) => { d += c; }); r.on('end', () => res(d)); }));
    check('a Re-submit link is shown on the returned document',
      page.includes('doc-item__resubmit') && page.includes('type=endorsement'));

    console.log('\n--- re-submitting replaces the returned file ---');
    const second = await upload(server, applicantToken, applicantId, 'endorsement',
      'LGU Endorsement', PDF + 'SECOND-CORRECTED');
    check('the replacement is accepted', /success=replaced/.test(second.location || ''));
    docs = await documentModel.findByApplicant(applicantId);
    const fresh = docs.filter((d) => d.type === 'endorsement');
    check('there is still exactly one endorsement row', fresh.length === 1);
    doc = fresh[0];
    check(`it is a new file (${doc.storedName !== firstStored})`, doc.storedName !== firstStored);
    check('the new file is on disk', fs.existsSync(path.join(UPLOAD_DIR, doc.storedName)));
    check('the OLD returned file was deleted from disk',
      !fs.existsSync(path.join(UPLOAD_DIR, firstStored)));
    check(`and it is back to pending review (${doc.status})`, doc.status === 'pending_review');

    console.log('\n--- which the reviewer can now accept ---');
    const accepted = await post(server, `/documents/${doc.id}/review`, staffToken,
      { _csrf: CSRF, status: 'verified', remarks: '' });
    check('the acceptance is recorded', /success=accepted/.test(accepted.location || ''));
    check('the document is verified', (await documentModel.findById(doc.id)).status === 'verified');
  } finally {
    await new Promise((r) => server.close(r));
    if (applicantId) {
      await documentModel.removeForApplicant(applicantId).catch(() => {});
      await pool.execute('DELETE FROM applicants WHERE id = ?', [applicantId]).catch(() => {});
    }
    if (userId) {
      await pool.execute('DELETE FROM notifications WHERE user_id = ?', [userId]).catch(() => {});
      await pool.execute('DELETE FROM users WHERE id = ?', [userId]).catch(() => {});
    }
    await pool.execute('DELETE FROM notifications WHERE title LIKE ?', ['%LGU Endorsement%']).catch(() => {});
    await pool.end();
  }

  console.log('');
  if (failures) {
    console.log(failures + ' CHECK(S) FAILED');
    process.exitCode = 1;
  } else {
    console.log('ALL RESUBMIT CHECKS PASSED');
  }
}

main().catch(async (err) => {
  console.error(err);
  try { await pool.end(); } catch (_) { /* already closed */ }
  process.exit(1);
});
