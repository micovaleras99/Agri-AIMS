/**
 * REST surface for the notification bell.
 * Every route is scoped to the signed-in user — no cross-user reads.
 */

const notificationModel = require('../models/notificationModel');
const { asyncHandler } = require('../utils/asyncHandler');

const list = asyncHandler(async (req, res) => {
  const unreadOnly = String(req.query.unreadOnly) === 'true';
  const [data, unread] = await Promise.all([
    notificationModel.findForUser(req.authUser.id, { limit: req.query.limit, unreadOnly }),
    notificationModel.countUnread(req.authUser.id),
  ]);
  res.json({ success: true, data, meta: { unread } });
});

const unreadCount = asyncHandler(async (req, res) => {
  const unread = await notificationModel.countUnread(req.authUser.id);
  res.json({ success: true, data: { unread } });
});

const markRead = asyncHandler(async (req, res) => {
  const id = Number.parseInt(String(req.params.id), 10);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ success: false, error: 'A valid notification id is required' });
  }
  const changed = await notificationModel.markRead(id, req.authUser.id);
  const unread = await notificationModel.countUnread(req.authUser.id);
  res.json({ success: true, data: { changed, unread } });
});

const markAllRead = asyncHandler(async (req, res) => {
  const changed = await notificationModel.markAllRead(req.authUser.id);
  res.json({ success: true, data: { changed, unread: 0 } });
});

module.exports = { list, unreadCount, markRead, markAllRead };
