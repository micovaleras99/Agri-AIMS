/**
 * Storage for one-time passwords (see migration 042). The plaintext code is
 * never stored — only its bcrypt hash — and registration and password-reset
 * codes are separated by `purpose` so one can never satisfy the other.
 *
 * The service layer (services/otp.js) owns generation, hashing, expiry and
 * attempt logic; this model is only the queries.
 */

const { query, pool } = require('../config/database');
const { rowToCamel } = require('../utils/caseConvert');

/** The most recent code for an email + purpose (verified or not), for cooldown checks. */
async function latest(email, purpose) {
  const rows = await query(
    `SELECT * FROM otp_codes WHERE email = ? AND purpose = ? ORDER BY id DESC LIMIT 1`,
    [String(email), purpose]
  );
  return rows[0] ? rowToCamel(rows[0]) : null;
}

/** The latest still-unverified code for an email + purpose — the one a verify targets. */
async function activeFor(email, purpose) {
  const rows = await query(
    `SELECT * FROM otp_codes
      WHERE email = ? AND purpose = ? AND verified_at IS NULL
      ORDER BY id DESC LIMIT 1`,
    [String(email), purpose]
  );
  return rows[0] ? rowToCamel(rows[0]) : null;
}

/** Drop any outstanding (unverified) codes so a freshly issued one is the only valid code. */
async function invalidateActive(email, purpose) {
  await query(
    `DELETE FROM otp_codes WHERE email = ? AND purpose = ? AND verified_at IS NULL`,
    [String(email), purpose]
  );
}

async function insert({ email, userId, otpHash, purpose, ttlSeconds }) {
  // Compute expiry in SQL (NOW() + INTERVAL) so it is in the database server's
  // own clock/zone — a JS-built UTC timestamp would read as already expired
  // wherever the server runs ahead of UTC.
  const [res] = await pool.execute(
    `INSERT INTO otp_codes (email, user_id, otp_hash, purpose, expires_at)
     VALUES (?,?,?,?, (NOW() + INTERVAL ? SECOND))`,
    [String(email), userId ?? null, otpHash, purpose, ttlSeconds]
  );
  return res.insertId;
}

async function incrementAttempts(id) {
  await query('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = ?', [id]);
}

async function markVerified(id) {
  await query('UPDATE otp_codes SET verified_at = NOW() WHERE id = ?', [id]);
}

/** Housekeeping: drop expired codes and verified ones older than a day. */
async function cleanup() {
  await query(
    `DELETE FROM otp_codes
      WHERE expires_at < NOW()
         OR (verified_at IS NOT NULL AND verified_at < (NOW() - INTERVAL 1 DAY))`
  );
}

module.exports = {
  latest, activeFor, invalidateActive, insert, incrementAttempts, markVerified, cleanup,
};
