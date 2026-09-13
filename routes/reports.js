const express = require('express');
const reportModel = require('../models/reportModel');
const farmModel = require('../models/farmModel');
const reportSchedule = require('../services/reportSchedule');
const notify = require('../services/notify');

const router = express.Router();

const STAFF = ['admin'];

function denied(res, message) {
  return res.status(403).render('pages/error', { title: 'Access Denied', code: 403, message });
}

/**
 * The farm an operator may act on.
 *
 * This used to be `currentUser.farmId || 1`, so an operator account with no
 * Learning Site linked read farm 1's reports and filed new ones against farm 1
 * — somebody else's accredited site. No farm means no farm.
 */
function operatorFarmId(currentUser) {
  const id = Number(currentUser && currentUser.farmId);
  return Number.isInteger(id) && id > 0 ? id : null;
}

router.get('/', async (req, res) => {
  const { role, currentUser } = res.locals;

  if (role === 'applicant') {
    return denied(res,
      'Applicants do not have access to monitoring reports. Complete your accreditation first.');
  }

  let filteredReports;
  let myFarm = null;
  let openPeriods = [];

  if (role === 'operator') {
    const farmId = operatorFarmId(currentUser);
    if (!farmId) {
      return denied(res, 'No LSA farm is linked to your account yet. '
        + 'Ask ATI to link your account to your accredited Learning Site.');
    }
    myFarm = await farmModel.findById(farmId);
    filteredReports = await reportModel.findByFarmId(farmId);
    // The periods this farm actually owes — the same calendar the dashboard
    // shows. The form used to offer this year's two semesters to everyone,
    // which a farm accredited part-way through a year does not owe at all.
    openPeriods = reportSchedule.openPeriods(
      reportSchedule.calendarFor(myFarm, filteredReports)
    );
  } else {
    filteredReports = await reportModel.findAll();
  }

  const stats = {
    total: filteredReports.length,
    approved: filteredReports.filter((r) => r.status === 'approved').length,
    pending: filteredReports.filter((r) => r.status === 'pending').length,
    returned: filteredReports.filter((r) => r.status === 'returned').length,
    totalVisitors: filteredReports.reduce((s, r) => s + r.visitors, 0),
    totalTraining: filteredReports.reduce((s, r) => s + r.trainingSessions, 0),
  };

  const provinceMap = await farmModel.countByProvince();

  res.render('pages/reports', {
    title: 'Reports — Agri-AIMS',
    page: 'reports',
    reports: filteredReports,
    stats,
    provinceMap,
    query: req.query,
    farms: role === 'operator' ? [] : await farmModel.findAll(),
    myFarm,
    openPeriods,
    canDecide: STAFF.includes(role),
  });
});

// LSA-18 (PDF p.37, p.40) — operators submit the semestral accomplishment report.
router.post('/', async (req, res) => {
  const { role, currentUser } = res.locals;
  if (!['operator', ...STAFF].includes(role)) {
    return denied(res, 'Only LSA operators and ATI staff can submit monitoring reports.');
  }

  let farmId;
  if (role === 'operator') {
    farmId = operatorFarmId(currentUser);
    if (!farmId) {
      return denied(res, 'No LSA farm is linked to your account yet. '
        + 'Ask ATI to link your account to your accredited Learning Site.');
    }
  } else {
    farmId = Number(req.body.farmId);
  }

  const farm = await farmModel.findById(farmId);
  if (!farm) return res.redirect('/reports?error=farm');

  const period = String(req.body.period || '').trim();
  if (!period) return res.redirect('/reports?error=period');

  // A period the farm does not owe, or has already filed, is refused. Free text
  // used to be accepted: a period outside the accreditation never matched the
  // calendar asking for it, and the same period could be filed repeatedly,
  // inflating the farm's visitor and training counters each time.
  const filed = await reportModel.findByFarmId(farm.id);
  const calendar = reportSchedule.calendarFor(farm, filed);
  if (!reportSchedule.mayFile(calendar, period)) {
    const already = filed.some((r) => r.period === period);
    return res.redirect(`/reports?error=${already ? 'duplicate' : 'period'}`);
  }

  const num = (v) => Math.max(0, Number.parseInt(v, 10) || 0);
  const report = {
    farmId: farm.id,
    farmName: farm.name,
    operator: farm.operator,
    period,
    submissionDate: new Date().toLocaleDateString('en-CA'),
    visitors: num(req.body.visitors),
    trainingSessions: num(req.body.trainingSessions),
    techDemos: num(req.body.techDemos),
  };

  const id = await reportModel.create(report);
  if (!id) return res.redirect('/reports?error=duplicate');

  await notify.reportSubmitted(farm, report);
  res.redirect('/reports?submitted=1');
});

/**
 * POST /reports/:id/review — ATI accepts the report or returns it.
 *
 * Until this route existed a report was created 'pending' and nothing could
 * ever change that, while the page counted approved ones and LSA II up-scaling
 * required them — a criterion no farm could meet.
 */
router.post('/:id/review', async (req, res) => {
  const { role, currentUser } = res.locals;
  if (!STAFF.includes(role)) {
    return denied(res, 'Only ATI staff can decide on a semestral report.');
  }

  const decided = await reportModel.decide(Number(req.params.id), {
    status: req.body.status,
    remarks: req.body.remarks,
    reviewerName: `${currentUser.firstName} ${currentUser.lastName}`.trim(),
  });
  // decide() refuses an unknown status and a return with no reason — an
  // operator told only that their report came back has nothing to act on.
  if (!decided) return res.redirect('/reports?error=review');

  const farm = await farmModel.findById(decided.farmId);
  if (farm) await notify.reportDecided(farm, decided);

  res.redirect(`/reports?reviewed=${decided.status}`);
});

module.exports = router;
