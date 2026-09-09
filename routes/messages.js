/**
 * Direct messages page. The shell renders here; conversations and the active
 * thread are loaded and polled from /api/messages (same approach as Community
 * Chat). ?to=<userId> opens that conversation straight away — this is where the
 * directory "Message" button lands.
 */

const express = require('express');
const userModel = require('../models/userModel');

const router = express.Router();

router.get('/', async (req, res) => {
  const { currentUser } = res.locals;
  let openTo = null;

  if (req.query.to) {
    const id = parseInt(req.query.to, 10);
    if (Number.isInteger(id) && id !== Number(currentUser.id)) {
      const u = await userModel.findById(id);
      if (u) {
        const name = `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email || 'User';
        openTo = { id: u.id, name };
      }
    }
  }

  res.render('pages/messages', {
    title: 'Messages — Agri-AIMS',
    page: 'messages',
    currentUserId: Number(currentUser.id) || 0,
    openTo,
  });
});

module.exports = router;
