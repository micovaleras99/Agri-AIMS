/**
 * REST CRUD for /api/users — pagination, search, filter, sort.
 */

const bcrypt = require('bcrypt');
const { removeStored } = require('../config/upload');
const userModel = require('../models/userModel');
const applicantModel = require('../models/applicantModel');
const accountAudit = require('../models/accountAuditModel');
const { checkEmail, isStrongPassword, PASSWORD_RULES } = require('../utils/validation');
const { asyncHandler } = require('../utils/asyncHandler');

/** The signed-in admin's display name, for the audit trail. */
function actorName(u) {
  return `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email || `#${u.id}`;
}

/** The roles that exist. 'evaluator' was merged into 'admin' and removed. */
const VALID_ROLES = new Set(['admin', 'operator', 'applicant']);

const listUsers = asyncHandler(async (req, res) => {
  const { page, limit, search, role, sort, order } = req.query;
  const result = await userModel.findPaginated({
    page: Number(page),
    limit: Number(limit),
    search,
    role,
    sort,
    order,
  });
  res.json({ success: true, ...result });
});

const getUser = asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const user = await userModel.findById(id);
  if (!user) {
    return res.status(404).json({ success: false, error: 'User not found' });
  }
  if (req.authUser.role !== 'admin' && req.authUser.id !== id) {
    return res.status(403).json({ success: false, error: 'Forbidden' });
  }
  res.json({ success: true, data: user });
});

const createUser = asyncHandler(async (req, res) => {
  const {
    firstName, lastName, email, password, role, position, office, region, avatar, phone, farmId, applicationId,
  } = req.body;

  if (!firstName || !lastName || !email || !password || !role) {
    return res.status(400).json({
      success: false,
      error: 'firstName, lastName, email, password, and role are required',
    });
  }
  if (!VALID_ROLES.has(role)) {
    return res.status(400).json({ success: false, error: `role must be one of: ${[...VALID_ROLES].join(', ')}` });
  }
  const emailError = await checkEmail(email);
  if (emailError) {
    return res.status(400).json({ success: false, error: emailError });
  }
  if (!isStrongPassword(password)) {
    return res.status(400).json({ success: false, error: PASSWORD_RULES });
  }

  const taken = await userModel.emailTaken(email.trim().toLowerCase());
  if (taken) {
    return res.status(409).json({ success: false, error: 'Email already in use' });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const initials = `${String(firstName)[0] || ''}${String(lastName)[0] || ''}`.toUpperCase();

  const id = await userModel.createUser({
    firstName: firstName.trim(),
    lastName: lastName.trim(),
    email: email.trim().toLowerCase(),
    passwordHash,
    role,
    position: position || '',
    office: office || '',
    region: region || '',
    avatar: avatar || initials.slice(0, 2),
    phone: phone || '',
    farmId: farmId != null ? Number(farmId) : null,
    applicationId: applicationId || null,
  });

  const user = await userModel.findById(id);
  res.status(201).json({ success: true, data: user });
});

const updateUser = asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const existing = await userModel.findByIdWithHash(id);
  if (!existing) {
    return res.status(404).json({ success: false, error: 'User not found' });
  }

  const isAdmin = req.authUser.role === 'admin';
  const isSelf = req.authUser.id === id;
  if (!isAdmin && !isSelf) {
    return res.status(403).json({ success: false, error: 'Forbidden' });
  }

  const {
    firstName, lastName, email, role, position, office, region, avatar, phone, farmId, applicationId, password,
  } = req.body;

  if (!isAdmin && (role || farmId !== undefined || applicationId !== undefined)) {
    return res.status(403).json({ success: false, error: 'Only administrators may change role or linkage fields' });
  }
  if (role && !VALID_ROLES.has(role)) {
    return res.status(400).json({ success: false, error: `role must be one of: ${[...VALID_ROLES].join(', ')}` });
  }

  const nextEmail = (email || existing.email).trim().toLowerCase();
  // Only a changed address is checked. Re-validating the one already on the
  // record can only ever fail — a resolver that is briefly down, or an
  // institutional domain that stopped resolving — and it would block a save
  // that never touched the email, on a form where the field is prefilled.
  if (nextEmail !== String(existing.email || '').toLowerCase()) {
    const emailError = await checkEmail(nextEmail);
    if (emailError) {
      return res.status(400).json({ success: false, error: emailError });
    }
  }

  const emailTaken = await userModel.emailTaken(nextEmail, id);
  if (emailTaken) {
    return res.status(409).json({ success: false, error: 'Email already in use' });
  }

  // Everything about the password is settled before a single field is written.
  // The previous order saved the profile, then rejected a weak password with a
  // 400 — leaving the caller with a half-applied edit and no way to tell.
  let passwordHash = null;
  if (password) {
    if (!isStrongPassword(password)) {
      return res.status(400).json({ success: false, error: PASSWORD_RULES });
    }
    // Changing your own password means proving you know the current one. An
    // unlocked machine or a borrowed session should not be enough to take an
    // account over. An administrator resetting someone else's password is a
    // different act and is covered by the role check above.
    if (isSelf) {
      const ok = existing.passwordHash
        && await bcrypt.compare(String(req.body.currentPassword || ''), existing.passwordHash);
      if (!ok) {
        return res.status(400).json({ success: false, error: 'Current password is incorrect' });
      }
    }
    passwordHash = await bcrypt.hash(password, 12);
  }

  await userModel.updateUser(id, {
    firstName: (firstName || existing.firstName).trim(),
    lastName: (lastName || existing.lastName).trim(),
    email: nextEmail,
    role: isAdmin ? role || existing.role : existing.role,
    position: position ?? existing.position,
    office: office ?? existing.office,
    region: region ?? existing.region,
    avatar: avatar ?? existing.avatar,
    phone: phone ?? existing.phone,
    farmId: isAdmin ? (farmId != null ? Number(farmId) : existing.farmId) : existing.farmId,
    applicationId: isAdmin ? (applicationId ?? existing.applicationId) : existing.applicationId,
  });

  if (passwordHash) {
    await userModel.updatePasswordHash(id, passwordHash);
  }

  const user = await userModel.findById(id);
  res.json({ success: true, data: user });
});

