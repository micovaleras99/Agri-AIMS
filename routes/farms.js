const express = require('express');
const complianceModel = require('../models/complianceModel');
const farmModel = require('../models/farmModel');
const applicantModel = require('../models/applicantModel');
const classifications = require('../config/classifications');
const { safeJson } = require('../utils/safeJson');

const router = express.Router();

router.get('/', async (req, res) => {
  const { role, currentUser } = res.locals;
  const farms = await farmModel.findAll();

  if (role === 'operator') {
    // Without the `|| 1`, an operator with no Learning Site is sent back to
    // their dashboard rather than into somebody else's farm record.
    const myFarm = farms.find((f) => f.id === Number(currentUser.farmId));
    if (myFarm) return res.redirect(`/farms/${myFarm.id}`);
    return res.redirect('/dashboard');
  }

  const { province, classification, search, view } = req.query;
  const filtered = await farmModel.findFiltered({ province, classification, search });

  const provinces = await farmModel.findDistinctProvinces();
  const classifications = await farmModel.findDistinctClassifications();

  const [geoTagged, geoPending] = await Promise.all([
    applicantModel.findGeoTagged(),
    applicantModel.findGeoPendingStatuses(),
  ]);

  res.render('pages/farms', {
    title: 'LSA Farms — Agri-AIMS',
    page: 'farms',
    farms: filtered,
    provinces,
    classifications,
    filters: { province, classification, search, view: view || 'cards' },
    total: farms.length,
    geoTagged,
    geoPending,
    // safeJson, not JSON.stringify: these are inlined into a <script> in the
    // view, and farm names/addresses are user-entered — a bare stringify would
    // let a value containing </script> break out (stored XSS).
    allFarmsJson: safeJson(farms),
    geoTaggedJson: safeJson(geoTagged),
  });
});

router.get('/:id', async (req, res) => {
  const { role, currentUser } = res.locals;
  const farm = await farmModel.findById(parseInt(req.params.id, 10));
  if (!farm) {
    return res.status(404).render('pages/error', {
      title: 'Not Found',
      code: 404,
      message: 'Farm not found.',
    });
  }

  // Check operator access: can only view their own farm
  if (role === 'operator' && farm.id !== Number(currentUser.farmId)) {
    return res.status(403).render('pages/error', {
      title: 'Access Denied',
      code: 403,
      message: 'You can only view your own farm.',
    });
  }

  // Fetch applicant data if farm is linked to an applicant (for geo-tag info)
  let applicant = null;
  if (farm.applicantId) {
    applicant = await applicantModel.findById(farm.applicantId);
  }

  // The page used to draw its compliance panel from the stored score and two
  // hardcoded ticks. It now gets the same summary the compliance screen uses,
  // so the two cannot say different things about the same farm.
  const checklist = await complianceModel.findChecklistForFarm(
    farm.id, classifications.appliesTo(farm.classification)
  );
  const compliance = complianceModel.scoreFor(checklist);
  compliance.assessed = compliance.applicable > 0 && compliance.pending < compliance.applicable;

  res.render('pages/farm-detail', {
    title: `${farm.name} — Agri-AIMS`,
    page: 'farms',
    farm,
    applicant,
    compliance,
  });
});

module.exports = router;
