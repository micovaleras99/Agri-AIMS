// ============================================================
// routes/compliance.js — RSC-05: monitoring compliance with the LSA guidelines
//
// Staff record checks against the requirement catalogue; an operator sees the
// findings for their own farm.
// ============================================================

const express = require('express');
const classifications = require('../config/classifications');
const complianceModel = require('../models/complianceModel');
const farmModel = require('../models/farmModel');
const userModel = require('../models/userModel');
const notify = require('../services/notify');

const router = express.Router();

const STAFF = ['admin', 'evaluator'];

function denied(res, message) {
  return res.status(403).render('pages/error', { title: 'Access Denied', code: 403, message });
}

/** An operator may only look at the farm attached to their account. */
function mayViewFarm(role, currentUser, farmId) {
  if (STAFF.includes(role)) return true;
  return role === 'operator' && Number(currentUser.farmId) === Number(farmId);
}

// GET /compliance — overview across farms
router.get('/', async (req, res) => {
  const { role, currentUser } = res.locals;

  if (role === 'operator') {
    const farmId = currentUser.farmId;
    if (!farmId) return denied(res, 'No LSA farm is linked to your account yet.');
    return res.redirect(`/compliance/farm/${farmId}`);
  }
  if (!STAFF.includes(role)) {
    return denied(res, 'Compliance monitoring is available to ATI staff and LSA operators.');
  }

  const summaries = await complianceModel.findFarmSummaries();
  const totals = {
    farms: summaries.length,
    averageScore: summaries.length
      ? Math.round(summaries.reduce((s, f) => s + f.score, 0) / summaries.length)
      : 0,
    findings: summaries.reduce((s, f) => s + f.findings, 0),
    unchecked: summaries.filter((f) => f.lastChecked === null).length,
  };

  res.render('pages/compliance', {
    title: 'Compliance Monitoring — Agri-AIMS',
    page: 'compliance',
    summaries,
    totals,
  });
});

// GET /compliance/farm/:id — the checklist for one farm
router.get('/farm/:id', async (req, res) => {
  const farmId = Number.parseInt(req.params.id, 10);
  const { role, currentUser } = res.locals;

  if (!mayViewFarm(role, currentUser, farmId)) {
    return denied(res, 'You can only view compliance records for your own LSA.');
  }

  const farm = await farmModel.findById(farmId);
  if (!farm) {
    return res.status(404).render('pages/error', { title: 'Not Found', code: 404, message: 'Farm not found.' });
  }

  // The Guidelines separate agri-processing from farming; a word search for
  // "processing" in the classification was standing in for that distinction.
  const appliesTo = classifications.appliesTo(farm.classification);
  const checklist = await complianceModel.findChecklistForFarm(farmId, appliesTo);
  const score = complianceModel.scoreFor(checklist);

  // Group by category so the page reads like the guidelines.
  const categories = [];
  for (const item of checklist) {
    let group = categories.find((c) => c.key === item.category);
    if (!group) {
      group = { key: item.category, label: item.categoryLabel, items: [] };
      categories.push(group);
    }
    group.items.push(item);
  }

  res.render('pages/compliance-farm', {
    title: `Compliance — ${farm.name}`,
    page: 'compliance',
    farm,
    categories,
    score,
    statuses: complianceModel.STATUSES,
    statusLabels: complianceModel.STATUS_LABELS,
    canRecord: STAFF.includes(role),
    query: req.query,
  });
});

// POST /compliance/farm/:id/check — record one check
router.post('/farm/:id/check', async (req, res) => {
  if (!STAFF.includes(res.locals.role)) return denied(res, 'Only ATI staff can record compliance checks.');

  const farmId = Number.parseInt(req.params.id, 10);
  const farm = await farmModel.findById(farmId);
  if (!farm) return res.redirect('/compliance');

  const requirementId = Number.parseInt(req.body.requirementId, 10);
  const requirement = await complianceModel.findRequirementById(requirementId);
  if (!requirement) return res.redirect(`/compliance/farm/${farmId}`);

  await complianceModel.recordCheck({
    requirementId,
    farmId,
    applicantId: farm.applicantId || null,
    status: req.body.status,
    checkedAt: req.body.checkedAt || null,
    checkedBy: res.locals.currentUser.id,
    remarks: req.body.remarks,
    correctiveAction: req.body.correctiveAction,
    nextCheckDate: req.body.nextCheckDate || null,
  });

  // The stored score is a cache of the recorded checks, refreshed here so the
  // Farms list and the farm page can never drift from the assessment the way
  // the seeded value did.
  await complianceModel.recomputeFarmScore(farmId, classifications.appliesTo(farm.classification));

  // A finding is only useful if the operator hears about it.
  if (['non_compliant', 'partial'].includes(req.body.status)) {
    const operator = await userModel.findByFarmId(farmId);
    if (operator) {
      await notify.complianceFinding(operator.id, requirement.title, req.body.correctiveAction, farmId);
    }
  }

  res.redirect(`/compliance/farm/${farmId}?recorded=1`);
});

module.exports = router;
