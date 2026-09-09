/**
 * The operator dashboard must show the farm's own figures.
 *
 * Two panels were showing numbers the system does not hold:
 *
 *  - "Monthly Visitor & Training Activity" charted twelve hard-coded monthly
 *    values, so a farm with nothing reported still drew a full year of activity
 *    — beside a "Total: 0" badge fed by a counter column nothing maintains.
 *    There is no monthly source anywhere in this system; visitors and training
 *    sessions exist only in the semestral reports operators submit.
 *
 *  - The Semestral Report Calendar ran from the January of the accreditation
 *    YEAR, so a site certified in September opened its dashboard to two reports
 *    already OVERDUE, both due months before it was accredited.
 *
 *  - The compliance panel folded 'pending' — the catalogue's word for "not yet
 *    checked" — into 'non-compliant', so the same new site was accused of
 *    failing every requirement on the day it was accredited, and scored 0%.
 *
 *   node tests/dashboard_test.js
 */

require('dotenv').config();

const http = require('http');
const app = require('../app');
const { pool } = require('../config/database');
const farmModel = require('../models/farmModel');
const reportModel = require('../models/reportModel');
const complianceModel = require('../models/complianceModel');
const userModel = require('../models/userModel');
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

async function main() {
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));

  const stamp = Date.now();
  const thisYear = new Date().getFullYear();
  let farmId = null;
  let userId = null;
  let reportId = null;
  let checkId = null;

  try {
    // Accredited in September, so the reports due that January and July fell
    // due before this site existed as an LSA.
    farmId = await farmModel.createFromApplicant(
      {
        id: null,
        farmName: `Dashboard Test Farm ${stamp}`,
        firstName: 'Dash', lastName: 'Tester',
        region: 'Region V', province: 'Camarines Sur', municipality: 'Nabua',
        farmAddress: 'Nabua', classification: 'integrated', lsaType: 'regular',
        farmArea: 20000,
      },
      { accreditedSince: `${thisYear}-09-04`, expiryDate: `${thisYear + 5}-09-04` }
    );
    userId = await userModel.createUser({
      firstName: 'Dash', lastName: 'Tester',
      email: `dash.${stamp}@example.com`,
      passwordHash: 'not-a-login', role: 'operator', farmId,
    });
    const token = signToken(await userModel.findById(userId));

    console.log('--- before anything has been reported ---');
    const empty = await get(server, '/dashboard', token);
    check(`the dashboard renders -> ${empty.status}`, empty.status === 200);
    check('no activity is charted, because none has been reported',
      !empty.text.includes('id="visitorChart"'));
    check('and it says so instead of drawing an empty chart',
      empty.text.includes('No semestral report has been submitted yet'));
    // The twelve invented months.
    check('the fabricated monthly series is gone',
      !/"Apr","May","Jun"/.test(empty.text));

    console.log('\n--- and no report is owed from before accreditation ---');
    check(`nothing is due for January ${thisYear}`,
      !empty.text.includes(`${thisYear}-01-31`));
    check(`nor for July ${thisYear}`, !empty.text.includes(`${thisYear}-07-31`));
    check('the calendar starts at the first period after the certificate',
      empty.text.includes(`${thisYear + 1}-01-31`));
    check('so nothing is Overdue on the day of accreditation',
      !/>\s*Overdue\s*</.test(empty.text));
    check('the last period falls inside the five-year term',
      empty.text.includes(`${thisYear + 5}-01-31`) && !empty.text.includes(`${thisYear + 6}-01-31`));

    console.log('\n--- nor is it accused of failing checks nobody has made ---');
    check('the score is not reported as a failing 0%',
      empty.text.includes('Not yet assessed') && !/>\s*0%\s*</.test(empty.text));
    check('the requirements say they are awaiting a first visit',
      empty.text.includes('Not yet checked'));
    check('and none of them is marked non-compliant',
      !empty.text.includes('Not compliant'));

    console.log('\n--- a recorded check does show as one ---');
    const requirements = await complianceModel.findRequirements({ appliesTo: 'farming' });
    checkId = await complianceModel.recordCheck({
      requirementId: requirements[0].id,
      farmId,
      status: 'non_compliant',
      checkedAt: `${thisYear}-12-01`,
      remarks: 'Recorded by the dashboard test.',
      correctiveAction: 'Rebuild the training shed.',
    });
    const checked = await get(server, '/dashboard', token);
    check('the finding appears as a finding', checked.text.includes('Not compliant'));
    check('the score is now a real percentage', !checked.text.includes('Not yet assessed'));
    check('and the rest are still only unchecked, not failing',
      checked.text.includes('Not yet checked'));

    console.log('\n--- once a report is submitted, the chart is that report ---');
    reportId = await reportModel.create({
      farmId,
      farmName: `Dashboard Test Farm ${stamp}`,
      operator: 'Dash Tester',
      period: `Semester 1 ${thisYear + 1}`,
      submissionDate: `${thisYear}-12-01`,
      visitors: 123,
      trainingSessions: 4,
      techDemos: 2,
    });

    const filled = await get(server, '/dashboard', token);
    check(`the dashboard still renders -> ${filled.status}`, filled.status === 200);
    check('the chart appears', filled.text.includes('id="visitorChart"'));
    check('labelled with the reporting period, not a month',
      filled.text.includes(`"S1 ${thisYear + 1}"`));
    check('carrying the reported visitors', /\[123\]/.test(filled.text));
    check('and the reported sessions', /\[4\]/.test(filled.text));
    check('the badge totals what was reported',
      filled.text.includes('123 visitors reported'));

    console.log('\n--- and the farm counters follow the reports ---');
    const farm = await farmModel.findById(farmId);
    check(`visitors this year (${farm.visitorsThisYear})`, Number(farm.visitorsThisYear) === 123);
    check(`training sessions (${farm.trainingSessions})`, Number(farm.trainingSessions) === 4);
  } finally {
    await new Promise((r) => server.close(r));
    if (reportId) await pool.execute('DELETE FROM reports WHERE id = ?', [reportId]).catch(() => {});
    if (checkId) await pool.execute('DELETE FROM compliance_checks WHERE id = ?', [checkId]).catch(() => {});
    if (userId) await pool.execute('DELETE FROM users WHERE id = ?', [userId]).catch(() => {});
    if (farmId) await pool.execute('DELETE FROM farms WHERE id = ?', [farmId]).catch(() => {});
    await pool.end();
  }

  console.log('');
  if (failures) {
    console.log(failures + ' CHECK(S) FAILED');
    process.exitCode = 1;
  } else {
    console.log('ALL DASHBOARD CHECKS PASSED');
  }
}

main().catch(async (err) => {
  console.error(err);
  try { await pool.end(); } catch (_) { /* already closed */ }
  process.exit(1);
});
