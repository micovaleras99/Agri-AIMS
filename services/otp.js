/**
 * One-time password logic: cryptographically random 6-digit codes, bcrypt-hashed
 * at rest, 5-minute expiry, a 60-second resend cooldown, and a hard cap on wrong
 * attempts. The plaintext code is returned only to the server-side caller (which
 * emails it) — it is never stored, logged, or sent to the browser.
 */

const crypto = require('crypto');
const bcrypt = require('bcrypt');
const otpModel = require('../models/otpModel');

const OTP_TTL_MS = 5 * 60 * 1000;       // codes expire after 5 minutes
const RESEND_COOLDOWN_MS = 60 * 1000;   // one code per email/purpose per 60s
const MAX_ATTEMPTS = 5;                 // wrong guesses before a code is dead
const BCRYPT_ROUNDS = 10;

/** A cryptographically secure 6-digit code, zero-padded ("004821"). */
function generateCode() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

/**
 * Issue a new code for email + purpose. Invalidates any previous outstanding
 * code. Enforces the resend cooldown.
 * @returns {Promise<{ok:true, code:string}|{ok:false, reason:'cooldown', retryAfter:number}>}
 *          `code` is for the mailer only — never expose it to the client.
 */
async function issue({ email, userId = null, purpose }) {
  const addr = String(email || '').trim().toLowerCase();
  const prev = await otpModel.latest(addr, purpose);
  if (prev) {
    const since = Date.now() - new Date(prev.createdAt).getTime();
    if (since < RESEND_COOLDOWN_MS) {
      return { ok: false, reason: 'cooldown', retryAfter: Math.ceil((RESEND_COOLDOWN_MS - since) / 1000) };
    }
  }
  await otpModel.invalidateActive(addr, purpose);
  const code = generateCode();
  const otpHash = await bcrypt.hash(code, BCRYPT_ROUNDS);
  await otpModel.insert({ email: addr, userId, otpHash, purpose, ttlSeconds: OTP_TTL_MS / 1000 });
  return { ok: true, code };
}

/**
 * Check a code the user typed. Never reveals the correct code.
 * @returns {Promise<{ok:true}|{ok:false, reason:'notfound'|'expired'|'too_many'|'incorrect', remaining?:number}>}
 */
async function verify({ email, purpose, code }) {
  const addr = String(email || '').trim().toLowerCase();
  const row = await otpModel.activeFor(addr, purpose);
  if (!row) return { ok: false, reason: 'notfound' };
  if (new Date(row.expiresAt).getTime() < Date.now()) return { ok: false, reason: 'expired' };
  if (row.attempts >= MAX_ATTEMPTS) return { ok: false, reason: 'too_many' };

  const match = await bcrypt.compare(String(code || ''), row.otpHash);
  if (!match) {
    await otpModel.incrementAttempts(row.id);
    const remaining = MAX_ATTEMPTS - (row.attempts + 1);
    return remaining > 0
      ? { ok: false, reason: 'incorrect', remaining }
      : { ok: false, reason: 'too_many' };
  }
  await otpModel.markVerified(row.id);   // one-time use: a verified row never matches again
  return { ok: true };
}

module.exports = {
  issue,
  verify,
  cleanup: otpModel.cleanup,
  OTP_TTL_MS,
  RESEND_COOLDOWN_MS,
  MAX_ATTEMPTS,
  TTL_MINUTES: OTP_TTL_MS / 60000,
};
