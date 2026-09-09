const express = require('express');
const dashboardController = require('../controllers/dashboardController');

const router = express.Router();

router.get('/', async (req, res) => {
  await dashboardController.renderDashboard(req, res);
});

module.exports = router;
