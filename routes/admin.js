// ============================================================
// routes/admin.js — Administrator-only management pages
// Mounted behind requireAuthPage in app.js; role is checked here.
// ============================================================

const express = require('express');
const adminFarmerController = require('../controllers/adminFarmerController');
const elearningController = require('../controllers/elearningController');

const router = express.Router();

/** Only administrators may reach anything in this router. */
router.use((req, res, next) => {
  if (res.locals.role === 'admin') return next();
  return res.status(403).render('pages/error', {
    title: 'Access Denied',
    code: 403,
    message: 'Registering and managing farmer accounts is restricted to ATI administrators.',
  });
});

router.get('/farmers/new', async (req, res) => {
  await adminFarmerController.newFarmerForm(req, res);
});

router.post('/farmers', async (req, res) => {
  await adminFarmerController.createFarmer(req, res);
});

router.get('/elearning', async (req, res) => {
  await elearningController.index(req, res);
});

router.post('/elearning/manual', async (req, res) => {
  await elearningController.createManual(req, res);
});

router.post('/elearning/sync', async (req, res) => {
  await elearningController.runSync(req, res);
});

module.exports = router;
