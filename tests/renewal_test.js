/**
 * Renewal / re-accreditation — Objective 2.5.
 *
 * Every check maps to a named test case in the manuscript's Table 10:
 *   "Accreditation Validity Tracking"  → the validity section
 *   "Re-accreditation Submission"      → the submission section
 *   "Renewal Notification"             → the reminder section
 * plus RSC item 7's XML half of "via xml or Json".
 *
 *   node tests/renewal_test.js
 */

require('dotenv').config();

const http = require('http');
const bcrypt = require('bcrypt');
const app = require('../app');
const { pool, query } = require('../config/database');
const userModel = require('../models/userModel');
const farmModel = require('../models/farmModel');
const renewalModel = require('../models/renewalModel');
const notificationModel = require('../models/notificationModel');
const renewalReminders = require('../services/renewalReminders');
const { signToken } = require('../middleware/auth');
const {
  VALIDITY_YEARS, REMINDER_DAYS, validityStatus, validUntilFrom, reminderWindow,
} = require('../config/renewal');

let failures = 0;
function check(label, ok) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label);
  if (!ok) failures += 1;
}

const CSRF = 'b'.repeat(64);

function request(server, method, path, { token, form } = {}) {
  return new Promise((resolve, reject) => {
    const body = form ? new URLSearchParams({ ...form, _csrf: CSRF }).toString() : null;
    const headers = {};
    if (body) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      headers['Content-Length'] = Buffer.byteLength(body);
    }
    const cookies = [];
    if (token) cookies.push('agri_token=' + token);
    cookies.push('agri_csrf=' + CSRF);
    headers.Cookie = cookies.join('; ');
    headers['x-csrf-token'] = CSRF;

    const req = http.request(
      { host: '127.0.0.1', port: server.address().port, method, path, headers },
      (res) => {
        let d = '';
        res.on('data', (c) => { d += c; });
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: d }));
      }
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

/** A date `days` from today, as an ISO date string. */
const inDays = (days) => new Date(Date.now() + days * 86400000).toISOString().split('T')[0];

