/**
 * LSA Development Plan — the applicant authors the plan on-screen; the system
 * stores it (models/developmentPlanModel.js) and fills the official DOCX
 * (services/developmentPlanDoc.js). No download / offline editing / re-upload.
 *
 * Mounted under requireAuthPage in app.js.
 */

const express = require('express');
const applicantModel = require('../models/applicantModel');
const farmModel = require('../models/farmModel');
const developmentPlanModel = require('../models/developmentPlanModel');
const selfAssessmentDoc = require('../services/selfAssessmentDoc');
const developmentPlanDoc = require('../services/developmentPlanDoc');

const router = express.Router();

/** The applicant this request may act on, or null. */
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

/** Normalise a bracket-parsed rows field (object-with-indices or array) to an array. */
function rowsOf(field) {
  if (!field) return [];
  return Array.isArray(field) ? field : Object.values(field);
}

async function renderForm(req, res, applicant, extra = {}) {
  const plan = (await developmentPlanModel.get(applicant.id)) || {};
  const withAddr = await selfAssessmentDoc.withAddress(applicant);
  res.render('pages/development-plan', {
    title: `Development Plan — ${applicant.applicationId}`,
    page: 'applicants',
    applicant,
    plan,
    // Basic Information the form needs but the system does not hold.
    missing: developmentPlanDoc.missingFor(withAddr, plan).filter((m) => m !== 'Development Plan content (fill in the plan first)'),
    readonly: !['applicant', 'admin'].includes(res.locals.role),
    saved: false,
    ...extra,
  });
}

// GET /development-plan?applicant=ID
router.get('/', async (req, res) => {
  const applicant = await resolveApplicant(req).catch(() => null);
  if (!applicant) return res.redirect('/applicants');
  return renderForm(req, res, applicant, { saved: req.query.saved === '1' });
});

// POST /development-plan — save the authored plan, then (re)generate the form.
router.post('/', async (req, res) => {
  const { role } = res.locals;
  if (!['admin', 'applicant'].includes(role)) return res.redirect('/applicants');
  const applicant = await resolveApplicant(req).catch(() => null);
  if (!applicant) return res.redirect('/applicants');

  const plan = {
    dateOfImplementation: (req.body.dateOfImplementation || '').trim(),
    rationale: (req.body.rationale || '').trim(),
    objectives: (req.body.objectives || '').trim(),
    workPlan: rowsOf(req.body.workPlan).map((r) => ({
      component: (r.component || '').trim(),
      timeFrame: (r.timeFrame || '').trim(),
      targetOutput: (r.targetOutput || '').trim(),
      agency: (r.agency || '').trim(),
      budget: (r.budget || '').trim(),
    })),
    budgetRows: rowsOf(req.body.budgetRows).map((r) => ({
      description: (r.description || '').trim(),
      quantity: (r.quantity || '').trim(),
      unitCost: (r.unitCost || '').trim(),
      totalCost: (r.totalCost || '').trim(),
    })),
  };
  await developmentPlanModel.save(applicant.id, plan);

  // Refresh the official document. If Basic Information is missing the plan is
  // still saved; the page shows what to complete before it can be generated.
  const result = await developmentPlanDoc.generate(applicant);
  if (!result.ok) return renderForm(req, res, applicant, { saved: true, missing: result.missing });
  return res.redirect(`/development-plan?applicant=${applicant.id}&saved=1`);
});

module.exports = router;
