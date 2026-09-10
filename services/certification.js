/**
 * The handover from application to Learning Site.
 *
 * Step 7 issues the Certificate of Accreditation and executes the MOA. Before
 * this file existed that stamped the applicant row and stopped: no `farms` row
 * was ever created by the running application (farmModel had no insert at all),
 * and the account stayed `role = 'applicant'` with `farm_id` NULL.
 *
 * Everything the certificate is supposed to unlock reads one or the other of
 * those two things:
 *
 *   renewal, the reminder job, LSA II, compliance, reports,
 *   the public directory, the RSC-07 registry export   →  farms
 *   the operator dashboard, the MOA obligations it tracks →  role + farm_id
 *
 * So a certified operator could not renew the certificate they had just been
 * given, and their Learning Site did not appear in the directory it exists to
 * be listed in.
 *
 * Shared by the Step 7 route and scripts/backfill-accredited-farms.js so the
 * two cannot drift.
 */

const farmModel = require('../models/farmModel');
const userModel = require('../models/userModel');

/**
 * Create the Learning Site for a certified application and promote its account.
 *
 * Idempotent: a re-posted Step 7 finds the existing farm and creates nothing.
 * The farm is keyed on the application, not on the farm name, because two
 * different applicants may well name their farms the same thing.
 *
 * @param {object} applicant                              the applicant record
 * @param {{accreditedSince: string, expiryDate: string}} dates  from the certificate
 * @returns {Promise<{farmId: number, farmCreated: boolean, promotedUserId: number|null}>}
 */
async function certify(applicant, dates) {
  const existing = await farmModel.findByApplicant(applicant.id);
  const farmId = existing ? existing.id : await farmModel.createFromApplicant(applicant, dates);

  let promotedUserId = null;
  const user = await userModel.findByApplicationId(applicant.applicationId);
  if (!user) {
    // An application filed at the office may have no account yet. The farm is
    // still created — the site is accredited either way — but say so, because
    // nobody can sign in to operate it until an account is linked.
    console.warn(`certify: no account for ${applicant.applicationId} — farm ${farmId} has no operator login yet.`);
  } else if (user.role !== 'operator' || Number(user.farmId) !== Number(farmId)) {
    await userModel.promoteToOperator(user.id, farmId);
    promotedUserId = user.id;
  }

  return { farmId, farmCreated: !existing, promotedUserId };
}

module.exports = { certify };
