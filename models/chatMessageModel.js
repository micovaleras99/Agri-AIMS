/**
 * Community chat messages.
 */

const { query, pool } = require('../config/database');
const { rowToCamel } = require('../utils/caseConvert');

/** Every read goes through the same column list, so none can drift. */
const COLUMNS = `
  m.id, m.channel_id, m.user_id, m.sender_name, m.sender_avatar, m.body,
  m.created_at, m.edited_at, m.deleted_at, m.updated_at,
  u.photo AS sender_photo
`;

/**
 * The sender's name and initials are snapshotted onto the message, so the chat
 * still reads correctly after an account is removed. The picture is not: it is
 * whatever that account shows today, so changing it updates every message the
 * person has written rather than leaving old ones on an old face.
 */
const FROM = 'chat_messages m LEFT JOIN users u ON u.id = m.user_id';

/**
 * Shape a row for the browser.
 *
 * A deleted message keeps its row and its body in the database — this is an
 * accreditation system and "who said what, and when did they retract it" is
 * worth keeping — but the text never leaves the server again. The client is
 * told only that something was deleted, so it can draw the tombstone.
 */
function formatMessage(row) {
  if (!row) return null;
  const o = rowToCamel(row);
  if (o.createdAt instanceof Date) o.createdAtIso = o.createdAt.toISOString();
  if (o.updatedAt instanceof Date) o.updatedAtIso = o.updatedAt.toISOString();

  o.deleted = Boolean(o.deletedAt);
  o.edited = Boolean(o.editedAt) && !o.deleted;
  if (o.deleted) o.body = '';
  delete o.deletedAt;
  delete o.editedAt;
  return o;
}

/**
 * @param {number} channelId
 * @param {{ afterId?: number, limit?: number }} opts
 */
async function findByChannelId(channelId, opts = {}) {
  const limit = Math.min(200, Math.max(1, opts.limit || 100));
  const params = [channelId];
  let sql = `SELECT ${COLUMNS} FROM ${FROM} WHERE m.channel_id = ?`;
  if (opts.afterId != null && Number(opts.afterId) > 0) {
    sql += ' AND m.id > ? ORDER BY m.id ASC LIMIT ?';
    params.push(opts.afterId, limit);
  } else {
    sql += ' ORDER BY m.id DESC LIMIT ?';
    params.push(limit);
  }
  const rows = await query(sql, params);
  const useAfter = opts.afterId != null && Number(opts.afterId) > 0;
  const ordered = useAfter ? rows : [...rows].reverse();
  return ordered.map(formatMessage);
}

/**
 * Messages in this channel touched since a moment in time.
 *
 * The poll can only ask for messages *after* an id, so an edit or a deletion
 * further up the channel would never reach anyone else's screen. This is the
 * other half of the poll: "and what changed behind me?".
 *
 * `afterId` excludes anything the caller is already about to receive as new,
 * so a message is never sent twice in one response.
 *
 * @param {number} channelId
 * @param {string|Date} since
 * @param {{ afterId?: number, limit?: number }} [opts]
 */
async function findChangedSince(channelId, since, opts = {}) {
  const when = since instanceof Date ? new Date(since) : new Date(since);
  if (Number.isNaN(when.getTime())) return [];
  // updated_at is a whole-second TIMESTAMP while `since` carries milliseconds, so
  // an edit or delete made in the same second as the last poll would compare as
  // older and be missed. A two-second margin closes that gap; re-sending a change
  // the client already applied is a no-op, since patchMessages() is idempotent.
  when.setSeconds(when.getSeconds() - 2);

  const limit = Math.min(200, Math.max(1, opts.limit || 100));
  const params = [channelId, when];
  let sql = `
    SELECT ${COLUMNS} FROM ${FROM}
    WHERE m.channel_id = ? AND m.updated_at > ?
  `;
  if (opts.afterId != null && Number(opts.afterId) > 0) {
    sql += ' AND m.id <= ?';
    params.push(opts.afterId);
  }
  sql += ' ORDER BY m.id ASC LIMIT ?';
  params.push(limit);

  const rows = await query(sql, params);
  return rows.map(formatMessage);
}

async function findById(id) {
  const rows = await query(`SELECT ${COLUMNS} FROM ${FROM} WHERE m.id = ? LIMIT 1`, [id]);
  return formatMessage(rows[0]);
}

/** The raw row, including who wrote it and whether it is already deleted. */
async function findOwnerRow(id) {
  const rows = await query(
    'SELECT id, channel_id, user_id, deleted_at FROM chat_messages WHERE id = ? LIMIT 1',
    [id]
  );
  return rows[0] ? rowToCamel(rows[0]) : null;
}

async function create(data) {
  // A synced announcement can carry the article's own published date, so the chat
  // reads with the real posting time rather than the moment the sync ran. Ordinary
  // messages pass no createdAt and default to NOW().
  const at = data.createdAt instanceof Date && !Number.isNaN(data.createdAt.getTime())
    ? data.createdAt
    : null;

  const cols = ['channel_id', 'user_id', 'sender_name', 'sender_avatar', 'body'];
  const params = [data.channelId, data.userId ?? null, data.senderName, data.senderAvatar || '', data.body];
  if (at) { cols.push('created_at'); params.push(at); }

  const sql = `INSERT INTO chat_messages (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(',')})`;
  const [res] = await pool.execute(sql, params);
  return res.insertId;
}

/**
 * Replace the text of a message. Refuses a deleted one, so an edit cannot
 * quietly resurrect something the author already retracted.
 * @returns {Promise<boolean>} whether a row changed
 */
async function updateBody(id, body) {
  const [res] = await pool.execute(
    'UPDATE chat_messages SET body = ?, edited_at = NOW() WHERE id = ? AND deleted_at IS NULL',
    [body, id]
  );
  return res.affectedRows > 0;
}

/** Soft delete. Already-deleted rows are left alone so the time stays honest. */
async function softDelete(id) {
  const [res] = await pool.execute(
    'UPDATE chat_messages SET deleted_at = NOW() WHERE id = ? AND deleted_at IS NULL',
    [id]
  );
  return res.affectedRows > 0;
}

module.exports = {
  findByChannelId,
  findChangedSince,
  findById,
  findOwnerRow,
  create,
  updateBody,
  softDelete,
};
