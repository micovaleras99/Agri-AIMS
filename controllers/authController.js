/**
 * REST authentication: register, login, logout, public helpers.
 */

const bcrypt = require('bcrypt');
const userModel = require('../models/userModel');
const farmModel = require('../models/farmModel');
const { registerFarmer } = require('../services/farmerRegistration');
const { signToken } = require('../middleware/auth');
const { checkEmail, isStrongPassword, PASSWORD_RULES } = require('../utils/validation');
const { asyncHandler } = require('../utils/asyncHandler');
const { setAuthCookie, clearAuthCookie } = require('../utils/cookies');

const farmsForRegister = asyncHandler(async (req, res) => {
  const farms = await farmModel.findAll();
  const data = farms.map((f) => ({ id: f.id, name: f.name, operator: f.operator, province: f.province }));
  res.json({ success: true, data });
});

const logout = asyncHandler(async (req, res) => {
  clearAuthCookie(res);
  res.json({ success: true, message: 'Logged out' });
});

const register = asyncHandler(async (req, res) => {
  const {
    firstName,
    lastName,
    email,
    password,
    phone,
    region,
    role: rawRole,
    farmId: rawFarmId,
    farmName,
    farmAddress,
    province,
    municipality,
    barangayId,
    // What the applicant knows about their own farm. Without these the record
    // was created as a private farm with no classification and zero area — and
    // totalDocs is computed from category and classification at registration,
    // so an organisation was told to submit the private-farm document list.
    farmArea,
    lsaType,
    category,
    classification,
    rsbsaNumber,
  } = req.body;

  const role = rawRole === 'operator' ? 'operator' : 'applicant';

  if (!firstName || !lastName || !email || !password) {
    return res.status(400).json({
      success: false,
      error: 'firstName, lastName, email, and password are required',
    });
  }
  const emailError = await checkEmail(email);
  if (emailError) {
    return res.status(400).json({ success: false, error: emailError });
  }
  if (!isStrongPassword(password)) {
    return res.status(400).json({ success: false, error: PASSWORD_RULES });
  }

  const emailNorm = email.trim().toLowerCase();
  const taken = await userModel.emailTaken(emailNorm);
  if (taken) {
    return res.status(409).json({ success: false, error: 'Email is already registered' });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const initials = `${String(firstName)[0] || ''}${String(lastName)[0] || ''}`.toUpperCase().slice(0, 2);

  if (role === 'operator') {
    let farmId = rawFarmId != null && rawFarmId !== '' ? parseInt(String(rawFarmId), 10) : null;
    if (farmId != null && Number.isNaN(farmId)) {
      return res.status(400).json({ success: false, error: 'farmId must be a valid number' });
    }
    if (farmId) {
      const farm = await farmModel.findById(farmId);
      if (!farm) {
        return res.status(400).json({ success: false, error: 'The selected LSA farm was not found.' });
      }
    }

    const id = await userModel.createUser({
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: emailNorm,
      passwordHash,
      role: 'operator',
      position: 'LSA Operator',
      office: '',
      region: region || '',
      avatar: initials,
      phone: (phone || '').trim(),
      farmId,
      applicationId: null,
    });

    const user = await userModel.findById(id);
    const token = signToken(user);
    setAuthCookie(res, token);
    return res.status(201).json({
      success: true,
      data: { user, token },
    });
  }

  // Applicant: the application row and the login account are created together,
  // in one transaction, by the shared registration service. A duplicate key
  // escaping from here — an email claimed between the check above and the
  // INSERT, or an application id that lost ID_ATTEMPTS races — is turned into
  // a 409 naming the right field by the error handler.
  const { userId, applicationId } = await registerFarmer({
    firstName,
    lastName,
    email: emailNorm,
    password,
    phone,
    farmName,
    farmAddress,
    region,
    province,
    municipality,
    barangayId,
    farmArea,
    lsaType,
    category,
    classification,
    rsbsaNumber,
    createdByAdmin: false,
  });

  const user = await userModel.findById(userId);
  const token = signToken(user);
  setAuthCookie(res, token);
  return res.status(201).json({
    success: true,
    data: { user, token, applicationId },
  });
});

const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ success: false, error: 'email and password are required' });
  }

  const row = await userModel.findByEmail(email.trim().toLowerCase());
  if (!row || !row.passwordHash) {
    return res.status(401).json({ success: false, error: 'Invalid credentials' });
  }

  const ok = await bcrypt.compare(password, row.passwordHash);
  if (!ok) {
    return res.status(401).json({ success: false, error: 'Invalid credentials' });
  }

  // A deactivated / suspended / archived account keeps all its records but can
  // no longer sign in (req. 4). Checked after the password so it cannot be used
  // to probe which emails exist.
  if (Number(row.isActive) === 0 || (row.status && row.status !== 'active')) {
    return res.status(403).json({
      success: false,
      error: 'This account has been deactivated. Please contact the ATI administrator.',
    });
  }

  const user = await userModel.findById(row.id);
  const token = signToken(user);
  setAuthCookie(res, token);

  res.json({
    success: true,
    data: { user, token },
  });
});

module.exports = { register, login, logout, farmsForRegister };
