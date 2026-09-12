/**
 * Farm/Agri-Enterprise Profile (ATI-QF-PAD-48) — the applicant authors the
 * profile on-screen; the system stores it (models/farmProfileModel.js) and fills
 * the official DOCX (services/farmProfileDoc.js). No download / offline editing /
 * re-upload. Mounted under requireAuthPage in app.js.
 */

const express = require('express');
const applicantModel = require('../models/applicantModel');
const farmModel = require('../models/farmModel');
const farmProfileModel = require('../models/farmProfileModel');
const selfAssessmentDoc = require('../services/selfAssessmentDoc');
const farmProfileDoc = require('../services/farmProfileDoc');

const router = express.Router();

async function resolveApplicant(req) {
  const { role, currentUser } = req.res.locals;
  if (role === 'applicant' && currentUser.applicationId) {
    return applicantModel.findByApplicationId(currentUser.applicationId);
  }
  if (role === 'operator' && currentUser.farmId) {
    const id = await farmModel.getApplicantIdForFarm(currentUser.farmId);
    return id ? applicantModel.findById(id) : null;
  }
  if (['admin', 'evaluator'].includes(role) && (req.query.applicant || req.body.applicant)) {
    return applicantModel.findById(parseInt(req.query.applicant || req.body.applicant, 10));
  }
  return null;
}

function rowsOf(field) {
  if (!field) return [];
  return Array.isArray(field) ? field : Object.values(field);
}

async function renderForm(req, res, applicant, extra = {}) {
  const profile = (await farmProfileModel.get(applicant.id)) || {};
  const withAddr = await selfAssessmentDoc.withAddress(applicant);
  res.render('pages/farm-profile', {
    title: `Farm Profile — ${applicant.applicationId}`,
    page: 'applicants',
    applicant,
    profile,
    facilities: farmProfileDoc.FACILITIES,
    missing: farmProfileDoc.missingFor(withAddr, profile).filter((m) => !m.startsWith('Farm Profile content')),
    readonly: !['applicant', 'admin'].includes(res.locals.role),
    saved: false,
    ...extra,
  });
}

// GET /farm-profile?applicant=ID
router.get('/', async (req, res) => {
  const applicant = await resolveApplicant(req).catch(() => null);
  if (!applicant) return res.redirect('/applicants');
  return renderForm(req, res, applicant, { saved: req.query.saved === '1' });
});

// POST /farm-profile — save the authored profile, then (re)generate the form.
router.post('/', async (req, res) => {
  const { role } = res.locals;
  if (!['admin', 'applicant'].includes(role)) return res.redirect('/applicants');
  const applicant = await resolveApplicant(req).catch(() => null);
  if (!applicant) return res.redirect('/applicants');

  const org = req.body.org || {};
  const farm = req.body.farm || {};
  const fac = req.body.fac || {};
  const facilities = {};
  for (const key of Object.keys(farmProfileDoc.FACILITIES)) facilities[key] = fac[key] === 'on';
  const trim = (v) => (v || '').trim();

  const profile = {
    ownerType: trim(req.body.ownerType),
    sex: trim(req.body.sex),
    organization: {
      name: trim(org.name), registeredAddress: trim(org.registeredAddress),
      managerName: trim(org.managerName), managerPosition: trim(org.managerPosition),
      managerEducation: trim(org.managerEducation), managerCellphone: trim(org.managerCellphone),
      managerLandline: trim(org.managerLandline), managerEmail: trim(org.managerEmail),
    },
    farm: {
      yearStartedFarming: trim(farm.yearStartedFarming), yearsFarming: trim(farm.yearsFarming),
      businessPermit: trim(farm.businessPermit), workersMale: trim(farm.workersMale),
      workersFemale: trim(farm.workersFemale), workersTotal: trim(farm.workersTotal),
      organicArea: trim(farm.organicArea), organicYearStarted: trim(farm.organicYearStarted),
      organicYears: trim(farm.organicYears),
    },
    facilities,
    membership: rowsOf(req.body.membership).map((r) => ({
      organization: trim(r.organization), dateJoined: trim(r.dateJoined), position: trim(r.position),
    })),
    trainings: rowsOf(req.body.trainings).map((r) => ({
      title: trim(r.title), dateAttended: trim(r.dateAttended), sponsor: trim(r.sponsor),
    })),
    topics: rowsOf(req.body.topics).map((r) => ({
      topic: trim(r.topic), timesDelivered: trim(r.timesDelivered), audience: trim(r.audience),
    })),
    enterprise: rowsOf(req.body.enterprise).map((r) => ({
      component: trim(r.component), areaDevoted: trim(r.areaDevoted),
      aveProduction: trim(r.aveProduction), aveIncome: trim(r.aveIncome),
    })),
    machinery: rowsOf(req.body.machinery).map((r) => ({ item: trim(r.item), quantity: trim(r.quantity) })),
  };
  await farmProfileModel.save(applicant.id, profile);

  const result = await farmProfileDoc.generate(applicant);
  if (!result.ok) return renderForm(req, res, applicant, { saved: true, missing: result.missing });
  return res.redirect(`/farm-profile?applicant=${applicant.id}&saved=1`);
});

module.exports = router;
