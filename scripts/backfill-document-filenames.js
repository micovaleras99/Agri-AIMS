/**
 * Rename existing document rows to the type-driven display name
 * (<Document-Type>-<Applicant>.<ext>), the same scheme new uploads now use.
 *
 * Only the `filename` column changes — the stored file on disk (stored_name) is
 * untouched, so this is safe and reversible per-row. Documents already at their
 * target name are skipped.
 *
 *   node scripts/backfill-document-filenames.js            # dry run
 *   node scripts/backfill-document-filenames.js --apply    # write changes
 */

require('dotenv').config();
const { pool } = require('../config/database');
const { submissionFilename } = require('../config/documentRequirements');

(async () => {
  const apply = process.argv.includes('--apply');
  const [rows] = await pool.query(`
    SELECT d.id, d.type, d.name, d.filename, d.applicant_name, a.first_name, a.last_name
    FROM documents d
    LEFT JOIN applicants a ON a.id = d.applicant_id
    ORDER BY d.id
  `);

  const slug = (s) => String(s || '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const changes = [];
  for (const r of rows) {
    let firstName = r.first_name;
    let lastName = r.last_name;
    if (!firstName && !lastName && r.applicant_name) {
      const parts = String(r.applicant_name).trim().split(/\s+/);
      firstName = parts.shift() || '';
      lastName = parts.join(' ');
    }
    // A file whose name already carries the applicant (a generated form, or one
    // already renamed) is left as-is; only raw upload names are fixed.
    const lastSlug = slug(lastName);
    if (lastSlug && slug(r.filename).includes(lastSlug)) continue;

    // The doc's own `name` is the label fallback for types with no catalogue
    // entry (e.g. lsa_certificate -> "LSA Certificate").
    const next = submissionFilename(r.type, { firstName, lastName }, r.filename, r.name);
    if (next && next !== r.filename) changes.push({ id: r.id, from: r.filename, to: next });
  }

  console.log(`${rows.length} documents, ${changes.length} to rename`);
  for (const c of changes) console.log(`  #${c.id}  ${c.from}  ->  ${c.to}`);

  if (apply) {
    for (const c of changes) {
      await pool.execute('UPDATE documents SET filename = ? WHERE id = ?', [c.to, c.id]);
    }
    console.log(`\nApplied ${changes.length} rename(s).`);
  } else {
    console.log('\nDry run — re-run with --apply to write.');
  }
  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });
