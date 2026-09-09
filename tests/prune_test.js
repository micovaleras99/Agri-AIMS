/**
 * scripts/prune-uploads.js must delete only genuine orphans.
 *
 * Files in uploads/ are named the same whether they are documents or profile
 * photos, and both tables reference them. A prune that deleted anything without
 * a document row would take live avatars with it. This pins the three safety
 * rules — reference-awareness, the naming filter, and the age guard — by
 * running the script's DRY RUN (which changes nothing) and reading its report.
 *
 *   node tests/prune_test.js
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { pool } = require('../config/database');
const { UPLOAD_DIR } = require('../config/upload');

let failures = 0;
function check(label, condition) {
  console.log((condition ? 'PASS  ' : 'FAIL  ') + label);
  if (!condition) failures += 1;
}

const hex = () => require('crypto').randomBytes(16).toString('hex');
const write = (name, ageMs) => {
  const abs = path.join(UPLOAD_DIR, name);
  fs.writeFileSync(abs, 'x');
  if (ageMs) { const t = Date.now() - ageMs; fs.utimesSync(abs, t / 1000, t / 1000); }
  return abs;
};

async function main() {
  const orphanOld = hex() + '.pdf';   // ours, unreferenced, old  -> should list
  const orphanNew = hex() + '.pdf';   // ours, unreferenced, fresh -> age guard spares
  const referenced = hex() + '.png';  // ours, but a photo row points at it -> spared
  const foreign = 'not-our-scheme.txt'; // not our naming -> ignored

  const planted = [];
  let userId = null;

  try {
    planted.push(write(orphanOld, 10 * 60 * 1000));
    planted.push(write(orphanNew, 0));
    planted.push(write(referenced, 10 * 60 * 1000));
    planted.push(write(foreign));

    // A real row that points at the "referenced" file, so the script must spare it.
    const [res] = await pool.execute(
      `INSERT INTO users (first_name, last_name, email, password_hash, role, photo)
       VALUES ('Prune','Test',?, 'x', 'applicant', ?)`,
      [`prune.${Date.now()}@example.com`, referenced]
    );
    userId = res.insertId;

    const out = execFileSync('node', ['scripts/prune-uploads.js'], { encoding: 'utf8' });

    console.log('--- the dry run classifies each planted file ---');
    check('an old unreferenced file is reported as an orphan', out.includes(orphanOld));
    check('a file newer than 5 minutes is spared (upload may be in flight)',
      !out.includes(orphanNew));
    check('a file a photo row still points at is spared', !out.includes(referenced));
    check('a file not following our naming scheme is ignored', !out.includes(foreign));
    const photoCount = Number((out.match(/(\d+) photos/) || [])[1] || 0);
    check(`and it counts photos among referenced files (${photoCount})`, photoCount >= 1);

    console.log('\n--- and it is a DRY run: nothing was deleted ---');
    check('every planted file is still on disk',
      planted.every((p) => fs.existsSync(p)));
  } finally {
    for (const p of planted) { try { fs.unlinkSync(p); } catch (_) { /* gone */ } }
    if (userId) await pool.execute('DELETE FROM users WHERE id = ?', [userId]).catch(() => {});
    await pool.end();
  }

  console.log('');
  if (failures) {
    console.log(failures + ' CHECK(S) FAILED');
    process.exitCode = 1;
  } else {
    console.log('ALL PRUNE CHECKS PASSED');
  }
}

main().catch(async (err) => {
  console.error(err);
  try { await pool.end(); } catch (_) { /* already closed */ }
  process.exit(1);
});
