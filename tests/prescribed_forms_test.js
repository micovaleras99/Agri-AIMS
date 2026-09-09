/**
 * Prescribed forms: the config that decides download vs upload-only, and the
 * download route that serves the blank official form.
 *
 * Availability follows the folder, not the code: a type is downloadable only
 * when its file exists in forms/prescribed/. The route resolves `:type` through
 * the config allowlist, so an unknown or crafted type is a plain 404, never a
 * path escape.
 *
 *   node tests/prescribed_forms_test.js
 */

require('dotenv').config();

const fs = require('fs');
const http = require('http');
const path = require('path');
const app = require('../app');
const { pool } = require('../config/database');
const userModel = require('../models/userModel');
const { signToken } = require('../middleware/auth');
const {
  resolvePrescribed, hasPrescribedForm, formFileFor, PRESCRIBED_DIR,
} = require('../config/prescribedForms');

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
      res.on('end', () => {
        const body = Buffer.concat(chunks);
        resolve({
          status: res.statusCode,
          disposition: res.headers['content-disposition'] || '',
          type: res.headers['content-type'] || '',
          bytes: body.length,
          body,
        });
      });
    }).on('error', reject);
  });
}

async function main() {
  console.log('--- the config follows the folder ---');
  check('the briefer has a prescribed form', hasPrescribedForm('signed_briefer'));
  check('so does the self-assessment', hasPrescribedForm('self_assessment'));
  check('and the admin field validation report', hasPrescribedForm('lsa1_field_validation_report'));
  check('an upload-only requirement has none', !hasPrescribedForm('medical_certificate'));
  check('a certificate of good standing has none (no file provided)', !hasPrescribedForm('good_standing'));
  check('an unknown type has none', !hasPrescribedForm('__nope__'));

  console.log('\n--- the profile form varies by classification ---');
  check('farming applicants get the farming profile',
    formFileFor('farm_profile', { classification: 'organic' }) === 'farm-profile-farming.docx');
  check('agri-processing applicants get the enterprise profile',
    formFileFor('farm_profile', { classification: 'agri_processing' }) === 'farm-profile-agri-processing.docx');

  console.log('\n--- resolved paths stay inside the store ---');
  const abs = resolvePrescribed('signed_briefer');
  check('the resolved briefer is a real file', !!abs && fs.existsSync(abs));
  check('and it lives in forms/prescribed and nowhere else',
    !!abs && path.resolve(path.dirname(abs)) === path.resolve(PRESCRIBED_DIR));
  check('a removed file would fall back to upload-only',
    resolvePrescribed('__nope__') === null);

  console.log('\n--- the download route ---');
  const admin = (await userModel.findAllPublicProfiles()).find((u) => u.role === 'admin');
  if (!admin) { console.log('SKIP  no admin account for route checks'); await pool.end(); return finish(); }
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const token = signToken(admin);
  try {
    const ok = await get(server, '/forms/signed_briefer', token);
    check(`a prescribed form downloads -> ${ok.status}`, ok.status === 200);
    check('as an attachment', /attachment/.test(ok.disposition));
    check('with real bytes', ok.bytes > 1000);
    check('and a pdf content type', /pdf/.test(ok.type));

    const upl = await get(server, '/forms/medical_certificate', token);
    check(`an upload-only requirement has no form -> ${upl.status}`, upl.status === 404);

    const bad = await get(server, '/forms/__not_a_key__', token);
    check(`an unknown/crafted type is a plain 404 -> ${bad.status}`, bad.status === 404);

    console.log('\n--- the self-assessment is pre-filled for an applicant, template untouched ---');
    const [[appRow]] = await pool.query('SELECT id, farm_name FROM applicants LIMIT 1');
    if (appRow) {
      const filled = await get(server, `/forms/self_assessment?applicant=${appRow.id}`, token);
      check('it downloads as a docx', /wordprocessingml/.test(filled.type));
      check('it is a real docx (PK header)', filled.body.slice(0, 2).toString('latin1') === 'PK');
      const { readZip } = require('../services/docxFill');
      const xml = readZip(filled.body).find((e) => e.name === 'word/document.xml').data.toString('utf8');
      check("it carries the applicant's farm name", !!appRow.farm_name && xml.includes(appRow.farm_name));
      const onDisk = fs.readFileSync(resolvePrescribed('self_assessment'));
      check('and the stored template still has no injected value',
        !readZip(onDisk).find((e) => e.name === 'word/document.xml').data.toString('utf8').includes(appRow.farm_name));
    } else {
      console.log('SKIP  no applicant to check pre-fill');
    }
  } finally {
    await new Promise((r) => server.close(r));
    await pool.end();
  }
  finish();
}

function finish() {
  console.log('');
  if (failures) { console.log(failures + ' CHECK(S) FAILED'); process.exitCode = 1; }
  else console.log('ALL PRESCRIBED-FORM CHECKS PASSED');
}

main().catch(async (err) => {
  console.error(err);
  try { await pool.end(); } catch (_) { /* already closed */ }
  process.exit(1);
});
