/**
 * Submitting and deciding the semestral accomplishment report.
 *
 * Four defects, all reachable from the Monitoring & Reports page:
 *
 *  1. The period dropdown was built from `new Date().getFullYear()` — this
 *     year's two semesters, whoever you are. A site accredited 2026-09-04 owes
 *     Semester 1 2027 onwards, so the form offered it two periods it did not
 *     owe and none that it did: nothing it could file matched the calendar
 *     asking it to file.
 *  2. The same period could be filed repeatedly. The calendar shows the first
 *     and ignores the rest, but the farm's visitor and training counters are
 *     re-derived by summing every row, so duplicates inflated them.
 *  3. Nothing could ever approve a report. They were created 'pending' and
 *     stayed there, while models/lsa2Model counted approved reports as an
 *     up-scaling criterion — one no farm could meet.
 *  4. `currentUser.farmId || 1` meant an operator with no Learning Site read
 *     farm 1's reports and filed new ones against farm 1.
 *
 *   node tests/reports_test.js
 */

require('dotenv').config();

const http = require('http');
const app = require('../app');
const { pool } = require('../config/database');
const farmModel = require('../models/farmModel');
const reportModel = require('../models/reportModel');
const userModel = require('../models/userModel');
const reportSchedule = require('../services/reportSchedule');
const { signToken } = require('../middleware/auth');

let failures = 0;
function check(label, condition) {
  console.log((condition ? 'PASS  ' : 'FAIL  ') + label);
  if (!condition) failures += 1;
}

const CSRF = 'c'.repeat(64);

