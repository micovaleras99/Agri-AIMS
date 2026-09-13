/**
 * System users (staff, operators, applicants). Passwords stored as bcrypt hashes only.
 */

const { query, pool } = require('../config/database');
const { rowToCamel } = require('../utils/caseConvert');

const SELECT_SAFE = `
  SELECT id, first_name, last_name, email, role, position, office, region, avatar, photo, phone, farm_id, application_id,
         is_active, status, deleted_at, created_at, updated_at
  FROM users
`;

const SELECT_WITH_HASH = `
  SELECT id, first_name, last_name, email, password_hash, role, position, office, region, avatar, photo, phone, farm_id, application_id,
         is_active, status, deleted_at, created_at, updated_at
  FROM users
`;

function formatPublic(row) {
  if (!row) return null;
  const o = rowToCamel(row);
  if (o.farmId != null) o.farmId = Number(o.farmId);
  if (o.isActive != null) o.isActive = Number(o.isActive) === 1;
  return o;
}

function formatWithHash(row) {
  if (!row) return null;
  return rowToCamel(row);
}

async function findAllPublicProfiles() {
  const rows = await query(`${SELECT_SAFE} ORDER BY id ASC`);
  return rows.map(formatPublic);
}

async function findByEmail(email) {
  const rows = await query(`${SELECT_WITH_HASH} WHERE email = ? LIMIT 1`, [email]);
  return formatWithHash(rows[0]);
}

async function findById(id) {
  const rows = await query(`${SELECT_SAFE} WHERE id = ? LIMIT 1`, [id]);
  return formatPublic(rows[0]);
}

async function findByIdWithHash(id) {
  const rows = await query(`${SELECT_WITH_HASH} WHERE id = ? LIMIT 1`, [id]);
  return formatWithHash(rows[0]);
}

/** The operator account attached to a farm, used when a finding must reach someone. */
async function findByFarmId(farmId) {
  const rows = await query(`${SELECT_SAFE} WHERE farm_id = ? ORDER BY id ASC LIMIT 1`, [farmId]);
  return formatPublic(rows[0]);
}

/** The account behind an application, so certification can promote it. */
async function findByApplicationId(applicationId) {
  const rows = await query(`${SELECT_SAFE} WHERE application_id = ? ORDER BY id ASC LIMIT 1`, [applicationId]);
  return formatPublic(rows[0]);
}

/**
 * The account change that goes with a Certificate of Accreditation: the person
 * stops being an applicant and becomes the operator of a Learning Site.
 *
 * Narrow on purpose. updateUser() rewrites eleven columns from a form, so
 * calling it here would need every other field re-supplied and could undo an
 * edit made in between. This writes only the two columns the certificate
 * decides.
 */
async function promoteToOperator(id, farmId) {
  await query("UPDATE users SET role = 'operator', farm_id = ? WHERE id = ?", [farmId, id]);
}

async function emailTaken(email, excludeId = null) {
  const sql = excludeId ? 'SELECT id FROM users WHERE email = ? AND id <> ? LIMIT 1' : 'SELECT id FROM users WHERE email = ? LIMIT 1';
  const params = excludeId ? [email, excludeId] : [email];
  const rows = await query(sql, params);
  return rows.length > 0;
}

async function createUser(data, opts = {}) {
  const executor = opts.connection || pool;
  const sql = `
    INSERT INTO users (first_name, last_name, email, password_hash, role, position, office, region, avatar, phone, farm_id, application_id, created_by_admin)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
  `;
  const [res] = await executor.execute(sql, [
    data.firstName,
    data.lastName,
    data.email,
    data.passwordHash,
    data.role,
    data.position || '',
    data.office || '',
    data.region || '',
    data.avatar || '',
    data.phone || '',
    data.farmId ?? null,
    data.applicationId ?? null,
    data.createdByAdmin ? 1 : 0,
  ]);
  return res.insertId;
}

async function updateUser(id, data) {
  await query(
    `UPDATE users SET first_name = ?, last_name = ?, email = ?, role = ?, position = ?, office = ?, region = ?, avatar = ?, phone = ?, farm_id = ?, application_id = ?
     WHERE id = ?`,
    [
      data.firstName,
      data.lastName,
      data.email,
      data.role,
      data.position,
      data.office,
      data.region,
      data.avatar,
      data.phone,
      data.farmId ?? null,
      data.applicationId ?? null,
      id,
    ]
  );
}

