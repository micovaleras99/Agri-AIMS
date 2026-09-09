/**
 * Recompute applicants.total_docs from the current documentary requirements.
 *
 * total_docs is a denormalised count of "how many documents does this applicant
 * owe". It was written as a literal 12 when the requirement list held 12 types.
 * The list has since grown, and conditional requirements were added for
 * agri-processing enterprises, organizations, government-owned sites and
 * applicants endorsed with financial assistance — so the stored number no longer
 * matches what requirementsFor() actually asks of them, and every progress bar
 * reads against the wrong denominator.
 *
 * Derived value, safe to recompute. Run with --apply to write; without it the
 * script only reports what it would change.
 *
 *   node scripts/backfill-total-docs.js            # dry run
 *   node scripts/backfill-total-docs.js --apply
 */

require('dotenv').config();
const { pool } = require('../config/database');
const { requirementsFor } = require('../config/documentRequirements');

const APPLY = process.argv.includes('--apply');

(async () => {
  const [rows] = await pool.query(
    'SELECT id, application_id, category, classification, assistance_type, documents, total_docs ' +
      'FROM applicants ORDER BY id'
  );

  let changed = 0;
  for (const r of rows) {
    const want = requirementsFor({
      category: r.category,
      classification: r.classification,
      assistanceType: r.assistance_type,
    }).length;

    if (want === r.total_docs) continue;
    changed += 1;
    console.log(
      `  ${r.application_id}  ${String(r.category || '—').padEnd(13)}` +
        `total_docs ${r.total_docs} -> ${want}` +
        (r.documents > want ? '   (submitted count exceeds the new total — check manually)' : '')
    );
    if (APPLY) {
      await pool.execute('UPDATE applicants SET total_docs = ? WHERE id = ?', [want, r.id]);
    }
  }

  if (!changed) console.log('  nothing to change — every applicant already matches');
  else console.log(`\n${changed} of ${rows.length} applicants ${APPLY ? 'updated' : 'would change'}.`);
  if (!APPLY && changed) console.log('Re-run with --apply to write these values.');

  await pool.end();
})().catch((e) => {
  console.error('backfill failed:', e.message);
  process.exit(1);
});
