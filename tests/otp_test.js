/**
 * OTP verification for registration and password reset.
 *
 * The mailer is stubbed so the test can read the code that would have been
 * emailed (the code is never returned to the client or logged), then drive the
 * real HTTP flow: hashing, expiry, attempt caps, resend invalidation, purpose
 * separation, and reset-token gating are all exercised end to end.
 *
 *   node tests/otp_test.js
 * Requires migration 042_otp.sql applied.
 */

require('dotenv').config();
// Relax the per-IP auth rate limiters for this suite (it drives many calls from
// one address); the per-email cooldown and per-code attempt cap still apply.
process.env.NODE_ENV = 'test';

const http = require('http');
// Stub the mailer BEFORE the app wires it up, capturing the code per purpose.
const mailer = require('../config/mailer');
const sent = { registration: null, password_reset: null };
mailer.sendOtp = async (to, { purpose, code }) => { sent[purpose] = { to, code }; return true; };

const app = require('../app');
const { pool } = require('../config/database');

let failures = 0;
function check(label, cond) { console.log((cond ? 'PASS  ' : 'FAIL  ') + label); if (!cond) failures += 1; }

function req(server, method, path, body) {
  return new Promise((resolve) => {
    const payload = body ? JSON.stringify(body) : null;
    const headers = { 'Content-Type': 'application/json' };
    if (payload) headers['Content-Length'] = Buffer.byteLength(payload);
    const r = http.request({ host: '127.0.0.1', port: server.address().port, path, method, headers }, (res) => {
      let d = ''; res.on('data', (c) => { d += c; });
      res.on('end', () => { let j = null; try { j = JSON.parse(d); } catch (_) {} resolve({ status: res.statusCode, json: j, setCookie: res.headers['set-cookie'] || [] }); });
    });
    r.on('error', () => resolve({ status: 0, json: null }));
    if (payload) r.write(payload); r.end();
  });
}

