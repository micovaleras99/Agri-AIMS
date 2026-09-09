// ============================================================
// routes/community.js — Community chat (MySQL-backed)
// ============================================================

const express = require('express');
const chatChannelModel = require('../models/chatChannelModel');
const chatMessageModel = require('../models/chatMessageModel');

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    await chatChannelModel.ensureSeed();
    const channels = await chatChannelModel.findAll();
    const first = channels[0];
    let initialMessages = [];
    let initialSlug = first ? first.slug : 'general';
    if (first) {
      initialMessages = await chatMessageModel.findByChannelId(first.id, { limit: 100 });
    }
    res.render('pages/community', {
      title: 'Community Chat — Agri-AIMS',
      page: 'community',
      channels,
      initialSlug,
      initialMessages,
      chatUnavailable: false,
    });
  } catch (err) {
    if (err.code === 'ER_NO_SUCH_TABLE') {
      return res.render('pages/community', {
        title: 'Community Chat — Agri-AIMS',
        page: 'community',
        channels: [],
        initialSlug: 'general',
        initialMessages: [],
        chatUnavailable: true,
      });
    }
    next(err);
  }
});

module.exports = router;
