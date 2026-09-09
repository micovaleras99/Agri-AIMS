const express = require('express');
const authRoutes = require('./authRoutes');
const userRoutes = require('./userRoutes');
const communityRoutes = require('./communityRoutes');
const locationRoutes = require('./locationRoutes');
const notificationRoutes = require('./notificationRoutes');
const chatbotRoutes = require('./chatbotRoutes');
const exportRoutes = require('./exportRoutes');
const messageRoutes = require('./messageRoutes');

const router = express.Router();

router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/community', communityRoutes);
router.use('/locations', locationRoutes);
router.use('/notifications', notificationRoutes);
router.use('/chatbot', chatbotRoutes);
router.use('/export', exportRoutes);
router.use('/messages', messageRoutes);

module.exports = router;
