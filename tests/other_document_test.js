/**
 * Staff can file a document outside an applicant's standard checklist.
 *
 * The submit form shows an applicant's own requirements. Staff sometimes need
 * to attach a type that is not on that list — an agri-processing permit for a
 * farm later reclassified, a one-off. The "Other document" option posts the
 * sentinel __other__ plus the real type in docTypeOther, and the route resolves
 * it. This confirms the type is stored correctly and that "Other" with no type
 * chosen is refused rather than stored as an empty type.
 *
 *   node tests/other_document_test.js
 */

require('dotenv').config();

const http = require('http');
const app = require('../app');
const { pool } = require('../config/database');
const documentModel = require('../models/documentModel');
const applicantModel = require('../models/applicantModel');
const userModel = require('../models/userModel');
const { signToken } = require('../middleware/auth');

let failures = 0;
function check(label, condition) {
  console.log((condition ? 'PASS  ' : 'FAIL  ') + label);
  if (!condition) failures += 1;
}

const CSRF = 'a'.repeat(64);

function upload(server, token, applicantId, fields) {
  return new Promise((resolve, reject) => {
    const b = '----agri' + Math.random().toString(16).slice(2);
    const parts = [];
    const f = (n, v) => `--${b}\r\nContent-Disposition: form-data; name="${n}"\r\n\r\n${v}\r\n`;
    parts.push(f('_csrf', CSRF));
    parts.push(f('applicantId', String(applicantId)));
    Object.entries(fields).forEach(([k, v]) => parts.push(f(k, v)));
    parts.push(`--${b}\r\nContent-Disposition: form-data; name="file"; filename="d.pdf"\r\n`
      + 'Content-Type: application/pdf\r\n\r\n');
    const payload = Buffer.concat([
      Buffer.from(parts.join(''), 'utf8'),
      Buffer.from('%PDF-1.4 test'),
      Buffer.from(`\r\n--${b}--\r\n`, 'utf8'),
    ]);
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

async function main() {
  const admin = (await userModel.findAllPublicProfiles()).find((u) => u.role === 'admin');
  if (!admin) { console.log('SKIP  no admin account'); await pool.end(); return; }

  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const token = signToken(admin);
  const [[a]] = await pool.query('SELECT id FROM applicants LIMIT 1');
  const OTHER = 'dti_sec_registration'; // agri-processing; not a private-farm requirement
  let madeId = null;

  try {
    console.log('--- the option and catalogue are offered to staff ---');
    const page = await get(server, `/documents/submit?applicant=${a.id}`, token);
    check('the "Other document" option is present', page.text.includes('value="__other__"'));
    check('with the full document-type catalogue', page.text.includes('name="docTypeOther"'));

    console.log('\n--- an applicant is NOT offered it ---');
    const applicantUser = (await userModel.findAllPublicProfiles()).find((u) => u.role === 'applicant');
    if (applicantUser) {
      const ap = await get(server, '/documents/submit', signToken(applicantUser));
      check('the applicant form has no Other option', !ap.text.includes('value="__other__"'));
    } else {
      console.log('SKIP  no applicant account to check exclusion');
    }

    console.log('\n--- staff file a type outside the checklist ---');
    const before = (await documentModel.findByApplicant(a.id)).some((d) => d.type === OTHER);
    const res = await upload(server, token, a.id, { docType: '__other__', docTypeOther: OTHER });
    check(`it is accepted -> ${res.status}`, /success=(submitted|replaced)/.test(res.location || ''));
    const doc = (await documentModel.findByApplicant(a.id)).find((d) => d.type === OTHER);
    check('the document is stored with the chosen type', !!doc && doc.type === OTHER);
    check('and its proper label, not "Document"', !!doc && doc.name === 'DTI or SEC Registration');
    check('pending review like any submission', !!doc && doc.status === 'pending_review');
    if (doc && !before) madeId = doc.id;

    console.log('\n--- "Other" with no type chosen is refused ---');
    const bad = await upload(server, token, a.id, { docType: '__other__', docTypeOther: '' });
    check('the submission is turned away, not stored empty', /error=type&pick=1/.test(bad.location || ''));
    const empties = (await documentModel.findByApplicant(a.id)).filter((d) => !d.type);
    check('no empty-type row was created', empties.length === 0);
  } finally {
    await new Promise((r) => server.close(r));
    if (madeId) await documentModel.removeWhere('id = ?', [madeId]).catch(() => {});
    await pool.end();
  }

  console.log('');
  if (failures) {
    console.log(failures + ' CHECK(S) FAILED');
    process.exitCode = 1;
  } else {
    console.log('ALL OTHER-DOCUMENT CHECKS PASSED');
  }
}

main().catch(async (err) => {
  console.error(err);
  try { await pool.end(); } catch (_) { /* already closed */ }
  process.exit(1);
});
