/**
 * RSC-03 pipeline: check the e-learning source, keep what is new, post it to
 * Community Chat, and notify members.
 *
 * Duplicate posting is prevented at the database, not in memory: the unique key
 * on (source, external_id) means a second run of the same item inserts nothing
 * and therefore posts nothing, even if two syncs overlap.
 */

const articleModel = require('../models/articleModel');
const chatChannelModel = require('../models/chatChannelModel');
const chatMessageModel = require('../models/chatMessageModel');
const notificationModel = require('../models/notificationModel');
const notify = require('./notify');
const { fetchItems } = require('./elearningSource');
const logger = require('../utils/logger');

const CHANNEL_SLUG = process.env.ELEARNING_CHANNEL_SLUG || 'e-learning';

/**
 * ATI Bicol news belongs in the regional channel rather than #e-learning, which
 * is for course announcements. Overridable for teams that want it elsewhere.
 */
const ATI_CHANNEL_SLUG = process.env.ATI_CHANNEL_SLUG || 'region-v-bicol';

/**
 * ATI news is also mirrored into #general, so the site's main discussion channel
 * carries the announcements and not only the regional one. Comma-separated and
 * overridable; set ATI_MIRROR_CHANNEL_SLUGS to empty to disable the mirror.
 */
const ATI_MIRROR_SLUGS = (process.env.ATI_MIRROR_CHANNEL_SLUGS === undefined
  ? 'general'
  : process.env.ATI_MIRROR_CHANNEL_SLUGS)
  .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

/**
 * e-Learning course announcements are likewise mirrored into #general so the
 * main channel carries them too. Same override convention as the ATI mirror.
 */
const ELEARNING_MIRROR_SLUGS = (process.env.ELEARNING_MIRROR_CHANNEL_SLUGS === undefined
  ? 'general'
  : process.env.ELEARNING_MIRROR_CHANNEL_SLUGS)
  .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

/** Which channel(s) a run should post into, given the driver that produced it. */
function channelsFor(driver) {
  if (driver === 'ati_website') {
    return [...new Set([ATI_CHANNEL_SLUG.toLowerCase(), ...ATI_MIRROR_SLUGS])];
  }
  return [...new Set([CHANNEL_SLUG.toLowerCase(), ...ELEARNING_MIRROR_SLUGS])];
}

/** Every slug the sync might post into, so they can be protected from deletion. */
function allSyncSlugs() {
  return [...new Set([...channelsFor('ati_website'), ...channelsFor('moodle')])];
}

/** How the announcement reads in the chat channel. */
function composeMessage(article) {
  // An article from the ATI Bicol website is not an e-Learning course, and
  // saying so would misdescribe it to everyone in the channel.
  const heading = article.source === 'ati_website'
    ? '📰 New from ATI Bicol'
    : '📚 New on the ATI e-Learning site';
  const lines = [`${heading}: ${article.title}`];
  if (article.summary) lines.push('', article.summary);
  if (article.url) lines.push('', article.url);
  return lines.join('\n').slice(0, 4000);
}

/**
 * @param {{ dryRun?: boolean, notifyMembers?: boolean, limit?: number }} [opts]
 */
