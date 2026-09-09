const express = require('express');
const locationController = require('../../controllers/locationController');

const router = express.Router();

// Public reference data — the registration form needs it before sign-in.
router.get('/regions', locationController.listRegions);
router.get('/regions/:regionId/provinces', locationController.listProvinces);
router.get('/provinces/:provinceId/municipalities', locationController.listMunicipalities);
router.get('/municipalities/:municipalityId/barangays', locationController.listBarangays);
router.get('/barangays/search', locationController.searchBarangays);

module.exports = router;
