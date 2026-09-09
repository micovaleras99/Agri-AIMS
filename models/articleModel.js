/**
 * e-Learning items seen by the sync (RSC-03), and their Community Chat posts.
 */

const { query, pool } = require('../config/database');
const { rowToCamel } = require('../utils/caseConvert');

const SELECT_BASE = `
  SELECT id, source, external_id, title, summary, url, published_at, fetched_at,
         posted_at, chat_channel_id, chat_message_id, notified_count, created_at
  FROM elearning_articles
`;

function formatRow(row) {
  if (!row) return null;
  const o = rowToCamel(row);
  o.isPosted = o.postedAt != null;
  return o;
}

async function findRecent(limit = 30) {
  const rows = await query(
    `${SELECT_BASE} ORDER BY COALESCE(published_at, fetched_at) DESC, id DESC LIMIT ?`,
    [Math.min(100, Math.max(1, Number(limit) || 30))]
  );
  return rows.map(formatRow);
}

async function findById(id) {
  const rows = await query(`${SELECT_BASE} WHERE id = ? LIMIT 1`, [id]);
  return formatRow(rows[0]);
}

async function exists(source, externalId) {
  const rows = await query(
    'SELECT id FROM elearning_articles WHERE source = ? AND external_id = ? LIMIT 1',
    [source, externalId]
  );
  return rows.length > 0;
}

/**
 * Inserts only if this item has not been seen. Returns the new id, or null when
 * it was already there — that null is what prevents duplicate chat posts.
 */
async function insertIfNew(item) {
  const [res] = await pool.execute(
    `INSERT IGNORE INTO elearning_articles (source, external_id, title, summary, url, published_at)
     VALUES (?,?,?,?,?,?)`,
    [
      item.source,
      String(item.externalId),
      String(item.title).slice(0, 500),
      item.summary || null,
      item.url || '',
      item.publishedAt ? new Date(item.publishedAt) : null,
    ]
  );
  return res.affectedRows === 1 ? res.insertId : null;
}

async function markPosted(id, channelId, messageId, notifiedCount) {
  await query(
    `UPDATE elearning_articles
        SET posted_at = CURRENT_TIMESTAMP, chat_channel_id = ?, chat_message_id = ?, notified_count = ?
      WHERE id = ?`,
    [channelId ?? null, messageId ?? null, notifiedCount || 0, id]
  );
}

async function stats() {
  const rows = await query(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN posted_at IS NOT NULL THEN 1 ELSE 0 END) AS posted,
            MAX(fetched_at) AS last_fetch
       FROM elearning_articles`
  );
  const r = rows[0] || {};
  return { total: r.total || 0, posted: r.posted || 0, lastFetch: r.last_fetch || null };
}

module.exports = { findRecent, findById, exists, insertIfNew, markPosted, stats, formatRow };