async function main() {
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const stamp = Date.now();
  const emails = [];
  const regBody = (email) => ({
    firstName: 'Otp', lastName: 'Tester', email, phone: '09170000000', password: 'Str0ng!Pass1',
    role: 'applicant', farmName: 'OTP Farm', farmAddress: 'Naga',
    region: 'Region V', province: 'Camarines Sur', municipality: 'Naga City',
  });

  try {
    // ── Registration ──────────────────────────────────────────────────────
    console.log('--- Registration ---');
    const A = `otp.a.${stamp}@example.com`; emails.push(A);
    sent.registration = null;
    let r = await req(server, 'POST', '/api/auth/register', regBody(A));
    check(`valid registration -> 201 needsOtp (${r.status})`, r.status === 201 && r.json.data && r.json.data.needsOtp);
    check('an OTP was "emailed"', sent.registration && sent.registration.to === A && /^\d{6}$/.test(sent.registration.code));
    const codeA = sent.registration.code;

    const wrong = await req(server, 'POST', '/api/auth/verify-otp', { email: A, code: codeA === '000000' ? '111111' : '000000' });
    check(`incorrect OTP -> 400 rejected (${wrong.status})`, wrong.status === 400 && wrong.json.code === 'OTP_INCORRECT');
    check('error does not reveal the code', !String(wrong.json.error).includes(codeA));

    const good = await req(server, 'POST', '/api/auth/verify-otp', { email: A, code: codeA });
    check(`correct OTP -> 200 verified (${good.status})`, good.status === 200 && good.json.data.verified);
    check('and a session cookie is issued (logged in)', (good.setCookie || []).some((c) => c.startsWith('agri_token=')));
    const [[au]] = await pool.query('SELECT email_verified FROM users WHERE email = ?', [A]);
    check('the account is now email_verified', au && Number(au.email_verified) === 1);

    const dup = await req(server, 'POST', '/api/auth/register', regBody(A));
    check(`already-registered (verified) email -> 409 (${dup.status})`, dup.status === 409);

    // Resend invalidates the previous code
    console.log('\n--- Resend invalidates the old code ---');
    const C = `otp.c.${stamp}@example.com`; emails.push(C);
    sent.registration = null;
    await req(server, 'POST', '/api/auth/register', regBody(C));
    const cOld = sent.registration.code;
    await pool.query('UPDATE otp_codes SET created_at = (NOW() - INTERVAL 2 MINUTE) WHERE email = ?', [C]); // clear the 60s cooldown
    sent.registration = null;
    const resend = await req(server, 'POST', '/api/auth/resend-otp', { email: C, purpose: 'registration' });
    check(`resend -> 200 generic (${resend.status})`, resend.status === 200);
    const cNew = sent.registration && sent.registration.code;
    check('a new code was issued', cNew && cNew !== cOld);
    const oldTry = await req(server, 'POST', '/api/auth/verify-otp', { email: C, code: cOld });
    check('the OLD code no longer works', oldTry.status === 400);
    const newTry = await req(server, 'POST', '/api/auth/verify-otp', { email: C, code: cNew });
    check('the NEW code works', newTry.status === 200 && newTry.json.data.verified);

    // Expired code
    console.log('\n--- Expiry ---');
    const D = `otp.d.${stamp}@example.com`; emails.push(D);
    sent.registration = null;
    await req(server, 'POST', '/api/auth/register', regBody(D));
    const codeD = sent.registration.code;
    await pool.query('UPDATE otp_codes SET expires_at = (NOW() - INTERVAL 1 MINUTE) WHERE email = ? AND purpose = ?', [D, 'registration']);
    const exp = await req(server, 'POST', '/api/auth/verify-otp', { email: D, code: codeD });
    check(`expired OTP -> 400 rejected (${exp.status})`, exp.status === 400 && exp.json.code === 'OTP_EXPIRED');

    // Attempt cap
    console.log('\n--- Attempt limit ---');
    const B = `otp.b.${stamp}@example.com`; emails.push(B);
    sent.registration = null;
    await req(server, 'POST', '/api/auth/register', regBody(B));
    const codeB = sent.registration.code;
    const badB = codeB === '000000' ? '111111' : '000000';
    let lastReason = '';
    for (let i = 0; i < 5; i++) { const x = await req(server, 'POST', '/api/auth/verify-otp', { email: B, code: badB }); lastReason = x.json && x.json.code; }
    check(`5 wrong attempts -> too many (${lastReason})`, lastReason === 'OTP_TOO_MANY');
    const afterCap = await req(server, 'POST', '/api/auth/verify-otp', { email: B, code: codeB });
    check('the correct code is refused once the cap is hit', afterCap.status === 400 && afterCap.json.code === 'OTP_TOO_MANY');

    // Purpose separation: a registration code cannot satisfy a password reset
    console.log('\n--- Purpose separation ---');
    sent.password_reset = null;
    const crossReg = `otp.x.${stamp}@example.com`; emails.push(crossReg);
    await req(server, 'POST', '/api/auth/register', regBody(crossReg));
    const regCode = sent.registration.code;
    const cross = await req(server, 'POST', '/api/auth/verify-reset-otp', { email: crossReg, code: regCode });
    check('a registration code cannot verify a password reset', cross.status === 400);

    // Email sending failure handled gracefully
    console.log('\n--- Email failure ---');
    mailer.sendOtp = async () => false;
    const F = `otp.f.${stamp}@example.com`; emails.push(F);
    const fail = await req(server, 'POST', '/api/auth/register', regBody(F));
    check(`mail failure -> handled gracefully (201, needsOtp, emailSent=false) (${fail.status})`,
      fail.status === 201 && fail.json.data && fail.json.data.needsOtp && fail.json.data.emailSent === false);
    mailer.sendOtp = async (to, { purpose, code }) => { sent[purpose] = { to, code }; return true; };

    // ── Forgot password (uses verified account A) ───────────────────────────
    console.log('\n--- Forgot password ---');
    sent.password_reset = null;
    const fp = await req(server, 'POST', '/api/auth/forgot-password', { email: A });
    check(`valid email -> generic response (${fp.status})`, fp.status === 200 && /if an account/i.test(fp.json.data.message));
    check('a reset code was "emailed"', sent.password_reset && sent.password_reset.to === A);
    const resetCode = sent.password_reset.code;

    sent.password_reset = null;
    const fpNone = await req(server, 'POST', '/api/auth/forgot-password', { email: `nobody.${stamp}@example.com` });
    check('unknown email -> same generic response, no code sent', fpNone.status === 200 && !sent.password_reset);

    const rWrong = await req(server, 'POST', '/api/auth/verify-reset-otp', { email: A, code: resetCode === '000000' ? '111111' : '000000' });
    check(`incorrect reset OTP -> 400 (${rWrong.status})`, rWrong.status === 400);

    const rOk = await req(server, 'POST', '/api/auth/verify-reset-otp', { email: A, code: resetCode });
    check(`correct reset OTP -> 200 with reset token (${rOk.status})`, rOk.status === 200 && rOk.json.data.resetToken);
    const resetToken = rOk.json.data.resetToken;

    const reuse = await req(server, 'POST', '/api/auth/verify-reset-otp', { email: A, code: resetCode });
    check('the reset OTP cannot be reused', reuse.status === 400);

    const noToken = await req(server, 'POST', '/api/auth/reset-password', { password: 'NewStr0ng!1', confirmPassword: 'NewStr0ng!1' });
    check(`reset without a token -> refused (${noToken.status})`, noToken.status === 400);

    const setNew = await req(server, 'POST', '/api/auth/reset-password', { resetToken, password: 'NewStr0ng!1', confirmPassword: 'NewStr0ng!1' });
    check(`reset with token -> 200 (${setNew.status})`, setNew.status === 200);

    const oldLogin = await req(server, 'POST', '/api/auth/login', { email: A, password: 'Str0ng!Pass1' });
    check('the OLD password no longer works', oldLogin.status === 401);
    const newLogin = await req(server, 'POST', '/api/auth/login', { email: A, password: 'NewStr0ng!1' });
    check('the NEW password works', newLogin.status === 200);
  } finally {
    await new Promise((r) => server.close(r));
    for (const e of emails) {
      await pool.query('DELETE FROM otp_codes WHERE email = ?', [e]).catch(() => {});
      const [rows] = await pool.query('SELECT id, application_id FROM users WHERE email = ?', [e]).catch(() => [[]]);
      const u = rows && rows[0];
      if (u) {
        if (u.application_id) await pool.query('DELETE FROM applicants WHERE application_id = ?', [u.application_id]).catch(() => {});
        await pool.query('DELETE FROM users WHERE id = ?', [u.id]).catch(() => {});
      }
      await pool.query('DELETE FROM applicants WHERE email = ?', [e]).catch(() => {});
    }
    await pool.end();
  }

  console.log('');
  if (failures) { console.log(failures + ' CHECK(S) FAILED'); process.exitCode = 1; }
  else console.log('ALL OTP CHECKS PASSED');
}

main().catch(async (err) => { console.error(err); try { await pool.end(); } catch (_) {} process.exit(1); });
