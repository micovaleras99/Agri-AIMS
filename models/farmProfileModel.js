/**
 * Applicant-authored Farm/Agri-Enterprise Profile (ATI-QF-PAD-48) content, one
 * per application, stored as JSON (see database/migrations/038). The identity
 * fields live on the applicant record; this holds the rest of the form.
 */

const { query, pool } = require('../config/database');

/** The stored profile for an applicant, parsed, or null if none saved yet. */
async function get(applicantId) {
  const rows = await query('SELECT data FROM farm_profiles WHERE applicant_id = ? LIMIT 1', [Number(applicantId)]);
  if (!rows[0]) return null;
  try { return JSON.parse(rows[0].data); } catch { return null; }
}

/** Insert or replace the profile for an applicant. */
async function save(applicantId, data) {
  await pool.execute(
    'INSERT INTO farm_profiles (applicant_id, data) VALUES (?, ?) ON DUPLICATE KEY UPDATE data = VALUES(data)',
    [Number(applicantId), JSON.stringify(data || {})]
  );
}

module.exports = { get, save };
