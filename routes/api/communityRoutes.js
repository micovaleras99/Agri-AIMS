const express = require('express');
const communityApiController = require('../../controllers/communityApiController');
const { tryAuthenticate } = require('../../middleware/auth');

const router = express.Router();

router.get('/channels', communityApiController.listChannels);
router.post('/channels', tryAuthenticate, communityApiController.createChannel);

// Channel routes come before the /messages ones only for readability; Express
// matches on the full path either way.
router.patch('/channels/:slug', tryAuthenticate, communityApiController.updateChannel);
router.delete('/channels/:slug', tryAuthenticate, communityApiController.deleteChannel);

router.get('/channels/:slug/messages', tryAuthenticate, communityApiController.listMessages);
router.post('/channels/:slug/messages', tryAuthenticate, communityApiController.postMessage);

// The author rewrites their own words; the author or an administrator retracts
// them. Both are checked in the controller, which knows who owns the row.
router.patch('/channels/:slug/messages/:id', tryAuthenticate, communityApiController.editMessage);
router.delete('/channels/:slug/messages/:id', tryAuthenticate, communityApiController.deleteMessage);

module.exports = router;