async function updatePasswordHash(id, passwordHash) {
  await query('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, id]);
}

/**
 * The stored filename of a profile picture, or null to go back to initials.
 * Kept separate from updateUser because it is written by a file upload, not by
 * the account form — so the two cannot clobber each other.
 */
async function updatePhoto(id, storedName) {
  await query('UPDATE users SET photo = ? WHERE id = ?', [storedName || null, id]);
}

/**
 * Soft-delete: the account can no longer log in, but nothing it owns is
 * touched. status is the richer state the admin UI shows; is_active is kept in
 * lock-step so the login gate and older queries agree. deleted_at stamps when.
 * @param {number} id
 * @param {'inactive'|'suspended'|'archived'} [status='inactive']
 */
async function deactivate(id, status = 'inactive') {
  const s = ['inactive', 'suspended', 'archived'].includes(status) ? status : 'inactive';
  await query(
    'UPDATE users SET status = ?, is_active = 0, deleted_at = NOW() WHERE id = ?',
    [s, id]
  );
}

/** Restore a deactivated account so it can log in again. */
async function reactivate(id) {
  await query(
    "UPDATE users SET status = 'active', is_active = 1, deleted_at = NULL WHERE id = ?",
    [id]
  );
}

/**
 * Point this account at an existing applicant record (account recovery, req. 6).
 * The DB's uq_users_active_application key rejects a second ACTIVE account for
 * the same applicant with ER_DUP_ENTRY, which the caller turns into a 409.
 * @param {number} id
 * @param {string|null} applicationId  an existing applicants.application_id, or null to unlink
 */
async function relink(id, applicationId) {
  await query('UPDATE users SET application_id = ? WHERE id = ?', [applicationId ?? null, id]);
}

/** Permanent removal. Reserved for authorised admins; prefer deactivate(). */
async function remove(id) {
  await query('DELETE FROM users WHERE id = ?', [id]);
}

/**
 * Paginated listing for REST API (no password fields).
 * @param {{ page?: number, limit?: number, search?: string, role?: string, sort?: string, order?: string }} opts
 */
async function findPaginated(opts = {}) {
  const page = Math.max(1, parseInt(String(opts.page), 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(String(opts.limit), 10) || 10));
  const offset = (page - 1) * limit;

  const allowedSort = new Set(['id', 'email', 'first_name', 'last_name', 'role', 'created_at']);
  const sortCol = allowedSort.has(opts.sort) ? opts.sort : 'id';
  const orderDir = String(opts.order).toLowerCase() === 'desc' ? 'DESC' : 'ASC';

  const clauses = [];
  const params = [];

  if (opts.role) {
    clauses.push('role = ?');
    params.push(opts.role);
  }
  if (opts.status) {
    clauses.push('status = ?');
    params.push(opts.status);
  }
  if (opts.search) {
    const q = likeTerm(opts.search);
    clauses.push(
      `(CONCAT_WS(' ', first_name, last_name) LIKE ?
        OR first_name LIKE ? OR last_name LIKE ? OR email LIKE ?)`
    );
    params.push(q, q, q, q);
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  const countRows = await query(`SELECT COUNT(*) AS c FROM users ${where}`, params);
  const total = countRows[0].c;

  const listParams = [...params, limit, offset];
  const rows = await query(
    `${SELECT_SAFE} ${where} ORDER BY \`${sortCol}\` ${orderDir} LIMIT ? OFFSET ?`,
    listParams
  );

  return {
    data: rows.map(formatPublic),
    meta: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 },
  };
}

/**
 * Addresses for a set of user ids, for emailing a notification that has just
 * been written. One query rather than one per recipient — a single e-learning
 * article notifies every operator at once.
 *
 * @param {number[]} ids
 * @returns {Promise<Array<{id:number,email:string,firstName:string,lastName:string}>>}
 */
async function emailsByIds(ids) {
  const clean = [...new Set((ids || []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  if (!clean.length) return [];
  // pool.execute does not expand an array into IN (?), so the placeholders are
  // built to match — the values themselves stay parameters.
  const ph = clean.map(() => '?').join(',');
  const [rows] = await pool.query(
    `SELECT id, email, first_name, last_name FROM users WHERE id IN (${ph}) AND email <> ''`,
    clean
  );
  return rows.map((r) => ({
    id: r.id, email: r.email, firstName: r.first_name, lastName: r.last_name,
  }));
}

module.exports = {
  emailsByIds,
  findAllPublicProfiles,
  findByEmail,
  findById,
  findByIdWithHash,
  updatePhoto,
  findByFarmId,
  findByApplicationId,
  promoteToOperator,
  emailTaken,
  createUser,
  updateUser,
  updatePasswordHash,
  deactivate,
  reactivate,
  relink,
  remove,
  findPaginated,
  formatPublic,
};
