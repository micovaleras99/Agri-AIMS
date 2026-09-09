/**
 * RSC-02 — an administrator registering a farmer directly.
 *
 * Self-registration creates an account for whoever is at the keyboard. This is
 * the other path: ATI staff enrolling a farmer who applied on paper or at the
 * office, capturing the farm profile and barangay in the same step.
 */

const crypto = require('crypto');
const userModel = require('../models/userModel');
const locationModel = require('../models/locationModel');
const { registerFarmer } = require('../services/farmerRegistration');
const notify = require('../services/notify');
const { checkEmail, isStrongPassword, PASSWORD_RULES } = require('../utils/validation');
const { duplicateMessage } = require('../middleware/errorHandler');
const { checkArea } = require('../config/farmEligibility');

/**
 * A password ATI staff can read out to the farmer. Satisfies the strength rules
 * in utils/validation, and the farmer should change it on first sign-in.
 */
function generatePassword() {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnopqrstuvwxyz';
  const digits = '23456789';
  const symbols = '!@#$%&*';
  const pick = (set) => set[crypto.randomInt(set.length)];
  const chars = [pick(upper), pick(lower), pick(digits), pick(symbols)];
  const all = upper + lower + digits + symbols;
  while (chars.length < 12) chars.push(pick(all));
  // Fisher-Yates so the guaranteed characters are not always in front.
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

/** Re-renders the form with what was typed, so nothing is lost on an error. */
async function renderForm(res, { error = null, notice = null, values = {}, createdUser = null } = {}) {
  return res.render('pages/admin/farmer-form', {
    title: 'Register Farmer — Agri-AIMS',
    page: 'applicants',
    error,
    notice,
    values,
    createdUser,
    locationSelection: values.barangayId
      ? await locationSelectionFor(values.barangayId)
      : null,
  });
}

async function locationSelectionFor(barangayId) {
  const a = await locationModel.findAncestry(Number(barangayId));
  if (!a) return null;
  return {
    regionId: a.regionId,
    provinceId: a.provinceId,
    municipalityId: a.municipalityId,
    barangayId: a.barangayId,
  };
}

/** GET /admin/farmers/new */
async function newFarmerForm(req, res) {
  return renderForm(res, { values: { generatePassword: 'on', createAccount: 'on' } });
}

/** POST /admin/farmers */
async function createFarmer(req, res) {
  const b = req.body;
  const values = {
    firstName: (b.firstName || '').trim(),
    lastName: (b.lastName || '').trim(),
    email: (b.email || '').trim().toLowerCase(),
    phone: (b.phone || '').trim(),
    rsbsaNumber: (b.rsbsaNumber || '').trim(),
    farmName: (b.farmName || '').trim(),
    farmArea: (b.farmArea || '').toString().trim(),
    farmAddress: (b.farmAddress || '').trim(),
    region: (b.region || '').trim(),
    province: (b.province || '').trim(),
    municipality: (b.municipality || '').trim(),
    barangayId: b.barangayId || '',
    lsaType: b.lsaType || 'regular',
    category: b.category || 'private',
    classification: b.classification || '',
    status: b.status || 'submitted',
    generatePassword: b.generatePassword === 'on' ? 'on' : '',
    createAccount: b.createAccount === 'on' ? 'on' : '',
  };

  // Unticking "create a login account" is how staff record a farmer who has no
  // email address — the application is still created, only the account is not.
  const createAccount = values.createAccount === 'on';

  if (!values.firstName || !values.lastName) {
    return renderForm(res, { error: 'First name and last name are required.', values });
  }
  if (createAccount && !values.email) {
    return renderForm(res, {
      error: 'An email address is required to create a login account. Untick "Create a login account" to register a farmer without one.',
      values,
    });
  }
  // An email is optional without an account, but if one is given it must be usable.
  if (values.email) {
    const emailError = await checkEmail(values.email);
    if (emailError) return renderForm(res, { error: emailError, values });
  }
  if (createAccount && (await userModel.emailTaken(values.email))) {
    return renderForm(res, { error: 'An account with that email address already exists.', values });
  }

  const generated = values.generatePassword === 'on';
  const password = createAccount ? (generated ? generatePassword() : String(b.password || '')) : '';
  if (createAccount && !generated && !isStrongPassword(password)) {
    return renderForm(res, { error: PASSWORD_RULES, values });
  }

  try {
    const { userId, applicationId } = await registerFarmer({
      ...values,
      password,
      // Explicit boolean: `values.createAccount` is the form's 'on'/'' string,
      // and '' would read as truthy against the service's `!== false` default.
      createAccount,
      createdByAdmin: true,
    });

    if (userId) await notify.accountCreatedByAdmin(userId, applicationId);

    const area = checkArea(values);
    const areaWarning = area.meets === false
      ? ` Note: ${area.area.toLocaleString()} sq.m. is below the ${area.minimum.toLocaleString()} sq.m. minimum — ${area.rule}`
      : '';

    return renderForm(res, {
      notice: createAccount
        ? `${values.firstName} ${values.lastName} is registered as ${applicationId}.` + areaWarning
        : `${values.firstName} ${values.lastName} is registered as ${applicationId}. No login account was created — staff will act on this application for them.` + areaWarning,
      values: {},
      createdUser: {
        id: userId,
        applicationId,
        email: values.email,
        hasAccount: createAccount,
        // Shown once, on this screen only — it is never stored in plain text.
        password: createAccount && generated ? password : null,
      },
    });
  } catch (err) {
    const duplicate = duplicateMessage(err);
    if (duplicate) {
      return renderForm(res, { error: duplicate, values });
    }
    throw err;
  }
}

module.exports = { newFarmerForm, createFarmer, generatePassword };
