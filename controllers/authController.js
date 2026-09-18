/**
 * REST authentication: register, login, logout, and the email-OTP flows for
 * registration verification and password reset.
 *
 * Registration no longer logs the user in on creation — the account is created
 * unverified and a 6-digit OTP is emailed; the account activates (and signs in)
 * only after the code is verified. Password reset is Email → OTP → new password,
 * where the reset step is authorised by a short-lived token issued only on a
 * successful OTP verification, so a password cannot be changed without it.
 */

const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const userModel = require('../models/userModel');
const farmModel = require('../models/farmModel');
const { registerFarmer } = require('../services/farmerRegistration');
const { signToken } = require('../middleware/auth');
const { checkEmail, isStrongPassword, PASSWORD_RULES } = require('../utils/validation');
const { asyncHandler } = require('../utils/asyncHandler');
const { setAuthCookie, clearAuthCookie } = require('../utils/cookies');
const otpService = require('../services/otp');
const mailer = require('../config/mailer');

const RESET_TOKEN_TTL = '10m';

function norm(email) {
  return String(email || '').trim().toLowerCase();
}

/** Turn an OTP verify failure into a safe client message — never reveals the code. */
function otpErrorBody(result) {
  switch (result.reason) {
    case 'incorrect':
      return {
        error: `That code is incorrect. ${result.remaining} attempt${result.remaining === 1 ? '' : 's'} left.`,
        code: 'OTP_INCORRECT',
      };
    case 'expired':
      return { error: 'That code has expired. Please request a new one.', code: 'OTP_EXPIRED' };
    case 'too_many':
      return { error: 'Too many incorrect attempts. Please request a new code.', code: 'OTP_TOO_MANY' };
    default:
      return { error: 'No active code. Please request a new one.', code: 'OTP_NOT_FOUND' };
  }
}

/**
 * Issue an OTP and email it. Returns a status the caller maps to a response:
 * 'sent' (emailed), 'cooldown' (a code was issued moments ago; not re-sent),
 * 'mailfail' (SMTP declined) or 'error'. The plaintext code stays here — it is
 * passed only to the mailer, never returned to the caller or the client.
 */
async function issueAndEmail(email, userId, purpose) {
  const issued = await otpService.issue({ email, userId, purpose });
  if (!issued.ok) {
    return issued.reason === 'cooldown'
      ? { status: 'cooldown', retryAfter: issued.retryAfter }
      : { status: 'error' };
  }
  const sent = await mailer.sendOtp(email, {
    purpose, code: issued.code, minutes: otpService.ttlMinutes(purpose),
  });
  return { status: sent ? 'sent' : 'mailfail' };
}

const farmsForRegister = asyncHandler(async (req, res) => {
  const farms = await farmModel.findAll();
  const data = farms.map((f) => ({ id: f.id, name: f.name, operator: f.operator, province: f.province }));
  res.json({ success: true, data });
});

const logout = asyncHandler(async (req, res) => {
  clearAuthCookie(res);
  res.json({ success: true, message: 'Logged out' });
});

// ── Registration ────────────────────────────────────────────────────────────