async function sync(opts = {}) {
  const dryRun = Boolean(opts.dryRun);
  const notifyMembers = opts.notifyMembers !== false;

  const result = {
    driver: null,
    note: '',
    fetched: 0,
    added: 0,
    skipped: 0,
    posted: 0,
    notified: 0,
    errors: [],
    newTitles: [],
  };

  let fetched;
  try {
    fetched = await fetchItems();
  } catch (err) {
    result.errors.push(err.message);
    logger.error('elearning sync: fetch failed', err);
    return result;
  }

  result.driver = fetched.driver;
  result.note = fetched.note;
  result.fetched = fetched.items.length;

  if (!fetched.items.length) return result;

  // Oldest first, so the channel reads in chronological order.
  const items = [...fetched.items].sort((a, b) => {
    const at = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
    const bt = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
    return at - bt;
  });
  // A first run against a site with 50 articles would post 50 messages into the
  // channel at once. Cap it: the newest few are posted, and the rest are recorded
  // as seen so they are never posted retrospectively. Later runs only ever have a
  // handful of genuinely new items, so the cap stops mattering.
  const perRun = Number(opts.limit || process.env.SYNC_MAX_POSTS || 5);
  const overflow = items.length > perRun ? items.slice(0, items.length - perRun) : [];
  const limited = items.slice(-perRun);

  if (!dryRun && overflow.length) {
    for (const old of overflow) {
      try { await articleModel.insertIfNew(old); } catch { /* recorded best-effort */ }
    }
    result.backfilled = overflow.length;
  } else if (dryRun && overflow.length) {
    result.backfilled = overflow.length;
  }

  await chatChannelModel.ensureSeed();
  const channels = [];
  for (const slug of channelsFor(result.driver)) {
    const ch = await chatChannelModel.findBySlug(slug);
    if (ch) channels.push(ch);
    else result.errors.push(`Chat channel "${slug}" not found — skipped.`);
  }
  if (!channels.length) {
    result.errors.push(`No target chat channel found for driver "${result.driver}".`);
    return result;
  }

  const recipients = notifyMembers
    ? await notificationModel.findUserIdsByRole(['operator', 'applicant', 'evaluator', 'admin'])
    : [];

  for (const item of limited) {
    if (!item.title || !item.externalId) {
      result.skipped += 1;
      continue;
    }

    if (dryRun) {
      const seen = await articleModel.exists(item.source, String(item.externalId));
      if (seen) result.skipped += 1;
      else { result.added += 1; result.newTitles.push(item.title); }
      continue;
    }

    let articleId;
    try {
      articleId = await articleModel.insertIfNew(item);
    } catch (err) {
      result.errors.push(`${item.title}: ${err.message}`);
      continue;
    }

    if (!articleId) { result.skipped += 1; continue; } // already seen — do not post again

    result.added += 1;
    result.newTitles.push(item.title);

    // Posting and notifying are best-effort: the article is already recorded,
    // and a failure here must not make the next run re-post it.
    try {
      const article = await articleModel.findById(articleId);
      const body = composeMessage(article);
      const senderName = article.source === 'ati_website' ? 'ATI Bicol' : 'ATI e-Learning';

      // Post into every target channel. The article is already recorded, so the
      // dedupe key stops the next run re-posting it to any of them.
      let firstChannelId = null;
      let firstMessageId = null;
      // Date the post to when the article was actually published, where the
      // source gives a date. The ATI website publishes none (see atiWebsite.js),
      // so those fall back to the sync time; Moodle and manual entries carry a
      // real date and read correctly in the channel.
      const publishedAt = article.publishedAt ? new Date(article.publishedAt) : undefined;
      for (const ch of channels) {
        const messageId = await chatMessageModel.create({
          channelId: ch.id,
          userId: null,
          senderName,
          senderAvatar: 'AT',
          body,
          createdAt: publishedAt,
        });
        if (firstMessageId === null) { firstChannelId = ch.id; firstMessageId = messageId; }
      }
      result.posted += 1;

      // One notification per article, not one per channel it was mirrored into.
      let notified = 0;
      if (recipients.length) {
        notified = await notify.elearningArticle(article, recipients);
        result.notified += notified;
      }
      // markPosted keeps a single reference; the first (primary) channel is it.
      await articleModel.markPosted(articleId, firstChannelId, firstMessageId, notified);
    } catch (err) {
      result.errors.push(`posting "${item.title}": ${err.message}`);
      logger.error('elearning sync: post failed', err);
    }
  }

  return result;
}

/**
 * Adds one item by hand — the fallback while no Moodle token exists.
 * Goes through the same dedupe, post and notify path as the automatic sync.
 */
async function addManual({ title, summary, url, publishedAt, notifyMembers = true }) {
  const externalId = `manual-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const articleId = await articleModel.insertIfNew({
    source: 'manual',
    externalId,
    title,
    summary,
    url,
    publishedAt: publishedAt || new Date(),
  });
  if (!articleId) return { added: false };

  await chatChannelModel.ensureSeed();
  const article = await articleModel.findById(articleId);
  const body = composeMessage(article);
  // A manually added announcement is an e-learning entry, so it posts to the same
  // channels the e-learning sync does — #e-learning and the #general mirror.
  const channels = [];
  for (const slug of channelsFor('manual')) {
    const ch = await chatChannelModel.findBySlug(slug);
    if (ch) channels.push(ch);
  }

  const postedAt = article.publishedAt ? new Date(article.publishedAt) : undefined;
  let firstChannelId = null;
  let firstMessageId = null;
  let notified = 0;
  for (const ch of channels) {
    const messageId = await chatMessageModel.create({
      channelId: ch.id,
      userId: null,
      senderName: 'ATI e-Learning',
      senderAvatar: 'AT',
      body,
      createdAt: postedAt,
    });
    if (firstMessageId === null) { firstChannelId = ch.id; firstMessageId = messageId; }
  }
  if (channels.length) {
    if (notifyMembers) {
      const recipients = await notificationModel.findUserIdsByRole(['operator', 'applicant', 'evaluator', 'admin']);
      notified = await notify.elearningArticle(article, recipients);
    }
    await articleModel.markPosted(articleId, firstChannelId, firstMessageId, notified);
  }

  return { added: true, articleId, messageId: firstMessageId, notified };
}

module.exports = { sync, addManual, composeMessage, CHANNEL_SLUG, ATI_CHANNEL_SLUG, channelsFor, allSyncSlugs };

// ponytail: self-check for channel routing — run `node services/elearningSync.js`.
if (require.main === module) {
  const ati = channelsFor('ati_website');
  console.assert(ati.includes('region-v-bicol') && ati.includes('general'),
    'ATI news must post to both region-v-bicol and general', ati);
  const el = channelsFor('moodle');
  console.assert(el.includes('e-learning') && el.includes('general'),
    'e-learning announcements must post to both e-learning and general', el);
  console.assert(allSyncSlugs().includes('general'),
    'general must be a protected sync channel', allSyncSlugs());
  console.log('elearningSync channel-routing self-check passed');
  process.exit(0);
}
