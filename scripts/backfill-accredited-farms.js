/**
 * Creates the Learning Site for applications that were certified before Step 7
 * knew how to create one.
 *
 * Between the system going live and services/certification.js, issuing a
 * certificate stamped the applicant row and nothing else. Those applications
 * hold a real certificate number and a real validity date but have no `farms`
 * row, so renewal, the reminder job, LSA II, compliance, the directory and the
 * registry export cannot see them, and the operator cannot sign in as one.
 *
 * Runs the same certify() the Step 7 route now runs, so a farm built by this
 * script is identical to one built by issuing the certificate. Safe to run
 * repeatedly: an application that already has a farm is reported and skipped.
 *
 *   node scripts/backfill-accredited-farms.js            list what would change
 *   node scripts/backfill-accredited-farms.js --apply    make the change
 */

require('dotenv').config();

const { pool } = require('../config/database');
const applicantModel = require('../models/applicantModel');
const { certify } = require('../services/certification');

async function main() {
  const apply = process.argv.includes('--apply');

  const [rows] = await pool.query(
    `SELECT a.id
       FROM applicants a
       LEFT JOIN farms f ON f.applicant_id = a.id
      WHERE a.step7_certificate_no IS NOT NULL
        AND a.step7_certificate_no <> ''
        AND f.id IS NULL
      ORDER BY a.id ASC`
  );

  if (!rows.length) {
    console.log('Every certified application already has a Learning Site. Nothing to do.');
    return;
  }

  console.log(`${rows.length} certified application(s) with no Learning Site:\n`);

  for (const { id } of rows) {
    const applicant = await applicantModel.findById(id);
    console.log(`  ${applicant.applicationId}  ${applicant.farmName}`);
    console.log(`    certificate ${applicant.step7_certificateNo}, `
      + `issued ${applicant.step7_issueDate}, valid until ${applicant.step7_validUntil}`);

    if (!apply) {
      console.log('    (dry run — pass --apply to create it)\n');
      continue;
    }

    const result = await certify(applicant, {
      accreditedSince: applicant.step7_issueDate,
      expiryDate: applicant.step7_validUntil,
    });
    console.log(`    farm ${result.farmId} created`
      + (result.promotedUserId ? `, user ${result.promotedUserId} is now its LSA Operator` : '')
      + '\n');
  }

  if (!apply) console.log('Dry run. Re-run with --apply to make these changes.');
}

main()
  .then(() => pool.end())
  .catch(async (err) => {
    console.error(err);
    await pool.end().catch(() => {});
    process.exit(1);
  });