const register = asyncHandler(async (req, res) => {
  const {
    firstName, lastName, email, password, phone, region,
    role: rawRole, farmId: rawFarmId,
    farmName, farmAddress, province, municipality, barangayId,
    farmArea, lsaType, category, classification, rsbsaNumber,
  } = req.body;

  const role = rawRole === 'operator' ? 'operator' : 'applicant';

  if (!firstName || !lastName || !email || !password) {
    return res.status(400).json({ success: false, error: 'firstName, lastName, email, and password are required' });
  }
  const emailError = await checkEmail(email);
  if (emailError) return res.status(400).json({ success: false, error: emailError });
  if (!isStrongPassword(password)) return res.status(400).json({ success: false, error: PASSWORD_RULES });

  const emailNorm = norm(email);

  // A verified account already owns this address. An UNVERIFIED account is an
  // abandoned/incomplete registration for the same address: rather than block
  // the address forever, adopt this attempt's password and re-send a code, so
  // the real owner of the inbox can still complete it.
  const existing = await userModel.findByEmail(emailNorm);
  if (existing && existing.emailVerified) {
    return res.status(409).json({ success: false, error: 'Email is already registered' });
  }
  if (existing && !existing.emailVerified) {
    await userModel.updatePasswordHash(existing.id, await bcrypt.hash(password, 12));
    const r = await issueAndEmail(emailNorm, existing.id, 'registration');
    return res.status(200).json({
      success: true,
      data: { needsOtp: true, email: emailNorm, purpose: 'registration', emailSent: r.status !== 'mailfail' },
    });
  }

  const initials = `${String(firstName)[0] || ''}${String(lastName)[0] || ''}`.toUpperCase().slice(0, 2);
  let userId;
  let applicationId = null;

  if (role === 'operator') {
    let farmId = rawFarmId != null && rawFarmId !== '' ? parseInt(String(rawFarmId), 10) : null;
    if (farmId != null && Number.isNaN(farmId)) {
      return res.status(400).json({ success: false, error: 'farmId must be a valid number' });
    }
    if (farmId && !(await farmModel.findById(farmId))) {
      return res.status(400).json({ success: false, error: 'The selected LSA farm was not found.' });
    }
    userId = await userModel.createUser({
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: emailNorm,
      passwordHash: await bcrypt.hash(password, 12),
      role: 'operator',
      position: 'LSA Operator',
      office: '',
      region: region || '',
      avatar: initials,
      phone: (phone || '').trim(),
      farmId,
      applicationId: null,
      emailVerified: 0, // self-registration verifies by OTP first
    });
  } else {
    // The application row and the login account are created together in one
    // transaction by the shared service; the account is created unverified.
    const result = await registerFarmer({
      firstName, lastName, email: emailNorm, password, phone,
      farmName, farmAddress, region, province, municipality, barangayId,
      farmArea, lsaType, category, classification, rsbsaNumber,
      createdByAdmin: false,
    });
    userId = result.userId;
    applicationId = result.applicationId;
  }

  // The account is created either way; if the code email could not be sent the
  // user simply taps Resend on the verification screen. Registration never fails
  // solely because SMTP is unavailable.
  const r = await issueAndEmail(emailNorm, userId, 'registration');
  return res.status(201).json({
    success: true,
    data: {
      needsOtp: true,
      email: emailNorm,
      purpose: 'registration',
      applicationId,
      emailSent: r.status !== 'mailfail',
    },
  });
});

/** Verify a registration OTP → activate the account and sign the user in. */
const verifyRegistrationOtp = asyncHandler(async (req, res) => {
  const email = norm(req.body.email);
  const code = String(req.body.code || '').trim();
  if (!email || !/^\d{6}$/.test(code)) {
    return res.status(400).json({ success: false, error: 'Enter the 6-digit code.' });
  }
  const result = await otpService.verify({ email, purpose: 'registration', code });
  if (!result.ok) {
    return res.status(400).json({ success: false, ...otpErrorBody(result) });
  }
  const user = await userModel.findByEmail(email);
  if (!user) {
    return res.status(400).json({ success: false, error: 'Account not found. Please register again.' });
  }
  await userModel.markEmailVerified(user.id);
  const fresh = await userModel.findById(user.id);
  const token = signToken(fresh);
  setAuthCookie(res, token);
  return res.json({ success: true, data: { user: fresh, verified: true } });
});

/**
 * Resend a code. Always answers generically so it never reveals whether an
 * address exists (matters for password_reset) or is already verified; the
 * per-email 60s cooldown in the service quietly suppresses a too-soon re-send.
 */
const resendOtp = asyncHandler(async (req, res) => {
  const email = norm(req.body.email);
  const purpose = req.body.purpose === 'password_reset' ? 'password_reset' : 'registration';
  const generic = { success: true, data: { resent: true } };
  if (!email) return res.json(generic);

  const user = await userModel.findByEmail(email);
  if (purpose === 'registration') {
    if (user && !user.emailVerified) await issueAndEmail(user.email, user.id, 'registration');
  } else if (user && Number(user.isActive) !== 0 && (!user.status || user.status === 'active')) {
    await issueAndEmail(user.email, user.id, 'password_reset');
  }
  return res.json(generic);
});

// ── Login ─────────────────────────────────────────────────────────────────

