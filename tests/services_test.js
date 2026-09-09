/**
 * Who may enrol in a service.
 *
 * ATI staff deliver services; operators and applicants are the beneficiaries.
 * Every other path on the page already drew that line — STAFF gates creating
 * and editing a service, and participation outcomes are recorded through the
 * staff-only /participants/:pid route — but enrolment had no check on either
 * the route or the button, so an evaluator could sign up for a training they
 * are meant to be running. One had.
 *
 *   node tests/services_test.js
 */

require('dotenv').config();

const http = require('http');
const app = require('../app');
const { pool } = require('../config/database');
const serviceModel = require('../models/serviceModel');
const userModel = require('../models/userModel');
const { signToken } = require('../middleware/auth');

let failures = 0;
function check(label, condition) {
  console.log((condition ? 'PASS  ' : 'FAIL  ') + label);
  if (!condition) failures += 1;
}

const CSRF = 'a'.repeat(64);

function post(server, p, token) {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams({ _csrf: CSRF }).toString();
    const req = http.request({
      host: '127.0.0.1', port: server.address().port, path: p, method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
        Cookie: `agri_token=${token}; agri_csrf=${CSRF}`,
      },
    }, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => resolve({ status: res.statusCode, location: res.headers.location, text: d }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

function get(server, p, token) {
  return new Promise((resolve, reject) => {
    http.get({
      host: '127.0.0.1', port: server.address().port, path: p,
      headers: { Cookie: `agri_token=${token}` },
    }, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => resolve({ status: res.statusCode, text: d }));
    }).on('error', reject);
  });
}

async function main() {
  const users = await userModel.findAllPublicProfiles();
  const admin = users.find((u) => u.role === 'admin');
  const evaluator = users.find((u) => u.role === 'evaluator');
  const operator = users.find((u) => u.role === 'operator');

  const [[svc]] = await pool.query(
    "SELECT id, name, eligibility, target_beneficiaries FROM services WHERE status IN ('open','ongoing','planned') ORDER BY id LIMIT 1"
  );
  if (!svc) {
    console.log('SKIP  no open service to enrol in; seed one and re-run');
    await pool.end();
    return;
  }

  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const created = [];

  try {
    console.log(`--- staff deliver services, they do not enrol (service ${svc.id}) ---`);
    for (const staff of [admin, evaluator].filter(Boolean)) {
      const before = (await serviceModel.findParticipants(svc.id)).length;
      const res = await post(server, `/services/${svc.id}/apply`, signToken(staff));
      check(`an ${staff.role} is refused -> ${res.status}`, res.status === 403);
      const after = (await serviceModel.findParticipants(svc.id)).length;
      check(`and no participation row was written for the ${staff.role}`, after === before);

      const page = await get(server, `/services/${svc.id}`, signToken(staff));
      check(`the ${staff.role} is not offered an Enrol button`,
        page.status === 200 && !/\/apply"/.test(page.text));
      check(`and is told what to do instead`,
        /deliver this service rather than enrol/i.test(page.text));
    }

    console.log('\n--- a beneficiary still can ---');
    if (operator) {
      const before = await serviceModel.findParticipants(svc.id);
      const already = before.some((p) => p.userId === operator.id);
      const res = await post(server, `/services/${svc.id}/apply`, signToken(operator));
      check(`an operator may enrol -> ${res.status}`, res.status === 302);
      const after = await serviceModel.findParticipants(svc.id);
      const row = after.find((p) => p.userId === operator.id);
      check('and the participation row exists', !!row);
      if (row && !already) created.push(row.id);

      const page = await get(server, `/services/${svc.id}`, signToken(operator));
      check('the operator sees their own participation, not the staff notice',
        page.status === 200 && !/deliver this service rather than enrol/i.test(page.text));
    } else {
      console.log('SKIP  no operator account to test the allowed path with');
    }

    console.log('\n--- staff can see whether the person is suitable ---');
    // The reviewer is asked to approve or reject an enrolment against the
    // service's eligibility. Before this, the row being decided carried only a
    // name, an email and a role — nothing to decide on.
    if (operator) {
      const parts = await serviceModel.findParticipants(svc.id);
      const row = parts.find((x) => x.userId === operator.id);
      check('the participant carries a standing', !!(row && row.standing && row.standing.state));
      check('which names the state in words, not just a colour',
        !!(row && row.standing.label && row.standing.label.length > 3));
      check('and a count of services actually attended',
        !!row && typeof row.servicesAttended === 'number');

      const page = await get(server, `/services/${svc.id}`, signToken(evaluator || admin));
      check('the reviewer sees that standing on the page',
        page.status === 200 && page.text.includes('standing-pill'));
      // Criteria and decision on one screen, rather than one recalled from a
      // panel further up the page.
      check('with the eligibility criteria beside the decisions',
        (!svc.eligibility && !svc.target_beneficiaries)
          ? true
          : page.text.includes('Judge each enrolment against'));
    }

    console.log('\n--- the staff-only paths are unchanged ---');
    const mgmt = await get(server, '/services/new', signToken(evaluator || admin));
    check('staff can still reach the new-service form', mgmt.status === 200);
    if (operator) {
      const denied = await get(server, '/services/new', signToken(operator));
      check(`an operator still cannot add a service -> ${denied.status}`, denied.status === 403);
    }
  } finally {
    await new Promise((r) => server.close(r));
    for (const id of created) {
      await pool.execute('DELETE FROM service_participants WHERE id = ?', [id]);
    }
    await pool.end();
  }

  console.log('');
  if (failures) {
    console.log(failures + ' CHECK(S) FAILED');
    process.exitCode = 1;
  } else {
    console.log('ALL SERVICE CHECKS PASSED');
  }
}

main().catch(async (err) => {
  console.error(err);
  try { await pool.end(); } catch (_) { /* already closed */ }
  process.exit(1);
});