async function main() {
  const stamp = Date.now();
  const made = { users: [], farms: [] };

  // ── fixtures ──────────────────────────────────────────────────────────────
  const adminId = await userModel.createUser({
    firstName: 'Renewal', lastName: 'Admin', email: `renew.admin.${stamp}@example.com`,
    passwordHash: await bcrypt.hash('RenewPw#2026', 12), role: 'admin', region: 'Region V', avatar: 'RA',
  });
  made.users.push(adminId);

  const [farmRes] = await pool.execute(
    `INSERT INTO farms (name, operator, region, province, municipality, address, classification,
                        lsa_type, accreditation_level, accredited_since, expiry_date, farm_area, status)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [`Renewal Probe Farm ${stamp}`, 'Probe Operator', 'Region V', 'Camarines Sur', 'Nabua',
      'Probe address', 'organic', 'LSA I', 'Level 1', inDays(-1600), inDays(120), 5000, 'active']
  );
  const farmId = farmRes.insertId;
  made.farms.push(farmId);

  const operatorId = await userModel.createUser({
    firstName: 'Renewal', lastName: 'Operator', email: `renew.op.${stamp}@example.com`,
    passwordHash: await bcrypt.hash('RenewPw#2026', 12), role: 'operator', region: 'Region V',
    avatar: 'RO', farmId,
  });
  made.users.push(operatorId);

  const adminToken = signToken({ id: adminId, role: 'admin', email: `renew.admin.${stamp}@example.com` });
  const opToken = signToken({ id: operatorId, role: 'operator', email: `renew.op.${stamp}@example.com` });

  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));

  try {
    // ── Accreditation Validity Tracking ─────────────────────────────────────
    console.log('--- Table 10: Accreditation Validity Tracking ---');
    check(`the validity period has one definition (${VALIDITY_YEARS} years)`, VALIDITY_YEARS === 5);
    check('a certificate issued today runs the full period',
      validUntilFrom('2026-03-05') === '2031-03-05');
    check('Step 7 reads that definition rather than its own arithmetic',
      require('fs').readFileSync('routes/accreditation.js', 'utf8').includes('validUntilFrom(issueDate)'));

    check('a farm with no expiry date is "unknown", not "active"',
      validityStatus(null).state === 'unknown');
    check('an expired accreditation reads expired', validityStatus(inDays(-5)).state === 'expired');
    check('one inside the warning window reads expiring', validityStatus(inDays(120)).state === 'expiring');
    check('one far out reads active', validityStatus(inDays(900)).state === 'active');

    const page = await request(server, 'GET', '/renewal', { token: opToken });
    check('/renewal renders for the operator -> 200', page.status === 200);
    check('and shows their site with its expiry date', page.text.includes(inDays(120)));

    const applicantId = await userModel.createUser({
      firstName: 'Renewal', lastName: 'Applicant', email: `renew.app.${stamp}@example.com`,
      passwordHash: await bcrypt.hash('RenewPw#2026', 12), role: 'applicant', region: 'Region V', avatar: 'RP',
    });
    made.users.push(applicantId);
    const applicantToken = signToken({ id: applicantId, role: 'applicant', email: `renew.app.${stamp}@example.com` });
    const refused = await request(server, 'GET', '/renewal', { token: applicantToken });
    check('an applicant with no accreditation is refused -> 403', refused.status === 403);

    // ── Re-accreditation Submission ─────────────────────────────────────────
    console.log('\n--- Table 10: Re-accreditation Submission ---');
    const applied = await request(server, 'POST', `/renewal/${farmId}/apply`, {
      token: opToken, form: { remarks: 'New vermicomposting shed since the last visit.' },
    });
    check('the operator can submit a renewal', applied.headers.location === '/renewal?success=applied');

    const open = await renewalModel.findOpenForFarm(farmId);
    check('it is recorded as submitted', Boolean(open) && open.status === 'submitted');
    check('and it remembers the expiry it was renewing', open.previousExpiry === inDays(120));

    const twice = await request(server, 'POST', `/renewal/${farmId}/apply`, {
      token: opToken, form: { remarks: 'again' },
    });
    check('a second application while one is open is refused',
      twice.headers.location === '/renewal?error=already');

    // Another operator must not be able to renew a farm that is not theirs.
    const otherOpId = await userModel.createUser({
      firstName: 'Other', lastName: 'Operator', email: `renew.other.${stamp}@example.com`,
      passwordHash: await bcrypt.hash('RenewPw#2026', 12), role: 'operator', region: 'Region V', avatar: 'OO',
    });
    made.users.push(otherOpId);
    const foreign = await request(server, 'POST', `/renewal/${farmId}/apply`, {
      token: signToken({ id: otherOpId, role: 'operator', email: `renew.other.${stamp}@example.com` }),
      form: { remarks: 'not mine' },
    });
    check('an operator cannot renew someone else\'s site -> 403', foreign.status === 403);

    const reviewed = await request(server, 'POST', `/renewal/${open.id}/review`, { token: adminToken });
    check('an admin can take it under review', reviewed.headers.location === '/renewal?success=review');
    check('the status moved', (await renewalModel.findById(open.id)).status === 'under_review');

    const noRemarks = await request(server, 'POST', `/renewal/${open.id}/decide`, {
      token: adminToken, form: { decision: 'reject', remarks: '' },
    });
    check('a rejection without remarks is refused', noRemarks.headers.location === '/renewal?error=remarks');

    const before = await farmModel.findById(farmId);
    const approved = await request(server, 'POST', `/renewal/${open.id}/decide`, {
      token: adminToken, form: { decision: 'approve', certificateNo: `LSA-RN-${stamp}` },
    });
    check('an administrator can approve', approved.headers.location === '/renewal?success=approved');

    const after = await farmModel.findById(farmId);
    const decided = await renewalModel.findById(open.id);
    check('the farm\'s expiry moved forward: ' + before.expiryDate + ' -> ' + after.expiryDate,
      after.expiryDate === validUntilFrom(new Date()));
    check('the application records the same date it wrote to the farm',
      decided.newValidUntil === after.expiryDate);
    check('and the certificate number is kept', decided.newCertificateNo === `LSA-RN-${stamp}`);
    check('the farm now reads active again', validityStatus(after.expiryDate).state === 'active');

    const redecide = await request(server, 'POST', `/renewal/${open.id}/decide`, {
      token: adminToken, form: { decision: 'reject', remarks: 'changed my mind' },
    });
    check('a decided application cannot be decided twice',
      redecide.headers.location === '/renewal?error=decided');

    // ── Renewal Notification ────────────────────────────────────────────────
    console.log('\n--- Table 10: Renewal Notification ---');
    check(`reminder windows are ${REMINDER_DAYS.join('/')} days`, REMINDER_DAYS.length === 4);
    check('a farm 100 days out is in the 180-day window, not yet the 90',
      reminderWindow(inDays(100)) === 180);
    check('at 85 days it has fallen into the 90-day window', reminderWindow(inDays(85)) === 90);
    check('one 200 days out is not due yet', reminderWindow(inDays(200)) === null);
    check('an already-expired farm is not reminded', reminderWindow(inDays(-1)) === null);

    // Put the farm back inside a window, with no application in flight.
    await pool.execute('UPDATE farms SET expiry_date = ? WHERE id = ?', [inDays(25), farmId]);
    await query('UPDATE renewal_applications SET status = ? WHERE farm_id = ?', ['approved', farmId]);

    const unreadBefore = await notificationModel.countUnread(operatorId);
    const first = await renewalReminders.run();
    const unreadAfter = await notificationModel.countUnread(operatorId);
    check(`the job found the expiring farm (checked ${first.checked}, sent ${first.sent})`, first.sent >= 1);
    check('and the operator was actually notified', unreadAfter > unreadBefore);

    const reminders = await renewalModel.remindersFor(farmId);
    check('the reminder is logged against the expiry it warned about',
      reminders.some((r) => r.daysBefore === 30));

    // The whole point of the ledger: running again must not send again.
    const second = await renewalReminders.run();
    const unreadThird = await notificationModel.countUnread(operatorId);
    check('running the job again sends nothing', second.sent === 0);
    check('and the operator is not notified twice', unreadThird === unreadAfter);

    // An operator who has applied should stop being chased.
    await pool.execute('UPDATE farms SET expiry_date = ? WHERE id = ?', [inDays(8), farmId]);
    await renewalModel.create({
      farmId, applicantId: null, submittedBy: operatorId,
      previousExpiry: inDays(8), operatorRemarks: 'applying',
    });
    const third = await renewalReminders.run();
    check('a farm with a renewal in flight is not reminded',
      !(third.checked > 0 && third.sent > 0));

    // ── RSC item 7: XML ─────────────────────────────────────────────────────
    console.log('\n--- RSC 7: registry export "via xml or Json" ---');
    const json = await request(server, 'GET', '/api/export/lsa-registry', { token: adminToken });
    check('JSON export still works -> 200', json.status === 200);

    const xml = await request(server, 'GET', '/api/export/lsa-registry?format=xml', { token: adminToken });
    check('XML export -> 200', xml.status === 200);
    check('it is served as XML', String(xml.headers['content-type']).includes('xml'));
    check('it declares an encoding', xml.text.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
    check('it carries the same schema version as the JSON',
      xml.text.includes('agri-aims.lsa-registry.v1'));
    check('and one element per Learning Site',
      (xml.text.match(/<learning-site>/g) || []).length === json.text.match(/"lsa_id"/g).length);

    // A farm called "Santos & Sons" must not produce a document no parser reads.
    await pool.execute('UPDATE farms SET name = ? WHERE id = ?', ['Santos & Sons <Farm>', farmId]);
    const escaped = await request(server, 'GET', '/api/export/lsa-registry?format=xml', { token: adminToken });
    check('special characters are escaped, not emitted raw',
      escaped.text.includes('Santos &amp; Sons &lt;Farm&gt;') && !escaped.text.includes('Sons <Farm>'));

    const csv = await request(server, 'GET', '/api/export/lsa-registry?format=csv', { token: adminToken });
    check('CSV export is unaffected -> 200', csv.status === 200);

    const asOperator = await request(server, 'GET', '/api/export/lsa-registry?format=xml', { token: opToken });
    check('the registry export is still staff only -> 403', asOperator.status === 403);
  } finally {
    // Self-cleaning, so the suite can be run twice in a row.
    const holes = (n) => Array(n).fill('?').join(',');
    if (made.farms.length) {
      await query(`DELETE FROM renewal_reminders WHERE farm_id IN (${holes(made.farms.length)})`, made.farms);
      await query(`DELETE FROM renewal_applications WHERE farm_id IN (${holes(made.farms.length)})`, made.farms);
    }
    if (made.users.length) {
      await query(`DELETE FROM notifications WHERE user_id IN (${holes(made.users.length)})`, made.users);
    }
    // renewalDue() and renewalSubmitted() also notify ATI staff — real seeded
    // accounts, not users this test created — so deleting by user_id left them
    // behind. Sixty-eight of them accumulated in the administrator's bell
    // before this was noticed. Clear anything naming a farm this run created.
    await query(
      "DELETE FROM notifications WHERE title LIKE 'Renewal Probe Farm%' "
      + "OR title LIKE '%Renewal Probe Farm%' OR body LIKE '%Renewal Probe Farm%'"
    );
    for (const id of made.users) await userModel.remove(id);
    for (const id of made.farms) await query('DELETE FROM farms WHERE id = ?', [id]);
    await new Promise((r) => server.close(r));
    await pool.end();
  }

  console.log('');
  if (failures) {
    console.log(failures + ' CHECK(S) FAILED');
    process.exitCode = 1;
  } else {
    console.log('ALL RENEWAL CHECKS PASSED');
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
