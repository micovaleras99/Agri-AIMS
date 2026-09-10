/**
 * REST: community channels + messages.
 */

const chatChannelModel = require('../models/chatChannelModel');
const chatMessageModel = require('../models/chatMessageModel');
const { allSyncSlugs } = require('../services/elearningSync');
const { asyncHandler } = require('../utils/asyncHandler');

/**
 * Channels the article sync posts into — refused for deletion here.
 *
 * Archiving one of these would not break loudly — the next sync would report
 * "chat channel not found" into a log nobody is reading, and new ATI articles
 * would simply stop arriving. Refusing here, with the reason, is far kinder
 * than a feature that quietly stops working. The list comes from the sync itself
 * so the two cannot drift: whatever it targets — including the #general mirror —
 * is what is protected.
 */
function syncChannelSlugs() {
  return allSyncSlugs();
}

const MAX_BODY = 4000;

/** Channel from a :slug param, or the response that explains why not. */
async function resolveChannel(req, res) {
  await chatChannelModel.ensureSeed();
  const slug = String(req.params.slug || '').toLowerCase();
  if (!/^[a-z0-9-]+$/.test(slug)) {
    res.status(400).json({ success: false, error: 'Invalid channel' });
    return null;
  }
  const channel = await chatChannelModel.findBySlug(slug);
  if (!channel) {
    res.status(404).json({ success: false, error: 'Channel not found' });
    return null;
  }
  return channel;
}

function requireLogin(req, res) {
  if (req.authUser) return true;
  res.status(401).json({
    success: false,
    error: 'You must be logged in to post. Use Login on the home page or include your session cookie.',
  });
  return false;
}

const listChannels = asyncHandler(async (req, res) => {
  await chatChannelModel.ensureSeed();
  const channels = await chatChannelModel.findAll();
  res.json({ success: true, data: channels });
});

const listMessages = asyncHandler(async (req, res) => {
  const channel = await resolveChannel(req, res);
  if (!channel) return;

  const afterId = req.query.afterId ? parseInt(req.query.afterId, 10) : undefined;
  const limit = req.query.limit ? parseInt(req.query.limit, 10) : 100;
  const messages = await chatMessageModel.findByChannelId(channel.id, { afterId, limit });

  // Second half of the poll: edits and deletions happen behind the newest id,
  // where `afterId` can never reach them. Without this a correction only ever
  // appeared on the screen of the person who made it.
  const changed = req.query.since
    ? await chatMessageModel.findChangedSince(channel.id, req.query.since, { afterId })
    : [];

  res.json({
    success: true,
    data: { channel, messages, changed, serverTime: new Date().toISOString() },
  });
});

const postMessage = asyncHandler(async (req, res) => {
  if (!requireLogin(req, res)) return;
  const channel = await resolveChannel(req, res);
  if (!channel) return;

  const body = typeof req.body.body === 'string' ? req.body.body.trim() : '';
  if (!body.length) {
    return res.status(400).json({ success: false, error: 'Message body is required' });
  }
  if (body.length > MAX_BODY) {
    return res.status(400).json({ success: false, error: `Message is too long (max ${MAX_BODY} characters)` });
  }

  const senderName = `${req.authUser.firstName} ${req.authUser.lastName}`.trim() || req.authUser.email;
  const senderAvatar = (req.authUser.avatar || '??').slice(0, 8);

  const id = await chatMessageModel.create({
    channelId: channel.id,
    userId: req.authUser.id,
    senderName,
    senderAvatar,
    body,
  });

  res.status(201).json({
    success: true,
    data: {
      id,
      channelId: channel.id,
      userId: req.authUser.id,
      senderName,
      senderAvatar,
      body,
      edited: false,
      deleted: false,
      createdAtIso: new Date().toISOString(),
    },
  });
});

/**
 * Who may change a message.
 *
 * Editing is the author's alone — nobody should be able to put words in
 * someone else's mouth, an administrator least of all. Deleting is the author
 * or an administrator, because moderating the channel is a real duty and the
 * text survives in the database either way.
 */