const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ success: false, error: 'email and password are required' });
  }

  const row = await userModel.findByEmail(norm(email));
  if (!row || !row.passwordHash) {
    return res.status(401).json({ success: false, error: 'Invalid credentials' });
  }
  const ok = await bcrypt.compare(password, row.passwordHash);
  if (!ok) {
    return res.status(401).json({ success: false, error: 'Invalid credentials' });
  }

  // A deactivated / suspended / archived account keeps all its records but can
  // no longer sign in. Checked after the password so it cannot probe emails.
  if (Number(row.isActive) === 0 || (row.status && row.status !== 'active')) {
    return res.status(403).json({
      success: false,
      error: 'This account has been deactivated. Please contact the ATI administrator.',
    });
  }

  // An unverified email cannot sign in. The password was correct, so the caller
  // already holds the credential — re-issuing a code here reveals nothing new,
  // and lets the UI drop straight into verification.
  if (!row.emailVerified) {
    await issueAndEmail(row.email, row.id, 'registration').catch(() => {});
    return res.status(403).json({
      success: false,
      error: "Your email isn't verified yet. We've sent a verification code — enter it to finish signing up.",
      code: 'EMAIL_UNVERIFIED',
      data: { needsOtp: true, email: row.email, purpose: 'registration' },
    });
  }

  const user = await userModel.findById(row.id);
  const token = signToken(user);
  setAuthCookie(res, token);
  res.json({ success: true, data: { user, token } });
});

// ── Forgot / reset password ──────────────────────────────────────────────────

/** Step 1: request a reset code. Always answers the same, to prevent enumeration. */
const forgotPassword = asyncHandler(async (req, res) => {
  const email = norm(req.body.email);
  const generic = {
    success: true,
    data: { message: 'If an account with that email exists, a verification code has been sent.' },
  };
  if (!email) return res.json(generic);

  const user = await userModel.findByEmail(email);
  // Only active accounts get a reset code; the response is identical regardless.
  // The code is sent TO the account's own registered address (user.email from
  // the database) — never to the system sender — with FROM = SMTP_FROM.
  if (user && Number(user.isActive) !== 0 && (!user.status || user.status === 'active')) {
    await issueAndEmail(user.email, user.id, 'password_reset').catch(() => {});
  }
  return res.json(generic);
});

/** Step 2: verify the reset code → hand back a short-lived token that authorises the reset. */
const verifyResetOtp = asyncHandler(async (req, res) => {
  const email = norm(req.body.email);
  const code = String(req.body.code || '').trim();
  if (!email || !/^\d{6}$/.test(code)) {
    return res.status(400).json({ success: false, error: 'Enter the 6-digit code.' });
  }
  const result = await otpService.verify({ email, purpose: 'password_reset', code });
  if (!result.ok) {
    return res.status(400).json({ success: false, ...otpErrorBody(result) });
  }
  // The OTP is now consumed (verified) and cannot be reused. This token — bound
  // to the email and this purpose, and short-lived — is the only thing that
  // authorises the actual password change.
  const resetToken = jwt.sign({ email, purpose: 'pwreset' }, process.env.JWT_SECRET, { expiresIn: RESET_TOKEN_TTL });
  return res.json({ success: true, data: { resetToken } });
});

/** Step 3: set the new password, authorised by the reset token from step 2. */
const resetPassword = asyncHandler(async (req, res) => {
  const { resetToken, password, confirmPassword } = req.body;
  if (!resetToken) {
    return res.status(400).json({ success: false, error: 'Missing reset authorisation. Please start again.' });
  }
  let payload;
  try {
    payload = jwt.verify(resetToken, process.env.JWT_SECRET);
  } catch {
    return res.status(400).json({ success: false, error: 'Your reset session has expired. Please start again.', code: 'RESET_EXPIRED' });
  }
  if (payload.purpose !== 'pwreset' || !payload.email) {
    return res.status(400).json({ success: false, error: 'Invalid reset authorisation.' });
  }
  if (!password || password !== confirmPassword) {
    return res.status(400).json({ success: false, error: 'Passwords do not match.' });
  }
  if (!isStrongPassword(password)) {
    return res.status(400).json({ success: false, error: PASSWORD_RULES });
  }
  const user = await userModel.findByEmail(norm(payload.email));
  if (!user) {
    return res.status(400).json({ success: false, error: 'Account not found.' });
  }
  await userModel.updatePasswordHash(user.id, await bcrypt.hash(password, 12));
  return res.json({ success: true, data: { message: 'Your password has been updated. Please sign in.' } });
});

module.exports = {
  register,
  verifyRegistrationOtp,
  resendOtp,
  login,
  logout,
  forgotPassword,
  verifyResetOtp,
  resetPassword,
  farmsForRegister,
};
