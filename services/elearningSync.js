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

/** Which channel a run should post into, given the driver that produced it. */
function channelFor(driver) {
  return driver === 'ati_website' ? ATI_CHANNEL_SLUG : CHANNEL_SLUG;
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
  const channel = await chatChannelModel.findBySlug(channelFor(result.driver));
  if (!channel) {
    result.errors.push(`Chat channel "${channelFor(result.driver)}" not found.`);
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
      const messageId = await chatMessageModel.create({
        channelId: channel.id,
        userId: null,
        senderName: article.source === 'ati_website' ? 'ATI Bicol' : 'ATI e-Learning',
        senderAvatar: 'AT',
        body: composeMessage(article),
      });
      result.posted += 1;

      let notified = 0;
      if (recipients.length) {
        notified = await notify.elearningArticle(article, recipients);
        result.notified += notified;
      }
      await articleModel.markPosted(articleId, channel.id, messageId, notified);
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
  // A manually added announcement is an e-learning entry, not ATI website news.
  const channel = await chatChannelModel.findBySlug(CHANNEL_SLUG);
  const article = await articleModel.findById(articleId);

  let messageId = null;
  let notified = 0;
  if (channel) {
    messageId = await chatMessageModel.create({
      channelId: channel.id,
      userId: null,
      senderName: 'ATI e-Learning',
      senderAvatar: 'AT',
      body: composeMessage(article),
    });
    if (notifyMembers) {
      const recipients = await notificationModel.findUserIdsByRole(['operator', 'applicant', 'evaluator', 'admin']);
      notified = await notify.elearningArticle(article, recipients);
    }
    await articleModel.markPosted(articleId, channel.id, messageId, notified);
  }

  return { added: true, articleId, messageId, notified };
}

module.exports = { sync, addManual, composeMessage, CHANNEL_SLUG, ATI_CHANNEL_SLUG, channelFor };