/** The account lifecycle history for one user (admin only). */
const getUserAudit = asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const existing = await userModel.findById(id);
  const applicationId = existing ? existing.applicationId : '';
  const entries = await accountAudit.listForUser(id, applicationId);
  res.json({ success: true, data: entries });
});

/**
 * Deactivate an account (the default, non-destructive "delete"). The login is
 * disabled and the account is stamped, but the applicant record, applications,
 * documents, assessments, development plans and monitoring history are all
 * preserved — none of them depend on the user row.
 */
const deactivateUser = asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (id === req.authUser.id) {
    return res.status(400).json({ success: false, error: 'You cannot deactivate your own account.' });
  }
  const existing = await userModel.findById(id);
  if (!existing) {
    return res.status(404).json({ success: false, error: 'User not found' });
  }
  const status = ['inactive', 'suspended', 'archived'].includes(req.body.status) ? req.body.status : 'inactive';
  await userModel.deactivate(id, status);
  await accountAudit.log({
    userId: id,
    applicationId: existing.applicationId,
    // 'inactive' is recorded as the generic 'deactivated'; the others by name.
    action: status === 'inactive' ? 'deactivated' : status,
    actorId: req.authUser.id,
    actorName: actorName(req.authUser),
    detail: `Set to ${status}. Applicant records preserved.`,
  });
  res.json({ success: true, data: await userModel.findById(id) });
});

/** Restore a deactivated account. No applicant data is created or duplicated. */
const reactivateUser = asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const existing = await userModel.findById(id);
  if (!existing) {
    return res.status(404).json({ success: false, error: 'User not found' });
  }
  try {
    await userModel.reactivate(id);
  } catch (err) {
    // uq_users_active_application: another active account already holds this
    // applicant, so reactivating this one would create two active logins for it.
    if (err && err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({
        success: false,
        error: 'Another active account is already linked to this applicant. Re-link or deactivate that one first.',
      });
    }
    throw err;
  }
  await accountAudit.log({
    userId: id,
    applicationId: existing.applicationId,
    action: 'reactivated',
    actorId: req.authUser.id,
    actorName: actorName(req.authUser),
  });
  res.json({ success: true, data: await userModel.findById(id) });
});

/**
 * Account recovery (req. 6): attach this login to an existing applicant record
 * by its application id, instead of creating a duplicate applicant. Passing an
 * empty id unlinks the account.
 */
const relinkUser = asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const existing = await userModel.findById(id);
  if (!existing) {
    return res.status(404).json({ success: false, error: 'User not found' });
  }

  const raw = (req.body.applicationId || '').trim();
  let applicationId = null;
  if (raw) {
    const applicant = await applicantModel.findByApplicationId(raw);
    if (!applicant) {
      return res.status(404).json({ success: false, error: `No applicant found with application id ${raw}.` });
    }
    applicationId = applicant.applicationId;
  }

  try {
    await userModel.relink(id, applicationId);
  } catch (err) {
    if (err && err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({
        success: false,
        error: 'That applicant already has an active account. Deactivate it before re-linking.',
      });
    }
    throw err;
  }
  await accountAudit.log({
    userId: id,
    applicationId: applicationId || existing.applicationId,
    action: 'relinked',
    actorId: req.authUser.id,
    actorName: actorName(req.authUser),
    detail: applicationId ? `Linked to ${applicationId}` : 'Unlinked from applicant',
  });
  res.json({ success: true, data: await userModel.findById(id) });
});

/**
 * Permanent deletion. Destroys only the login account (the applicant record and
 * all accreditation history are independent and remain). Guarded by an explicit
 * confirm flag so it can never happen by accident; admin-only at the route.
 */
const deleteUser = asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (id === req.authUser.id) {
    return res.status(400).json({ success: false, error: 'You cannot delete your own account via this endpoint' });
  }
  if (String(req.query.confirm) !== 'permanent') {
    return res.status(400).json({
      success: false,
      error: 'Permanent deletion requires ?confirm=permanent. Deactivate the account instead to preserve access records.',
    });
  }
  const existing = await userModel.findById(id);
  if (!existing) {
    return res.status(404).json({ success: false, error: 'User not found' });
  }
  // Log before the row is gone; the FK on account_audit is SET NULL, so the
  // trail (with application_id) survives the deletion.
  await accountAudit.log({
    userId: id,
    applicationId: existing.applicationId,
    action: 'deleted',
    actorId: req.authUser.id,
    actorName: actorName(req.authUser),
    detail: 'Login account permanently deleted. Applicant records preserved.',
  });
  await userModel.remove(id);
  // The row is gone; without this its picture would sit in uploads/ forever,
  // with nothing left pointing at it.
  removeStored(existing.photo);
  res.status(204).send();
});

module.exports = {
  listUsers,
  getUser,
  createUser,
  updateUser,
  getUserAudit,
  deactivateUser,
  reactivateUser,
  relinkUser,
  deleteUser,
};
