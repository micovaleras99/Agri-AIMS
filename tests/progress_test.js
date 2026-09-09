/**
 * Accreditation progress must come from one table.
 *
 * A brand-new registration displayed 20% complete. `STEP_PROGRESS` maps a step
 * to the progress on arriving at it, and registration hardcoded 20 — which is
 * STEP_PROGRESS[2], the progress of an applicant who has already read and
 * signed the briefer. Every account was created a step ahead of itself.
 *
 *   node tests/progress_test.js
 */

require('dotenv').config();

const fs = require('fs');
const { pool } = require('../config/database');
const applicantModel = require('../models/applicantModel');
const userModel = require('../models/userModel');
const { registerFarmer } = require('../services/farmerRegistration');
const { STEP_PROGRESS, STEP_STATUS } = require('../controllers/accreditationHelpers');

let failures = 0;
function check(label, condition) {
  console.log((condition ? 'PASS  ' : 'FAIL  ') + label);
  if (!condition) failures += 1;
}

async function main() {
  console.log('--- the table itself ---');
  check('every step from 1 to 7 has a progress value',
    [1, 2, 3, 4, 5, 6, 7].every((s) => typeof STEP_PROGRESS[s] === 'number'));
  check('progress only ever increases with the step',
    [1, 2, 3, 4, 5, 6].every((s) => STEP_PROGRESS[s] < STEP_PROGRESS[s + 1]));
  check('the last step is 100%', STEP_PROGRESS[7] === 100);

  console.log('\n--- a real registration ---');
  const stamp = Date.now();
  const email = `progress.test.${stamp}@example.com`;
  let userId = null;
  let applicationId = null;

  try {
    const res = await registerFarmer({
      firstName: 'Progress',
      lastName: 'Test',
      email,
      password: 'Str0ng!Pass1',
      phone: '09170000000',
      farmName: 'Progress Test Farm',
      farmAddress: 'Test',
      region: 'Region V',
      createdByAdmin: false,
    });
    userId = res.userId;
    applicationId = res.applicationId;

    const app = await applicantModel.findByApplicationId(applicationId);
    check('the application was created', !!app);
    check(`a new registration sits at step 1, not further (step ${app.accreditationStep})`,
      app.accreditationStep === 1);
    check(`its progress is STEP_PROGRESS[1] = ${STEP_PROGRESS[1]}%, not ${STEP_PROGRESS[2]}% (got ${app.progress}%)`,
      Number(app.progress) === STEP_PROGRESS[1]);
    // The specific symptom that was reported, stated as its own check.
    check('registering no longer credits the applicant with the briefing they have not done',
      Number(app.progress) !== STEP_PROGRESS[2]);
    check('and its status matches the step table',
      app.status === STEP_STATUS[1]);
  } finally {
    if (applicationId) {
      const app = await applicantModel.findByApplicationId(applicationId);
      if (app) await pool.execute('DELETE FROM applicants WHERE id = ?', [app.id]);
    }
    if (userId) await pool.execute('DELETE FROM users WHERE id = ?', [userId]);
  }

  console.log('\n--- nothing writes progress by hand any more ---');
  // The bug was one hardcoded number disagreeing with the table. The rule, not
  // the instance: progress and the step status are assigned from STEP_PROGRESS
  // and STEP_STATUS, never from a literal.
  const offenders = [];
  for (const f of ['services/farmerRegistration.js', 'routes/applicants.js',
    'routes/accreditation.js', 'controllers/adminFarmerController.js']) {
    if (!fs.existsSync(f)) continue;
    const src = fs.readFileSync(f, 'utf8');
    for (const m of src.matchAll(/\bprogress:\s*(\d+)/g)) offenders.push(`${f}: progress: ${m[1]}`);
    for (const m of src.matchAll(/patch\.progress\s*=\s*[^;]*?\b(\d{2,3})\b/g)) {
      offenders.push(`${f}: patch.progress = ...${m[1]}`);
    }
  }
  check('no route or service writes a progress number of its own'
    + (offenders.length ? '\n      ' + offenders.join('\n      ') : ''), offenders.length === 0);

  await pool.end();
  console.log('');
  if (failures) {
    console.log(failures + ' CHECK(S) FAILED');
    process.exitCode = 1;
  } else {
    console.log('ALL PROGRESS CHECKS PASSED');
  }
}

main().catch(async (err) => { console.error(err); try { await pool.end(); } catch (_) {} process.exit(1); });
