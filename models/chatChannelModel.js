/**
 * Community chat channels.
 */

const { query, pool } = require('../config/database');
const { rowToCamel } = require('../utils/caseConvert');

const DEFAULT_CHANNELS = [
  [1, '#general', 'general', 'General discussions', 'public'],
  [2, '#region-v-bicol', 'region-v-bicol', 'Bicol Region LSA operators', 'regional'],
  [3, '#organic-farming', 'organic-farming', 'Organic agriculture practices', 'topic'],
  [4, '#technology-sharing', 'technology-sharing', 'Share agricultural technologies', 'topic'],
  [5, '#market-linkages', 'market-linkages', 'Market opportunities and connections', 'topic'],
];

async function ensureSeed() {
  for (const [id, name, slug, description, channelType] of DEFAULT_CHANNELS) {
    await query(
      `INSERT IGNORE INTO chat_channels (id, name, slug, description, channel_type) VALUES (?,?,?,?,?)`,
      [id, name, slug, description, channelType]
    );
  }
}

async function findAll() {
  const rows = await query(
    `SELECT id, name, slug, description, channel_type AS channelType,
            created_by, created_at, updated_at
       FROM chat_channels
      WHERE archived_at IS NULL
      ORDER BY id ASC`
  );
  return rows.map((r) => rowToCamel(r));
}

async function findBySlug(slug) {
  const rows = await query(
    `SELECT id, name, slug, description, channel_type AS channelType
       FROM chat_channels
      WHERE slug = ? AND archived_at IS NULL
      LIMIT 1`,
    [slug]
  );
  if (!rows[0]) return null;
  return rowToCamel(rows[0]);
}

/**
 * A channel name turned into a URL-safe slug.
 *
 * The name is what a person types ("Rice & Corn 2026"); the slug is what the
 * API route has to match against its own [a-z0-9-] pattern, so anything
 * outside that has to go. A name of only punctuation leaves nothing behind,
 * which the caller treats as a rejection rather than inventing a slug.
 */
function slugify(name) {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/**
 * Create a channel.
 *
 * The slug is derived from the name and made unique by suffixing, so two
 * people naming a channel the same thing get two channels rather than an
 * error neither of them can act on.
 *
 * @param {{name: string, description?: string, channelType?: string, createdBy?: number}} data
 * @returns {Promise<object|null>} null when the name yields no usable slug
 */
async function create(data) {
  const name = String(data.name || '').trim().slice(0, 80);
  const base = slugify(name);
  if (!base) return null;

  let slug = base;
  for (let n = 2; await findBySlug(slug); n += 1) {
    if (n > 50) return null; // pathological; give up rather than spin
    slug = `${base}-${n}`.slice(0, 60);
  }

  const displayName = (name.startsWith('#') ? name : `#${name}`).slice(0, 80);
  const description = String(data.description || '').trim().slice(0, 255);
  const channelType = ['public', 'regional', 'topic'].includes(data.channelType)
    ? data.channelType
    : 'topic';

  const [res] = await pool.execute(
    `INSERT INTO chat_channels (name, slug, description, channel_type, created_by)
     VALUES (?,?,?,?,?)`,
    [displayName, slug, description, channelType, data.createdBy ?? null]
  );

  return {
    id: res.insertId,
    name: displayName,
    slug,
    description,
    channelType,
  };
}

/**
 * Rename a channel and change what it is for.
 *
 * The slug is left exactly as it was. It is the address the API routes on, the
 * one ATI_CHANNEL_SLUG and ELEARNING_CHANNEL_SLUG name in .env, and the one
 * every open tab is already holding. Renaming a channel should not break a
 * link, so the label changes and the address does not.
 *
 * @returns {Promise<object|null>} the updated channel, or null if it is gone
 */
async function update(id, data) {
  const sets = [];
  const params = [];

  if (typeof data.name === 'string') {
    const name = data.name.trim().slice(0, 80);
    if (!name) return null;
    sets.push('name = ?');
    params.push((name.charAt(0) === '#' ? name : '#' + name).slice(0, 80));
  }
  if (typeof data.description === 'string') {
    sets.push('description = ?');
    params.push(data.description.trim().slice(0, 255));
  }
  if (!sets.length) return findById(id);

  params.push(id);
  const [res] = await pool.execute(
    `UPDATE chat_channels SET ${sets.join(', ')} WHERE id = ? AND archived_at IS NULL`,
    params
  );
  if (!res.affectedRows) return null;
  return findById(id);
}

async function findById(id) {
  const rows = await query(
    `SELECT id, name, slug, description, channel_type AS channelType
       FROM chat_channels WHERE id = ? AND archived_at IS NULL LIMIT 1`,
    [id]
  );
  return rows[0] ? rowToCamel(rows[0]) : null;
}

/**
 * Take a channel out of use, keeping every message in it.
 *
 * See migration 017: a real DELETE would erase the conversation and, for the
 * five seeded channels, would be undone by ensureSeed on the next page load.
 */
async function archive(id) {
  const [res] = await pool.execute(
    'UPDATE chat_channels SET archived_at = NOW() WHERE id = ? AND archived_at IS NULL',
    [id]
  );
  return res.affectedRows > 0;
}

/** How many messages would go quiet with the channel, for the confirmation. */
async function messageCount(id) {
  const rows = await query('SELECT COUNT(*) AS n FROM chat_messages WHERE channel_id = ?', [id]);
  return Number(rows[0].n) || 0;
}

module.exports = {
  ensureSeed, findAll, findBySlug, findById, create, update, archive, messageCount, slugify,
};
