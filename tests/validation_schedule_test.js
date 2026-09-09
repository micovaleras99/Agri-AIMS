/**
 * The evaluator dashboard's Field/Virtual Validation panel shows real data.
 *
 * It was four hard-coded farms — Green Valley Organic Farm, Villanueva Natural
 * Farm, Morales Organic Herb Garden, Sunrise Rice Farm — none of which exist in
 * the database, with invented March-2026 dates. The real data is on the
 * applicant: step5_validation_date/_type/_result, written when a validation is
 * performed. The panel now derives from the applications: those past document
 * review are "awaiting a visit", those with a validation recorded are
 * "validated", and applications still in the document stage do not appear.
 *
 *   node tests/validation_schedule_test.js
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

/** The rows of the validation panel, as flattened cell text. */
function validationCells(html) {
  const section = html.split('Field/Virtual Validation Schedule')[1] || '';
  const table = section.split('</table>')[0] || '';
  return [...table.matchAll(/>([^<>]+)<\/td>/g)].map((m) => m[1].trim()).filter(Boolean).join(' | ');
}

async function main() {
  // Admin and evaluator are one interface now, so the Field Validation panel
  // lives on the admin dashboard.
  const staff = (await userModel.findAllPublicProfiles()).find((u) => u.role === 'admin')
    || (await userModel.findAllPublicProfiles()).find((u) => u.role === 'evaluator');
  if (!staff) {
    console.log('SKIP  no admin account to render the dashboard');
    await pool.end();
    return;
  }

  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const stamp = Date.now();
  const made = { users: [], applicants: [] };

  const mk = async (label, farmName) => {
    const r = await registerFarmer({
      firstName: label, lastName: 'Val', email: `val.${label}.${stamp}@my.cspc.edu.ph`,
      password: 'Str0ng!Pass1', phone: '09170000000', role: 'applicant',
      farmName, farmAddress: 'Nabua',
      region: 'Region V', province: 'Camarines Sur', municipality: 'Nabua',
    });
    const a = await applicantModel.findByApplicationId(r.applicationId);
    made.users.push(r.userId);
    made.applicants.push(a.id);
    return a;
  };

  try {
    // Still in the document stage — must NOT appear.
    const early = await mk('Early', `Early Docs Farm ${stamp}`);
    await applicantModel.patch(early.id, { accreditationStep: 3, status: 'document_review' });

    // Past document review, no validation recorded — awaiting a visit.
    const awaiting = await mk('Awaiting', `Awaiting Visit Farm ${stamp}`);
    await applicantModel.patch(awaiting.id, { accreditationStep: 4, status: 'document_review' });

    // Validation performed — validated, with its result.
    const validated = await mk('Validated', `Validated Farm ${stamp}`);
    await applicantModel.patch(validated.id, {
      accreditationStep: 5, status: 'under_review',
      step5ValidationDate: '2026-08-15', step5ValidationType: 'Field',
      step5ValidationResult: 'compliant', step5InspectedBy: 'Test Inspector',
    });

    const page = await get(server, '/dashboard', signToken(staff));
    check(`the admin dashboard renders -> ${page.status}`, page.status === 200);

    console.log('\n--- no fabricated rows survive ---');
    for (const ghost of ['Green Valley Organic Farm', 'Villanueva Natural Farm',
      'Morales Organic Herb Garden', 'Sunrise Rice Farm', '2026-03-20']) {
      check(`the invented "${ghost}" is gone`, !page.text.includes(ghost));
    }

    console.log('\n--- and the real applications appear correctly ---');
    const cells = validationCells(page.text);
    check('an application awaiting a visit is listed',
      page.text.includes(`Awaiting Visit Farm ${stamp}`));
    check('  marked as awaiting, with no date',
      cells.includes(`Awaiting Visit Farm ${stamp}`));
    check('a validated application is listed',
      page.text.includes(`Validated Farm ${stamp}`));
    check('  carrying its real validation date',
      cells.includes('2026-08-15'));
    check('  and its result',
      page.text.includes('Validated · compliant') || /Validated[^<]*compliant/.test(page.text));

    console.log('\n--- an application still in documents does not ---');
    check('the step-3 application is not on the validation panel',
      !cells.includes(`Early Docs Farm ${stamp}`));
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
    console.log('ALL VALIDATION SCHEDULE CHECKS PASSED');
  }
}

main().catch(async (err) => {
  console.error(err);
  try { await pool.end(); } catch (_) { /* already closed */ }
  process.exit(1);
});
