/**
 * LSA II up-scaling (PDF p.16, p.21-23).
 *
 * The document packet reuses the existing documents module rather than a second
 * upload path: the LSA II types live in config/lsa2.js and attach to the same
 * applicant record, so uploading, serving and access control stay in one place.
 */

const express = require('express');
const farmModel = require('../models/farmModel');
const lsa2Model = require('../models/lsa2Model');
const documentModel = require('../models/documentModel');
const notify = require('../services/notify');
const { LSA2_STEPS, LSA2_DOCUMENTS } = require('../config/lsa2');
const { hasPrescribedForm } = require('../config/prescribedForms');

/** LSA II forms with a generator (services wired in routes/forms.js GENERATED_DOCS). */
const LSA2_FILLABLE = new Set(['lsa2_checklist', 'lsa2_qualification_form']);

const router = express.Router();

const STAFF = ['admin'];

function denied(res, message) {
  return res.status(403).render('pages/error', { title: 'Access Denied', code: 403, message });
}

/** Farms this user may act on: operators see only their own. */
async function visibleFarms(role, currentUser) {
  const all = await farmModel.findAll();
  if (role === 'operator') return all.filter((f) => f.id === (currentUser.farmId || 0));
  return all;
}

// GET /lsa2 — who is eligible to be up-scaled, and where each application stands.
router.get('/', async (req, res) => {
  const { role, currentUser } = res.locals;
  if (role === 'applicant') {
    return denied(res, 'Up-scaling to LSA II applies to farms already certified as LSA I.');
  }

  const farms = await visibleFarms(role, currentUser);
  const rows = [];
  for (const farm of farms) {
    rows.push({ farm, ...(await lsa2Model.eligibilityFor(farm)) });
  }

  res.render('pages/lsa2', {
    title: 'LSA II Up-scaling — Agri-AIMS',
    page: 'lsa2',
    rows,
    steps: LSA2_STEPS,
    canAssess: STAFF.includes(role),
    query: req.query,
  });
});

// GET /lsa2/farm/:farmId — the criteria, the packet, and the five steps.
router.get('/farm/:farmId', async (req, res) => {
  const { role, currentUser } = res.locals;
  const farm = await farmModel.findById(parseInt(req.params.farmId, 10));
  if (!farm) {
    return res.status(404).render('pages/error', {
      title: 'Not Found', code: 404, message: 'Farm not found.',
    });
  }
  if (role === 'operator' && farm.id !== (currentUser.farmId || 0)) {
    return denied(res, 'You can only view your own farm.');
  }
  if (role === 'applicant') return denied(res, 'Up-scaling applies to certified LSA I farms.');

  const eligibility = await lsa2Model.eligibilityFor(farm);
  const submitted = farm.applicantId ? await documentModel.findByApplicant(farm.applicantId) : [];
  const packet = LSA2_DOCUMENTS.map((d) => ({
    ...d,
    submitted: submitted.find((s) => s.type === d.type) || null,
    hasForm: hasPrescribedForm(d.type, farm),
    // The LSA II forms the system can auto-fill from the applicant's data.
    fillable: LSA2_FILLABLE.has(d.type),
  }));

  res.render('pages/lsa2-farm', {
    title: `LSA II — ${farm.name}`,
    page: 'lsa2',
    farm,
    ...eligibility,
    packet,
    steps: LSA2_STEPS,
    canAssess: STAFF.includes(role),
    query: req.query,
  });
});

// POST /lsa2/farm/:farmId/assess — the two judgements ATI must make (PDF p.16).
router.post('/farm/:farmId/assess', async (req, res) => {
  const { role, currentUser } = res.locals;
  if (!STAFF.includes(role)) return denied(res, 'Only ATI staff can assess up-scaling criteria.');

  const farm = await farmModel.findById(parseInt(req.params.farmId, 10));
  if (!farm) return res.redirect('/lsa2');

  // The application row holds the assessment, so it has to exist first.
  let application = await lsa2Model.findByFarm(farm.id);
  if (!application) {
    await lsa2Model.create({ applicantId: farm.applicantId, farmId: farm.id });
    application = await lsa2Model.findByFarm(farm.id);
  }

  // Unanswered stays NULL — "not assessed" is not the same as "failed".
  const tri = (v) => (v === 'yes' ? true : v === 'no' ? false : null);
  await lsa2Model.recordAssessment(application.id, {
    competenceEnhanced: tri(req.body.competenceEnhanced),
    valueChainCovered: tri(req.body.valueChainCovered),
    remarks: req.body.remarks,
    assessedBy: `${currentUser.firstName} ${currentUser.lastName}`,
  });

  res.redirect(`/lsa2/farm/${farm.id}?assessed=1`);
});

// POST /lsa2/farm/:farmId/apply — start the up-scaling application.
router.post('/farm/:farmId/apply', async (req, res) => {
  const { role, currentUser } = res.locals;
  if (![...STAFF, 'operator'].includes(role)) return denied(res, 'Unauthorized.');

  const farm = await farmModel.findById(parseInt(req.params.farmId, 10));
  if (!farm) return res.redirect('/lsa2');
  if (role === 'operator' && farm.id !== (currentUser.farmId || 0)) {
    return denied(res, 'You can only apply for your own farm.');
  }

  const eligibility = await lsa2Model.eligibilityFor(farm);
  if (!eligibility.eligible) {
    return res.redirect(`/lsa2/farm/${farm.id}?error=ineligible`);
  }
  if (eligibility.application && eligibility.application.status !== 'draft') {
    return res.redirect(`/lsa2/farm/${farm.id}?error=exists`);
  }

  if (!eligibility.application) {
    await lsa2Model.create({ applicantId: farm.applicantId, farmId: farm.id });
  }
  res.redirect(`/lsa2/farm/${farm.id}?applied=1`);
});

// POST /lsa2/farm/:farmId/advance — move through the PDF p.21 procedure.
router.post('/farm/:farmId/advance', async (req, res) => {
  const { role, currentUser } = res.locals;
  if (!STAFF.includes(role)) return denied(res, 'Only ATI staff can move an application forward.');

  const farm = await farmModel.findById(parseInt(req.params.farmId, 10));
  if (!farm) return res.redirect('/lsa2');
  const application = await lsa2Model.findByFarm(farm.id);
  if (!application) return res.redirect(`/lsa2/farm/${farm.id}?error=noapplication`);

  const step = Number.parseInt(req.body.step, 10);
  // Only ever one step forward, so a stale form cannot skip validation.
  if (step !== application.step + 1) {
    return res.redirect(`/lsa2/farm/${farm.id}?error=sequence`);
  }

  const ok = await lsa2Model.advance(application.id, step, {
    by: `${currentUser.firstName} ${currentUser.lastName}`,
    remarks: req.body.remarks,
    certificateNo: req.body.certificateNo,
  });
  if (!ok) return res.redirect(`/lsa2/farm/${farm.id}?error=sequence`);

  await notify.lsa2Advanced(application, farm, step);
  res.redirect(`/lsa2/farm/${farm.id}?advanced=${step}`);
});

module.exports = router;
