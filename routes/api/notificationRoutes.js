const express = require('express');
const notificationController = require('../../controllers/notificationController');
const { authenticateJWT } = require('../../middleware/auth');

const router = express.Router();

// Notifications are personal: a session is always required.
router.use(authenticateJWT);

router.get('/', notificationController.list);
router.get('/unread-count', notificationController.unreadCount);
router.post('/:id/read', notificationController.markRead);
router.post('/read-all', notificationController.markAllRead);

module.exports = router;
