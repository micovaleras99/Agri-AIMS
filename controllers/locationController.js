/**
 * Read-only reference data for the cascading address selectors.
 * Public: the registration form needs it before anyone has an account.
 */

const locationModel = require('../models/locationModel');
const { asyncHandler } = require('../utils/asyncHandler');

/** Parses a positive integer path/query parameter, or returns null. */
function toId(value) {
  const n = Number.parseInt(String(value), 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

const listRegions = asyncHandler(async (req, res) => {
  const data = await locationModel.findRegions();
  res.json({ success: true, data });
});

const listProvinces = asyncHandler(async (req, res) => {
  const regionId = toId(req.params.regionId);
  if (!regionId) {
    return res.status(400).json({ success: false, error: 'A valid regionId is required' });
  }
  const data = await locationModel.findProvinces(regionId);
  res.json({ success: true, data });
});

const listMunicipalities = asyncHandler(async (req, res) => {
  const provinceId = toId(req.params.provinceId);
  if (!provinceId) {
    return res.status(400).json({ success: false, error: 'A valid provinceId is required' });
  }
  const data = await locationModel.findMunicipalities(provinceId);
  res.json({ success: true, data });
});

const listBarangays = asyncHandler(async (req, res) => {
  const municipalityId = toId(req.params.municipalityId);
  if (!municipalityId) {
    return res.status(400).json({ success: false, error: 'A valid municipalityId is required' });
  }
  const data = await locationModel.findBarangays(municipalityId);
  res.json({ success: true, data });
});

const searchBarangays = asyncHandler(async (req, res) => {
  const term = String(req.query.q || '').trim();
  if (term.length < 2) {
    return res.status(400).json({ success: false, error: 'Search term must be at least 2 characters' });
  }
  const data = await locationModel.searchBarangays(term, req.query.limit);
  res.json({ success: true, data });
});

module.exports = { listRegions, listProvinces, listMunicipalities, listBarangays, searchBarangays };
