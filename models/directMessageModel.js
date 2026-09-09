/**
 * Direct (person-to-person) messages.
 *
 * A conversation is just the pair of users, keyed by pair_key so both
 * directions live in one thread. There is deliberately no conversations table:
 * the inbox (latest message + unread count per counterpart) is derived from the
 * messages themselves, which is plenty for the volume a Learning-Site directory
 * generates and one less thing to keep consistent.
 */

const { query, pool } = require('../config/database');
const { rowToCamel } = require('../utils/caseConvert');

/** Stable key for a pair, order-independent, so A→B and B→A share a thread. */
function pairKey(a, b) {
  const x = Number(a);
  const y = Number(b);
  return x < y ? `${x}-${y}` : `${y}-${x}`;
}

function format(row) {
  if (!row) return null;
  const o = rowToCamel(row);
  o.deleted = Boolean(o.deletedAt);
  o.edited = Boolean(o.editedAt) && !o.deleted;
  if (o.deleted) o.body = '';           // a tombstone carries no text
  delete o.deletedAt;
  delete o.editedAt;
  delete o.updatedAt;
  return o;
}

/** Store one message and return it. */
async function send({ senderId, recipientId, body }) {
  const text = String(body || '').trim();
  if (!text) throw new Error('Message body is required.');
  const [res] = await pool.execute(
    'INSERT INTO direct_messages (pair_key, sender_id, recipient_id, body) VALUES (?,?,?,?)',
    [pairKey(senderId, recipientId), Number(senderId), Number(recipientId), text.slice(0, 4000)]
  );
  return findById(res.insertId);
}

async function findById(id) {
  const rows = await query('SELECT * FROM direct_messages WHERE id = ? LIMIT 1', [Number(id)]);
  return format(rows[0]);
}

/**
 * The messages in one conversation, oldest first. `afterId` returns only what
 * is newer, which is how the page polls without re-fetching the whole thread.
 */
async function thread(userA, userB, { afterId, limit = 200 } = {}) {
  const params = [pairKey(userA, userB)];
  let sql = 'SELECT * FROM direct_messages WHERE pair_key = ?';
  if (afterId != null && Number(afterId) > 0) { sql += ' AND id > ?'; params.push(Number(afterId)); }
  sql += ' ORDER BY id ASC LIMIT ?';
  params.push(Math.min(500, Math.max(1, Number(limit) || 200)));
  const rows = await query(sql, params);
  return rows.map(format);
}

/** The raw row for an authorization check — who wrote it, and is it gone. */
async function findOwnerRow(id) {
  const rows = await query(
    'SELECT id, pair_key AS pairKey, sender_id AS senderId, recipient_id AS recipientId, deleted_at AS deletedAt FROM direct_messages WHERE id = ? LIMIT 1',
    [Number(id)]
  );
  return rows[0] || null;
}

/** Replace the text; refuses a deleted message so an edit can't resurrect it. */
async function updateBody(id, body) {
  const [res] = await pool.execute(
    'UPDATE direct_messages SET body = ?, edited_at = NOW(), updated_at = NOW() WHERE id = ? AND deleted_at IS NULL',
    [String(body).slice(0, 4000), Number(id)]
  );
  return res.affectedRows > 0;
}

/** Soft delete — the row stays as a tombstone so the time remains honest. */
async function softDelete(id) {
  const [res] = await pool.execute(
    'UPDATE direct_messages SET deleted_at = NOW(), updated_at = NOW() WHERE id = ? AND deleted_at IS NULL',
    [Number(id)]
  );
  return res.affectedRows > 0;
}

/**
 * Edits and deletions since a moment, so the other party's poll sees a change
 * that happened behind the newest id. `afterId` excludes anything they are
 * already receiving as new, so nothing is sent twice.
 */
async function changedSince(userA, userB, since, { afterId } = {}) {
  const when = since instanceof Date ? new Date(since) : new Date(since);
  if (Number.isNaN(when.getTime())) return [];
  // updated_at is DATETIME (whole-second precision) while `since` carries
  // milliseconds, so a change in the same second as the last poll would compare
  // as older and be missed. A two-second margin closes that gap; re-sending a
  // change the client already has is a no-op, since patch() is idempotent.
  when.setSeconds(when.getSeconds() - 2);
  const params = [pairKey(userA, userB), when];
  let sql = 'SELECT * FROM direct_messages WHERE pair_key = ? AND updated_at > ?';
  if (afterId != null && Number(afterId) > 0) { sql += ' AND id <= ?'; params.push(Number(afterId)); }
  sql += ' ORDER BY id ASC LIMIT 200';
  const rows = await query(sql, params);
  return rows.map(format);
}

/** Mark every message the other person sent to this user as read. */
async function markRead(userId, otherId) {
  const [res] = await pool.execute(
    'UPDATE direct_messages SET read_at = NOW() WHERE recipient_id = ? AND sender_id = ? AND read_at IS NULL',
    [Number(userId), Number(otherId)]
  );
  return res.affectedRows;
}

/** How many unread messages this user has, in total. */
async function unreadTotal(userId) {
  const rows = await query(
    'SELECT COUNT(*) AS n FROM direct_messages WHERE recipient_id = ? AND read_at IS NULL',
    [Number(userId)]
  );
  return rows[0] ? Number(rows[0].n) : 0;
}

/**
 * The inbox: one entry per counterpart, with the last message and how many of
 * theirs are unread. Derived in JS from recent messages — simple, and the
 * volume here does not warrant a windowed SQL query.
 *
 * @returns {Promise<Array<{otherId:number, lastBody:string, lastAt:string, lastFromMe:boolean, unread:number}>>}
 */
async function inbox(userId) {
  const me = Number(userId);
  const rows = await query(
    'SELECT * FROM direct_messages WHERE sender_id = ? OR recipient_id = ? ORDER BY id DESC LIMIT 500',
    [me, me]
  );
  const byOther = new Map();
  for (const r of rows) {
    const otherId = r.sender_id === me ? r.recipient_id : r.sender_id;
    let e = byOther.get(otherId);
    if (!e) {
      // A deleted last message must not leak its old text into the preview —
      // the thread already blanks it, and the sidebar has to match.
      const deleted = r.deleted_at !== null;
      e = { otherId, lastId: r.id, lastBody: deleted ? '' : r.body, lastDeleted: deleted, lastAt: r.created_at, lastFromMe: r.sender_id === me, unread: 0 };
      byOther.set(otherId, e); // rows are newest-first, so the first seen is the latest
    }
    if (r.recipient_id === me && r.read_at === null) e.unread += 1;
  }
  // Newest conversation first.
  return [...byOther.values()].sort((a, b) => b.lastId - a.lastId);
}

module.exports = {
  pairKey, send, findById, thread, markRead, unreadTotal, inbox,
  findOwnerRow, updateBody, softDelete, changedSince,
};
