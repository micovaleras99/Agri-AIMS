/**
 * The applicant-authored LSA Development Plan content, one per application,
 * stored as JSON (see database/migrations/037). It is a small structured
 * document — implementation date, budget summary, rationale, objectives, and two
 * repeatable tables (work plan, budget) — injected into the official DOCX at
 * generation time (services/developmentPlanDoc.js).
 */

const { query, pool } = require('../config/database');

/** The stored plan for an applicant, parsed, or null if none saved yet. */
async function get(applicantId) {
  const rows = await query('SELECT data FROM development_plans WHERE applicant_id = ? LIMIT 1', [Number(applicantId)]);
  if (!rows[0]) return null;
  try { return JSON.parse(rows[0].data); } catch { return null; }
}

/** Insert or replace the plan for an applicant. */
async function save(applicantId, data) {
  await pool.execute(
    'INSERT INTO development_plans (applicant_id, data) VALUES (?, ?) ON DUPLICATE KEY UPDATE data = VALUES(data)',
    [Number(applicantId), JSON.stringify(data || {})]
  );
}

module.exports = { get, save };