function post(server, path, token, body) {
  return new Promise((resolve, reject) => {
    const payload = new URLSearchParams(body).toString();
    const req = http.request({
      host: '127.0.0.1', port: server.address().port, path, method: 'POST',
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
  const staff = await userModel.findAllPublicProfiles();
  const reviewer = staff.find((u) => u.role === 'evaluator') || staff.find((u) => u.role === 'admin');
  if (!reviewer) {
    console.log('SKIP  no ATI staff account to decide with');
    await pool.end();
    return;
  }

  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));

  const stamp = Date.now();
  const thisYear = new Date().getFullYear();
  const owed = `Semester 1 ${thisYear + 1}`;   // first period after a September accreditation
  const notOwed = `Semester 1 ${thisYear}`;    // fell due before it was accredited
  let farmId = null;
  let operatorId = null;
  let straysId = null;

  try {
    farmId = await farmModel.createFromApplicant(
      {
        id: null,
        farmName: `Report Test Farm ${stamp}`,
        firstName: 'Rep', lastName: 'Tester',
        region: 'Region V', province: 'Camarines Sur', municipality: 'Nabua',
        farmAddress: 'Nabua', classification: 'integrated', lsaType: 'regular',
        farmArea: 20000,
      },
      { accreditedSince: `${thisYear}-09-04`, expiryDate: `${thisYear + 5}-09-04` }
    );
    operatorId = await userModel.createUser({
      firstName: 'Rep', lastName: 'Tester',
      email: `rep.${stamp}@example.com`,
      passwordHash: 'not-a-login', role: 'operator', farmId,
    });
    const opToken = signToken(await userModel.findById(operatorId));
    const staffToken = signToken(reviewer);

    console.log('--- the form offers the periods this farm owes ---');
    const page = await get(server, '/reports', opToken);
    check(`the page renders -> ${page.status}`, page.status === 200);
    check(`it offers ${owed}`, page.text.includes(`value="${owed}"`));
    check(`it does not offer ${notOwed}, which fell due before accreditation`,
      !page.text.includes(`value="${notOwed}"`));

    console.log('\n--- a period the farm does not owe is refused ---');
    const wrong = await post(server, '/reports', opToken, {
      _csrf: CSRF, period: notOwed, visitors: '10', trainingSessions: '1', techDemos: '0',
    });
    check('the submission is turned away', /error=period/.test(wrong.location || ''));
    check('and nothing was filed',
      (await reportModel.findByFarmId(farmId)).length === 0);

    console.log('\n--- the period it does owe is accepted ---');
    const ok = await post(server, '/reports', opToken, {
      _csrf: CSRF, period: owed, visitors: '40', trainingSessions: '3', techDemos: '2',
    });
    check(`it is accepted -> ${ok.status}`, /submitted=1/.test(ok.location || ''));
    const filed = await reportModel.findByFarmId(farmId);
    check('one report exists', filed.length === 1);
    check(`it is pending a decision (${filed[0] && filed[0].status})`,
      filed[0] && filed[0].status === 'pending');
    const farmAfter = await farmModel.findById(farmId);
    check(`the farm counters followed (${farmAfter.visitorsThisYear} visitors)`,
      Number(farmAfter.visitorsThisYear) === 40);

    console.log('\n--- and cannot be filed twice ---');
    const again = await post(server, '/reports', opToken, {
      _csrf: CSRF, period: owed, visitors: '999', trainingSessions: '9', techDemos: '9',
    });
    check('the second attempt is refused', /error=duplicate/.test(again.location || ''));
    check('still one report', (await reportModel.findByFarmId(farmId)).length === 1);
    const farmStill = await farmModel.findById(farmId);
    check(`and the counters did not inflate (${farmStill.visitorsThisYear})`,
      Number(farmStill.visitorsThisYear) === 40);
    check('the period is no longer offered',
      !(await get(server, '/reports', opToken)).text.includes(`value="${owed}"`));

    console.log('\n--- ATI can decide it ---');
    const reportId = filed[0].id;
    const noReason = await post(server, `/reports/${reportId}/review`, staffToken, {
      _csrf: CSRF, status: 'returned', remarks: '   ',
    });
    check('a return with no reason is refused', /error=review/.test(noReason.location || ''));
    check('and the report is untouched',
      (await reportModel.findById(reportId)).status === 'pending');

    const returned = await post(server, `/reports/${reportId}/review`, staffToken, {
      _csrf: CSRF, status: 'returned', remarks: 'Visitor log for December is missing.',
    });
    check('a return with a reason is recorded', /reviewed=returned/.test(returned.location || ''));
    const back = await reportModel.findById(reportId);
    check(`the status is returned (${back.status})`, back.status === 'returned');
    check('the reason is stored', back.remarks === 'Visitor log for December is missing.');
    check('and so is the reviewer', !!back.reviewedBy && !!back.reviewedAt);

    const approved = await post(server, `/reports/${reportId}/review`, staffToken, {
      _csrf: CSRF, status: 'approved', remarks: '',
    });
    check('it can then be accepted', /reviewed=approved/.test(approved.location || ''));
    check('which is what LSA II up-scaling counts',
      (await reportModel.findById(reportId)).status === 'approved');

    console.log('\n--- an operator cannot decide, and cannot decide for others ---');
    const opDecides = await post(server, `/reports/${reportId}/review`, opToken, {
      _csrf: CSRF, status: 'approved', remarks: '',
    });
    check(`the operator is refused -> ${opDecides.status}`, opDecides.status === 403);

    console.log('\n--- an operator with no Learning Site is told so, not shown farm 1 ---');
    straysId = await userModel.createUser({
      firstName: 'Stray', lastName: 'Operator',
      email: `stray.${stamp}@example.com`,
      passwordHash: 'not-a-login', role: 'operator',
    });
    const strayToken = signToken(await userModel.findById(straysId));
    const strayPage = await get(server, '/reports', strayToken);
    check(`reading is refused -> ${strayPage.status}`, strayPage.status === 403);
    check('with an explanation', /No LSA farm is linked to your account/.test(strayPage.text));

    const before = (await reportModel.findByFarmId(1)).length;
    const strayPost = await post(server, '/reports', strayToken, {
      _csrf: CSRF, period: owed, visitors: '5', trainingSessions: '1', techDemos: '0',
    });
    check(`filing is refused -> ${strayPost.status}`, strayPost.status === 403);
    check('and nothing was written against farm 1',
      (await reportModel.findByFarmId(1)).length === before);

    console.log('\n--- the calendar and the form agree by construction ---');
    const cal = reportSchedule.calendarFor(await farmModel.findById(farmId),
      await reportModel.findByFarmId(farmId));
    check('the filed period shows in the calendar as filed',
      cal.some((r) => r.period === owed && r.reportId));
    check('a period before accreditation is not in the calendar at all',
      !cal.some((r) => r.period === notOwed));
  } finally {
    await new Promise((r) => server.close(r));
    if (farmId) await pool.execute('DELETE FROM reports WHERE farm_id = ?', [farmId]).catch(() => {});
    for (const id of [operatorId, straysId].filter(Boolean)) {
      await pool.execute('DELETE FROM notifications WHERE user_id = ?', [id]).catch(() => {});
      await pool.execute('DELETE FROM users WHERE id = ?', [id]).catch(() => {});
    }
    await pool.execute('DELETE FROM notifications WHERE type IN (?,?) AND title LIKE ?',
      ['report_submitted', 'report_decided', `%Report Test Farm ${stamp}%`]).catch(() => {});
    await pool.execute('DELETE FROM notifications WHERE type IN (?,?) AND body LIKE ?',
      ['report_submitted', 'report_decided', `%Report Test Farm ${stamp}%`]).catch(() => {});
    if (farmId) await pool.execute('DELETE FROM farms WHERE id = ?', [farmId]).catch(() => {});
    await pool.end();
  }

  console.log('');
  if (failures) {
    console.log(failures + ' CHECK(S) FAILED');
    process.exitCode = 1;
  } else {
    console.log('ALL REPORT CHECKS PASSED');
  }
}

main().catch(async (err) => {
  console.error(err);
  try { await pool.end(); } catch (_) { /* already closed */ }
  process.exit(1);
});
