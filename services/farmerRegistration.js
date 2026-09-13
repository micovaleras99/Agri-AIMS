/**
 * Creating a farmer means creating two rows that must exist together: the
 * application record and the login account whose application_id points at it.
 *
 * Self-registration (controllers/authController) and admin registration
 * (controllers/adminFarmerController) both go through here so the transaction,
 * the application-id sequence, and the field defaults stay in one place.
 */

const bcrypt = require('bcrypt');
const { getPool } = require('../config/database');
const applicantModel = require('../models/applicantModel');
const userModel = require('../models/userModel');
const accountAudit = require('../models/accountAuditModel');
const locationModel = require('../models/locationModel');
const { requirementsFor } = require('../config/documentRequirements');
const { STEP_PROGRESS } = require('../controllers/accreditationHelpers');

const BCRYPT_ROUNDS = 12;

/** How many times to re-pick an application id when two saves collide. */
const ID_ATTEMPTS = 5;

/** Two-letter avatar, matching what the rest of the app expects. */
function initialsOf(firstName, lastName) {
  return `${String(firstName)[0] || ''}${String(lastName)[0] || ''}`.toUpperCase().slice(0, 2);
}

/**
 * A barangay id arriving from a form is untrusted: keep it only if it resolves
 * to a real row, otherwise store nothing rather than break the foreign key.
 * @param {unknown} raw
 * @returns {Promise<number|null>}
 */
async function resolveBarangayId(raw) {
  if (raw == null || String(raw).trim() === '') return null;
  const id = Number.parseInt(String(raw), 10);
  if (!Number.isInteger(id) || id <= 0) return null;
  return (await locationModel.barangayExists(id)) ? id : null;
}

/**
 * Creates the applicant record and its user account inside one transaction.
 *
 * @param {object} input
 * @param {string} input.firstName
 * @param {string} input.lastName
 * @param {string} [input.email]        normalised and checked for uniqueness by the
 *                                      caller; may be blank when createAccount is false
 * @param {string} [input.password]     plain text; hashed here. Required only when
 *                                      createAccount is true
 * @param {boolean} [input.createAccount=true]  false records the application without
 *                                      a login, for a farmer who has no email address
 * @param {string} [input.phone]
 * @param {string} [input.rsbsaNumber]
 * @param {string} [input.farmName]
 * @param {number} [input.farmArea]
 * @param {string} [input.farmAddress]
 * @param {string} [input.region]
 * @param {string} [input.province]
 * @param {string} [input.municipality]
 * @param {unknown} [input.barangayId]
 * @param {string} [input.lsaType]
 * @param {string} [input.category]
 * @param {string} [input.classification]
 * @param {string} [input.status]
 * @param {boolean} [input.createdByAdmin]
 * @returns {Promise<{ userId: number|null, applicationId: string }>} userId is null
 *          when no account was created
 */
async function registerFarmer(input) {
  const createAccount = input.createAccount !== false;

  // applicants.application_id carries a UNIQUE key and the next number comes
  // from MAX(id) + 1, which is not a locking read: two staff saving at the same
  // moment can choose the same LSA-YYYY-NNNN and one of them gets ER_DUP_ENTRY.
  // Re-read and try again rather than losing the save. Any other error, and a
  // duplicate on anything except the application id, still propagates.
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await attemptRegister(input, createAccount);
    } catch (err) {
      const isIdClash =
        err && err.code === 'ER_DUP_ENTRY' && /application_id/i.test(err.message || '');
      if (isIdClash && attempt < ID_ATTEMPTS) continue;
      throw err;
    }
  }
}

/** One transactional attempt. Separated so the caller above can retry it. */
async function attemptRegister(input, createAccount) {
  const barangayId = await resolveBarangayId(input.barangayId);
  // Where the barangay is known, it decides the three place names rather than
  // the form: they are a cache of the PSGC hierarchy, and a cache anyone can
  // type into drifts away from the row it is meant to mirror.
  const place = await locationModel.placeNamesFor(barangayId);
  const passwordHash = createAccount ? await bcrypt.hash(input.password, BCRYPT_ROUNDS) : null;
  const avatar = initialsOf(input.firstName, input.lastName);

  const conn = await getPool().getConnection();
  await conn.beginTransaction();
  try {
    const year = new Date().getFullYear();
    const [[mx]] = await conn.query('SELECT COALESCE(MAX(id), 0) AS m FROM applicants');
    const applicationId = `LSA-${year}-${String(Number(mx.m) + 1).padStart(4, '0')}`;
    const submissionDate = new Date().toISOString().split('T')[0];

    await applicantModel.create(
      {
        applicationId,
        firstName: input.firstName.trim(),
        lastName: input.lastName.trim(),
        email: (input.email || '').trim(),
        phone: (input.phone || '').trim(),
        rsbsaNumber: (input.rsbsaNumber || '').trim(),
        farmName: (input.farmName || 'My Farm').trim(),
        farmArea: Number.parseInt(String(input.farmArea), 10) || 0,
        farmAddress: (input.farmAddress || '').trim(),
        region: place ? place.region : (input.region || '').trim(),
        province: place ? place.province : (input.province || '').trim(),
        municipality: place ? place.municipality : (input.municipality || '').trim(),
        barangayId,
        lsaType: input.lsaType || 'regular',
        category: input.category || 'private',
        classification: input.classification || '',
        assistanceType: input.assistanceType || '',
        status: input.status || 'submitted',
        // Was hardcoded to 20, which is STEP_PROGRESS[2] — the progress of an
        // applicant who has already read and signed the briefer. A new
        // registration has not, so every account began life showing a fifth of
        // the procedure done. Read the same table advanceStep() writes from.
        progress: STEP_PROGRESS[1],
        submissionDate,
        accreditationStep: 1,
        documents: 0,
        // Agri-processing enterprises, organizations and government-owned sites
        // owe extra documents, so the denominator is not always 12.
        // Recomputed by the edit handler when those fields change.
        totalDocs: requirementsFor({
          category: input.category || 'private',
          classification: input.classification || '',
          assistanceType: input.assistanceType || '',
        }).length,
      },
      { connection: conn }
    );

    // A farmer with no email address cannot have a login, and in the barangays
    // this system serves that is common rather than exceptional. The application
    // record is still created; only the account is skipped.
    let userId = null;
    if (createAccount) {
      userId = await userModel.createUser(
        {
          firstName: input.firstName.trim(),
          lastName: input.lastName.trim(),
          email: input.email,
          passwordHash,
          role: 'applicant',
          position: 'Applicant',
          office: (input.farmName || 'Pending farm name').trim(),
          region: (input.region || '').trim(),
          avatar,
          phone: (input.phone || '').trim(),
          farmId: null,
          applicationId,
          createdByAdmin: input.createdByAdmin ? 1 : 0,
        },
        { connection: conn }
      );
    }

    await conn.commit();

    // Audit trail (req. 13). Written after commit and outside the transaction —
    // a logging hiccup must never roll back a successful registration.
    const who = input.createdByAdmin ? 'ATI administrator' : 'Self-registration';
    try {
      await accountAudit.log({
        userId, applicationId, action: 'applicant_created', actorName: who,
        detail: 'Applicant profile created at registration.',
      });
      if (userId) {
        await accountAudit.log({
          userId, applicationId, action: 'account_created', actorName: who,
          detail: 'Login account created and linked to the applicant.',
        });
      }
    } catch { /* audit is best-effort; registration already succeeded */ }

    return { userId, applicationId };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = { registerFarmer, resolveBarangayId, initialsOf };
