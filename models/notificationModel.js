/**
 * In-app notifications. One row per recipient, so read state is per person.
 */

const { query, pool } = require('../config/database');
const { rowToCamel } = require('../utils/caseConvert');

const SELECT_BASE = `
  SELECT id, user_id, type, title, body, link, icon, read_at, created_at
  FROM notifications
`;

function formatRow(row) {
  if (!row) return null;
  const o = rowToCamel(row);
  o.isRead = o.readAt != null;
  return o;
}

/**
 * @param {number} userId
 * @param {{ limit?: number, unreadOnly?: boolean }} [opts]
 */
async function findForUser(userId, opts = {}) {
  const limit = Math.min(100, Math.max(1, Number(opts.limit) || 20));
  const where = opts.unreadOnly ? 'WHERE user_id = ? AND read_at IS NULL' : 'WHERE user_id = ?';
  const rows = await query(`${SELECT_BASE} ${where} ORDER BY id DESC LIMIT ?`, [userId, limit]);
  return rows.map(formatRow);
}

async function countUnread(userId) {
  const rows = await query(
    'SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND read_at IS NULL',
    [userId]
  );
  return rows[0].c;
}

/** Marks one notification read, but only if it belongs to this user. */
async function markRead(id, userId) {
  const rows = await query(
    'UPDATE notifications SET read_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ? AND read_at IS NULL',
    [id, userId]
  );
  return rows.affectedRows > 0;
}

async function markAllRead(userId) {
  const [res] = await pool.execute(
    'UPDATE notifications SET read_at = CURRENT_TIMESTAMP WHERE user_id = ? AND read_at IS NULL',
    [userId]
  );
  return res.affectedRows;
}

/**
 * @param {{ userId: number, type: string, title: string, body?: string, link?: string, icon?: string }} data
 */
async function create(data) {
  const [res] = await pool.execute(
    'INSERT INTO notifications (user_id, type, title, body, link, icon) VALUES (?,?,?,?,?,?)',
    [data.userId, data.type, data.title, data.body || '', data.link || '', data.icon || 'bell']
  );
  return res.insertId;
}

/**
 * Fan-out helper. Returns how many rows were written.
 * @param {number[]} userIds
 * @param {{ type: string, title: string, body?: string, link?: string, icon?: string }} payload
 */
async function createForUsers(userIds, payload) {
  const ids = [...new Set(userIds.filter((id) => Number.isInteger(Number(id)) && Number(id) > 0))];
  if (!ids.length) return 0;
  const values = ids.map(() => '(?,?,?,?,?,?)').join(',');
  const params = [];
  for (const id of ids) {
    params.push(id, payload.type, payload.title, payload.body || '', payload.link || '', payload.icon || 'bell');
  }
  const [res] = await pool.execute(
    `INSERT INTO notifications (user_id, type, title, body, link, icon) VALUES ${values}`,
    params
  );
  return res.affectedRows;
}

/** Every user holding a role — used for "all evaluators" style announcements. */
async function findUserIdsByRole(roles) {
  const list = Array.isArray(roles) ? roles : [roles];
  if (!list.length) return [];
  const placeholders = list.map(() => '?').join(',');
  const rows = await query(`SELECT id FROM users WHERE role IN (${placeholders})`, list);
  return rows.map((r) => r.id);
}

/** The account linked to an application, so step changes reach the right person. */
async function findUserIdByApplicationId(applicationId) {
  if (!applicationId) return null;
  const rows = await query('SELECT id FROM users WHERE application_id = ? LIMIT 1', [applicationId]);
  return rows[0] ? rows[0].id : null;
}

/**
 * The operator account for a farm. Falls back to the account linked to the
 * farm's original application, since an operator is not always assigned.
 */
async function findUserIdByFarmId(farmId) {
  if (!farmId) return null;
  const direct = await query('SELECT id FROM users WHERE farm_id = ? LIMIT 1', [farmId]);
  if (direct[0]) return direct[0].id;
  const linked = await query(
    'SELECT u.id FROM users u JOIN applicants a ON a.application_id = u.application_id ' +
      'JOIN farms f ON f.applicant_id = a.id WHERE f.id = ? LIMIT 1',
    [farmId]
  );
  return linked[0] ? linked[0].id : null;
}

async function findAllUserIds() {
  const rows = await query('SELECT id FROM users');
  return rows.map((r) => r.id);
}

module.exports = {
  findForUser,
  countUnread,
  markRead,
  markAllRead,
  create,
  createForUsers,
  findUserIdsByRole,
  findUserIdByApplicationId,
  findUserIdByFarmId,
  findAllUserIds,
  formatRow,
};
