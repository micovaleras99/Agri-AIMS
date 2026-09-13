/**
 * Renewal / re-accreditation — Objective 2.5.
 *
 * Distinct from /lsa2, which is up-scaling LSA I to LSA II. This is the same
 * site keeping the accreditation it already holds when the five years run out.
 *
 * Role split follows Step 7: the operator applies, ATI staff decide. An
 * evaluator may review and reject but only an administrator may approve, which
 * is the same rule the certificate route enforces — the decision that extends a
 * certificate is the administrator's.
 */

const express = require('express');
const farmModel = require('../models/farmModel');
const applicantModel = require('../models/applicantModel');
const renewalModel = require('../models/renewalModel');
const notify = require('../services/notify');
const {
  VALIDITY_YEARS, REMINDER_DAYS, RENEWAL_STATUS_LABELS,
  validityStatus, validUntilFrom,
} = require('../config/renewal');

const router = express.Router();

const STAFF = ['admin'];

function denied(res, message) {
  return res.status(403).render('pages/error', { title: 'Access Denied', code: 403, message });
}

/** Operators see only their own site; staff see every one. */
async function visibleFarms(role, currentUser) {
  const all = await farmModel.findAll();
  if (role === 'operator') return all.filter((f) => f.id === (currentUser.farmId || 0));
  return all;
}

/** May this user submit a renewal for this farm? */
function mayApply(role, currentUser, farm) {
  if (role === 'admin') return true;                       // on the operator's behalf, at the office
  if (role === 'operator') return farm.id === (currentUser.farmId || 0);
  return false;
}

// GET /renewal — validity of every visible site, and any application in flight.
router.get('/', async (req, res) => {
  const { role, currentUser } = res.locals;
  if (role === 'applicant') {
    return denied(res, 'Renewal applies to Learning Sites that are already accredited.');
  }

  const farms = await visibleFarms(role, currentUser);
  const rows = [];
  for (const farm of farms) {
    // The certificate number lives on the originating application; older farms
    // may have none, so it is shown only when present (client §20).
    let certificateNumber = null;
    if (farm.applicantId) {
      const origin = await applicantModel.findById(farm.applicantId);
      certificateNumber = (origin && origin.step7_certificateNo) || null;
    }
    rows.push({
      farm,
      certificateNumber,
      validity: validityStatus(farm.expiryDate),
      open: await renewalModel.findOpenForFarm(farm.id),
      canApply: mayApply(role, currentUser, farm),
    });
  }

  // Soonest to expire first: the list is a work queue, not a directory.
  rows.sort((a, b) => {
    const rank = { expired: 0, expiring: 1, active: 2, unknown: 3 };
    const byState = rank[a.validity.state] - rank[b.validity.state];
    return byState !== 0 ? byState : (a.validity.days ?? 1e9) - (b.validity.days ?? 1e9);
  });

  res.render('pages/renewal', {
    title: 'Renewal & Re-accreditation — Agri-AIMS',
    page: 'renewal',
    rows,
    history: await renewalModel.findAll(role === 'operator' && currentUser.farmId
      ? { farmId: currentUser.farmId } : {}),
    statusLabels: RENEWAL_STATUS_LABELS,
    validityYears: VALIDITY_YEARS,
    reminderDays: REMINDER_DAYS,
    focusFarm: req.query.farm ? Number(req.query.farm) : null,
  });
});

// POST /renewal/:farmId/apply — the operator applies to renew.
router.post('/:farmId/apply', async (req, res) => {
  const { role, currentUser } = res.locals;
  const farm = await farmModel.findById(parseInt(req.params.farmId, 10));
  if (!farm) return res.redirect('/renewal?error=notfound');
  if (!mayApply(role, currentUser, farm)) {
    return denied(res, 'You can only apply to renew your own Learning Site.');
  }

  // One application at a time, or two reviewers decide the same renewal.
  if (await renewalModel.findOpenForFarm(farm.id)) {
    return res.redirect('/renewal?error=already');
  }

  const id = await renewalModel.create({
    farmId: farm.id,
    applicantId: farm.applicantId ?? null,
    submittedBy: currentUser.id,
    previousExpiry: farm.expiryDate || null,
    operatorRemarks: String(req.body.remarks || '').slice(0, 2000),
  });

  await notify.renewalSubmitted(farm, id);
  res.redirect('/renewal?success=applied');
});

// POST /renewal/:id/review — an evaluator picks the application up.
router.post('/:id/review', async (req, res) => {
  const { role, currentUser } = res.locals;
  if (!STAFF.includes(role)) return denied(res, 'Only ATI staff can review renewals.');

  await renewalModel.markUnderReview(parseInt(req.params.id, 10), currentUser.id);
  res.redirect('/renewal?success=review');
});

// POST /renewal/:id/decide — approve (admin only) or reject.
router.post('/:id/decide', async (req, res) => {
  const { role, currentUser } = res.locals;
  if (!STAFF.includes(role)) return denied(res, 'Only ATI staff can decide renewals.');

  const approve = String(req.body.decision || '') === 'approve';
  if (approve && role !== 'admin') {
    return denied(res, 'Only an administrator can approve a renewal, as with the original certificate.');
  }

  const application = await renewalModel.findById(parseInt(req.params.id, 10));
  if (!application) return res.redirect('/renewal?error=notfound');
  if (['approved', 'rejected'].includes(application.status)) {
    return res.redirect('/renewal?error=decided');
  }
  if (!approve && !String(req.body.remarks || '').trim()) {
    return res.redirect('/renewal?error=remarks');
  }

  const outcome = await renewalModel.decide(application.id, {
    approve,
    reviewerId: currentUser.id,
    remarks: String(req.body.remarks || '').slice(0, 2000),
    certificateNo: String(req.body.certificateNo || '').trim() || null,
  });
  if (!outcome) return res.redirect('/renewal?error=notfound');

  const farm = await farmModel.findById(application.farmId);
  if (farm) {
    await notify.renewalDecided(farm, {
      approved: approve,
      newValidUntil: outcome.newValidUntil,
      remarks: req.body.remarks,
    });
  }

  res.redirect('/renewal?success=' + (approve ? 'approved' : 'rejected'));
});

module.exports = router;
module.exports.validUntilFrom = validUntilFrom;