async function loadForChange(req, res, { allowAdmin }) {
  if (!requireLogin(req, res)) return null;
  const channel = await resolveChannel(req, res);
  if (!channel) return null;

  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ success: false, error: 'Invalid message id' });
    return null;
  }

  const row = await chatMessageModel.findOwnerRow(id);
  if (!row || row.channelId !== channel.id) {
    res.status(404).json({ success: false, error: 'Message not found' });
    return null;
  }
  if (row.deletedAt) {
    res.status(409).json({ success: false, error: 'That message was already deleted' });
    return null;
  }

  const isAuthor = row.userId != null && row.userId === req.authUser.id;
  const isAdmin = req.authUser.role === 'admin';
  if (!isAuthor && !(allowAdmin && isAdmin)) {
    // 403 rather than 404: the message plainly exists, it is simply not theirs.
    res.status(403).json({
      success: false,
      error: allowAdmin
        ? 'You can only delete your own messages.'
        : 'You can only edit your own messages.',
    });
    return null;
  }
  return { id, channel, row };
}

const editMessage = asyncHandler(async (req, res) => {
  const found = await loadForChange(req, res, { allowAdmin: false });
  if (!found) return;

  const body = typeof req.body.body === 'string' ? req.body.body.trim() : '';
  if (!body.length) {
    return res.status(400).json({
      success: false,
      error: 'An edit cannot be empty. Delete the message instead.',
    });
  }
  if (body.length > MAX_BODY) {
    return res.status(400).json({ success: false, error: `Message is too long (max ${MAX_BODY} characters)` });
  }

  const changed = await chatMessageModel.updateBody(found.id, body);
  if (!changed) {
    return res.status(409).json({ success: false, error: 'That message was already deleted' });
  }
  res.json({ success: true, data: await chatMessageModel.findById(found.id) });
});

const deleteMessage = asyncHandler(async (req, res) => {
  const found = await loadForChange(req, res, { allowAdmin: true });
  if (!found) return;

  const removed = await chatMessageModel.softDelete(found.id);
  if (!removed) {
    return res.status(409).json({ success: false, error: 'That message was already deleted' });
  }
  res.json({ success: true, data: await chatMessageModel.findById(found.id) });
});

/** Only an administrator gets past here. */
function requireAdmin(req, res) {
  if (!requireLogin(req, res)) return false;
  if (req.authUser.role !== 'admin') {
    res.status(403).json({ success: false, error: 'Only an administrator can change a channel.' });
    return false;
  }
  return true;
}

/** PATCH /api/community/channels/:slug — rename, or change the description. */
const updateChannel = asyncHandler(async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const channel = await resolveChannel(req, res);
  if (!channel) return;

  const hasName = typeof req.body.name === 'string';
  const hasDesc = typeof req.body.description === 'string';
  if (!hasName && !hasDesc) {
    return res.status(400).json({ success: false, error: 'Nothing to change' });
  }
  if (hasName && !req.body.name.trim()) {
    return res.status(400).json({ success: false, error: 'Channel name is required' });
  }

  const updated = await chatChannelModel.update(channel.id, {
    name: hasName ? req.body.name : undefined,
    description: hasDesc ? req.body.description : undefined,
  });
  if (!updated) {
    return res.status(404).json({ success: false, error: 'Channel not found' });
  }
  res.json({ success: true, data: updated });
});

/** DELETE /api/community/channels/:slug — archive it, keeping the messages. */
const deleteChannel = asyncHandler(async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const channel = await resolveChannel(req, res);
  if (!channel) return;

  if (syncChannelSlugs().includes(channel.slug)) {
    return res.status(409).json({
      success: false,
      error: 'The article sync posts into ' + channel.name +
        '. Point it at another channel in .env before removing this one.',
    });
  }

  const kept = await chatChannelModel.messageCount(channel.id);
  const archived = await chatChannelModel.archive(channel.id);
  if (!archived) {
    return res.status(409).json({ success: false, error: 'That channel is already gone' });
  }
  res.json({
    success: true,
    data: { slug: channel.slug, name: channel.name, messagesKept: kept },
  });
});

/** POST /api/community/channels — administrators only. */
const createChannel = asyncHandler(async (req, res) => {
  if (!requireLogin(req, res)) return;
  if (req.authUser.role !== 'admin') {
    return res.status(403).json({ success: false, error: 'Only an administrator can add a channel.' });
  }

  const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
  if (!name) {
    return res.status(400).json({ success: false, error: 'Channel name is required' });
  }

  const channel = await chatChannelModel.create({
    name,
    description: req.body.description,
    channelType: req.body.channelType,
    createdBy: req.authUser.id,
  });
  if (!channel) {
    return res.status(400).json({
      success: false,
      error: 'That name has no letters or numbers to build an address from. Try something like "Rice Farmers".',
    });
  }

  res.status(201).json({ success: true, data: channel });
});

module.exports = {
  listChannels,
  listMessages,
  postMessage,
  editMessage,
  deleteMessage,
  createChannel,
  updateChannel,
  deleteChannel,
};
