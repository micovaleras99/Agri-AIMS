/**
 * Direct messaging API (directory "Message"). Same auth and polling shape as the
 * community channels: tryAuthenticate sets req.authUser, the page polls
 * /with/:id?afterId= for what is new, and posting also drops a notification so
 * the recipient sees it in their bell even when the messages page is closed.
 */

const express = require('express');
const { tryAuthenticate } = require('../../middleware/auth');
const dm = require('../../models/directMessageModel');
const userModel = require('../../models/userModel');
const notificationModel = require('../../models/notificationModel');

const router = express.Router();

const MAX_BODY = 4000;

/** A safe, public view of a user for a message header or inbox row. */
function publicProfile(u) {
  if (!u) return null;
  const name = `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email || 'User';
  const initials = name.split(/\s+/).map((n) => n[0]).join('').slice(0, 2).toUpperCase();
  return { id: u.id, name, initials, avatar: u.avatar || initials, role: u.role };
}

function me(req, res) {
  if (!req.authUser) { res.status(401).json({ success: false, error: 'Please sign in.' }); return null; }
  return req.authUser;
}

// GET /api/messages/inbox
router.get('/inbox', tryAuthenticate, async (req, res) => {
  const user = me(req, res); if (!user) return;
  const rows = await dm.inbox(user.id);
  const profiles = await Promise.all(rows.map((r) => userModel.findById(r.otherId)));
  const inbox = rows.map((r, i) => ({ ...r, other: publicProfile(profiles[i]) }))
    .filter((r) => r.other); // drop conversations with a deleted account
  res.json({ success: true, data: { inbox, unread: await dm.unreadTotal(user.id), serverTime: new Date().toISOString() } });
});

// GET /api/messages/with/:userId?afterId=
router.get('/with/:userId', tryAuthenticate, async (req, res) => {
  const user = me(req, res); if (!user) return;
  const otherId = parseInt(req.params.userId, 10);
  if (!Number.isInteger(otherId) || otherId === user.id) {
    return res.status(400).json({ success: false, error: 'Invalid conversation.' });
  }
  const other = await userModel.findById(otherId);
  if (!other) return res.status(404).json({ success: false, error: 'That user no longer exists.' });

  const afterId = req.query.afterId ? parseInt(req.query.afterId, 10) : undefined;
  const messages = await dm.thread(user.id, otherId, { afterId });
  // Second half of the poll: edits and deletions happen behind the newest id,
  // where afterId can never reach them — so the other side sees them too.
  const changed = req.query.since
    ? await dm.changedSince(user.id, otherId, req.query.since, { afterId })
    : [];
  // Opening (or polling) the thread clears the unread flag on their messages.
  await dm.markRead(user.id, otherId);

  const mark = (m) => ({ ...m, mine: m.senderId === user.id });
  res.json({
    success: true,
    data: {
      other: publicProfile(other),
      messages: messages.map(mark),
      changed: changed.map(mark),
      serverTime: new Date().toISOString(),
    },
  });
});

/**
 * Edit and delete are the author's alone. Community lets an admin delete for
 * public moderation, but a direct message is private — an administrator who is
 * not a participant has no business editing or removing it.
 */
async function loadOwn(req, res) {
  const user = me(req, res); if (!user) return null;
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ success: false, error: 'Invalid message id.' }); return null; }
  const row = await dm.findOwnerRow(id);
  if (!row) { res.status(404).json({ success: false, error: 'Message not found.' }); return null; }
  if (row.deletedAt) { res.status(409).json({ success: false, error: 'That message was already deleted.' }); return null; }
  if (row.senderId !== user.id) { res.status(403).json({ success: false, error: 'You can only change your own messages.' }); return null; }
  return { user, id };
}

// PATCH /api/messages/:id  { body }
router.patch('/:id', tryAuthenticate, async (req, res) => {
  const found = await loadOwn(req, res); if (!found) return;
  const body = typeof req.body.body === 'string' ? req.body.body.trim() : '';
  if (!body) return res.status(400).json({ success: false, error: 'An edit cannot be empty. Delete the message instead.' });
  if (body.length > MAX_BODY) return res.status(400).json({ success: false, error: `Message is too long (max ${MAX_BODY}).` });
  if (!(await dm.updateBody(found.id, body))) return res.status(409).json({ success: false, error: 'That message was already deleted.' });
  const m = await dm.findById(found.id);
  res.json({ success: true, data: { ...m, mine: true } });
});

// DELETE /api/messages/:id
router.delete('/:id', tryAuthenticate, async (req, res) => {
  const found = await loadOwn(req, res); if (!found) return;
  if (!(await dm.softDelete(found.id))) return res.status(409).json({ success: false, error: 'That message was already deleted.' });
  const m = await dm.findById(found.id);
  res.json({ success: true, data: { ...m, mine: true } });
});

// POST /api/messages/with/:userId  { body }
router.post('/with/:userId', tryAuthenticate, async (req, res) => {
  const user = me(req, res); if (!user) return;
  const otherId = parseInt(req.params.userId, 10);
  if (!Number.isInteger(otherId) || otherId === user.id) {
    return res.status(400).json({ success: false, error: 'You cannot message yourself.' });
  }
  const other = await userModel.findById(otherId);
  if (!other) return res.status(404).json({ success: false, error: 'That user no longer exists.' });

  const body = typeof req.body.body === 'string' ? req.body.body.trim() : '';
  if (!body) return res.status(400).json({ success: false, error: 'Message body is required.' });
  if (body.length > MAX_BODY) return res.status(400).json({ success: false, error: `Message is too long (max ${MAX_BODY}).` });

  const msg = await dm.send({ senderId: user.id, recipientId: otherId, body });

  // So the recipient hears about it even with the messages page closed.
  const senderName = `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email || 'Someone';
  await notificationModel.create({
    userId: otherId,
    type: 'message',
    title: `New message from ${senderName}`,
    body: body.slice(0, 140),
    link: `/messages?to=${user.id}`,
    icon: 'chat-dots',
  }).catch(() => { /* a message must still succeed if the bell insert fails */ });

  res.status(201).json({ success: true, data: { ...msg, mine: true } });
});

module.exports = router;
