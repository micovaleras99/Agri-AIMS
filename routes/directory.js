const express = require('express');
const farmModel = require('../models/farmModel');
const notificationModel = require('../models/notificationModel');

const router = express.Router();

router.get('/', async (req, res) => {
  const farms = await farmModel.findAll();
  const { province, classification, search } = req.query;
  const filtered = await farmModel.findFiltered({ province, classification, search });

  // Resolve the operator's user account per farm so "Message" can open a direct
  // conversation with them. A farm with no linked account simply shows no button.
  const withOperator = await Promise.all(
    filtered.map(async (f) => ({ ...f, operatorUserId: await notificationModel.findUserIdByFarmId(f.id) }))
  );

  const provinces = await farmModel.findDistinctProvinces();
  const classifications = await farmModel.findDistinctClassifications();
  const totalVisitors = farms.reduce((s, f) => s + f.visitorsThisYear, 0);

  res.render('pages/directory', {
    title: 'LSA Directory — Agri-AIMS',
    page: 'directory',
    farms: withOperator,
    allFarms: farms,
    provinces,
    classifications,
    filters: { province, classification, search },
    totalVisitors,
    totalFarms: farms.length,
  });
});

module.exports = router;
