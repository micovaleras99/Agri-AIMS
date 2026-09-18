const { requirementsFor } = require('../config/documentRequirements');
const { progressFor } = require('./accreditationHelpers');
const { hasPrescribedForm } = require('../config/prescribedForms');
const classifications = require('../config/classifications');
/**
 * Dashboard data aggregation (replaces JSON file reads).
 */

const applicantModel = require('../models/applicantModel');
const farmModel = require('../models/farmModel');
const documentModel = require('../models/documentModel');
const reportModel = require('../models/reportModel');
const complianceModel = require('../models/complianceModel');
const reportSchedule = require('../services/reportSchedule');

// Documents ATI produces and files against the application (validation report,
// endorsement, certificate). Both the in-progress applicant and the accredited
// operator need to view/download these; one helper keeps the two dashboards in
// step. Returns only the outputs actually on file, newest step last.
const ATI_OUTPUTS = [
  { type: 'lsa1_field_validation_report', label: 'Field Validation Report', step: 5, icon: 'geo-alt' },
  { type: 'lsa1_rtwg_endorsement', label: 'RTWG Endorsement Letter', step: 6, icon: 'send-check' },
  { type: 'lsa_certificate', label: 'LSA Certificate', step: 7, icon: 'award' },
];
async function atiDocsFor(applicantId) {
  if (!applicantId) return [];
  const docs = await documentModel.findByApplicant(applicantId);
  return ATI_OUTPUTS
    .map((o) => {
      const doc = docs.find((d) => d.type === o.type);
      return doc ? { ...o, id: doc.id, uploadDate: doc.uploadDate } : null;
    })
    .filter(Boolean);
}

async function renderDashboard(req, res) {
  const { role, currentUser } = res.locals;

  const [applicants, farms, documents, reports] = await Promise.all([
    applicantModel.findAll(),
    farmModel.findAll(),
    documentModel.findAll(),
    reportModel.findAll(),
  ]);

  // Progress shown anywhere on the dashboard is the real fraction of steps done,
  // recomputed here so records saved under the old hand-tuned curve are correct
  // too (not just newly-advanced ones).
  for (const a of applicants) a.progress = progressFor(a.accreditationStep, a.status);

  const statusCounts = {
    submitted: applicants.filter((a) => a.status === 'submitted').length,
    document_review: applicants.filter((a) => a.status === 'document_review').length,
    under_review: applicants.filter((a) => a.status === 'under_review').length,
    approved: applicants.filter((a) => a.status === 'approved').length,
    rejected: applicants.filter((a) => a.status === 'rejected').length,
  };

  const recentApplications = [...applicants]
    .sort((a, b) => new Date(b.submissionDate) - new Date(a.submissionDate))
    .slice(0, 5);

  // The administrator manages applications AND evaluates documents / field
  // validation / Steps 4-7 — the former Evaluator role was merged into Admin.
  if (role === 'admin') {
    const stats = {
      totalApplications: applicants.length,
      pendingActions: applicants.filter((a) => ['submitted', 'document_review', 'under_review'].includes(a.status))
        .length,
      approved: applicants.filter((a) => a.status === 'approved').length,
      rejected: applicants.filter((a) => a.status === 'rejected').length,
      activeFarms: farms.length,
      totalDocuments: documents.length,
      pendingDocReview: documents.filter((d) => d.status === 'pending_review').length,
      pendingReports: reports.filter((r) => r.status === 'pending').length,
    };

    const provinceMap = await farmModel.countByProvince();

    // Step 5 field-validation worklist — awaiting a visit (past document review,
    // not yet validated) first, then most recently validated. This was the
    // evaluator dashboard's panel; it now lives on the one Admin dashboard.
    const validationSchedule = applicants
      .filter((a) => a.accreditationStep >= 4 && a.status !== 'rejected')
      .map((a) => {
        const done = Boolean(a.step5ValidationDate);
        return {
          applicationId: a.applicationId,
          farmName: a.farmName,
          location: a.municipality || a.province || '—',
          date: a.step5ValidationDate || null,
          type: a.step5ValidationType || null,
          result: a.step5ValidationResult || null,
          inspectedBy: a.step5InspectedBy || null,
          state: done ? 'validated' : 'awaiting',
        };
      })
      .sort((a, b) => {
        if (a.state !== b.state) return a.state === 'awaiting' ? -1 : 1;
        return String(b.date || '').localeCompare(String(a.date || ''));
      });

    return res.render('pages/dashboard', {
      title: 'Dashboard — Agri-AIMS',
      page: 'dashboard',
      stats,
      statusCounts,
      recentApplications,
      provinceMap,
      pendingDocuments: documents.filter((d) => d.status === 'pending_review').slice(0, 4),
      validationSchedule: validationSchedule.slice(0, 8),
    });
  }

  if (role === 'operator') {
    // `currentUser.farmId || 1` used to stand here, so an operator account with
    // no Learning Site linked was shown farm 1 — somebody else's site, with
    // their reports and their compliance findings — as though it were theirs.
    const myFarm = farms.find((f) => f.id === Number(currentUser.farmId));
    if (!myFarm) {
      return res.status(403).render('pages/error', {
        title: 'No Learning Site',
        code: 403,
        message: 'No LSA farm is linked to your account yet. '
          + 'Ask ATI to link your account to your accredited Learning Site.',
      });
    }
    const myReports = reports.filter((r) => r.farmId === myFarm.id);

    // The accreditation documents ATI issued for this Learning Site, so a
    // newly-promoted operator finds their certificate on the dashboard rather
    // than only under the Documents page.
    const operatorApplicantId = await farmModel.getApplicantIdForFarm(myFarm.id);
    const atiDocs = await atiDocsFor(operatorApplicantId);

    // The five-year reporting calendar. Derived in services/reportSchedule so
    // that this page and the submission form cannot disagree about which
    // periods the farm owes — they did, and nothing the operator could file
    // matched what the calendar was asking for.
    const reportCalendar = reportSchedule.calendarFor(myFarm, myReports);

    // Real compliance, read from recorded checks against the requirement
    // catalogue — see models/complianceModel and scripts/seed-compliance.
    const appliesTo = classifications.appliesTo(myFarm.classification);
    const checklist = await complianceModel.findChecklistForFarm(myFarm.id, appliesTo);
    const complianceScore = complianceModel.scoreFor(checklist);

    const ICONS = {
      facilities: 'building-check',
      operations: 'tree',
      records_reporting: 'file-earmark-check',
      capability: 'mortarboard',
      assistance: 'cash-coin',
    };

    // The dashboard shows the items that need attention first, then the rest.
    const rank = { non_compliant: 0, partial: 1, pending: 2, compliant: 3, not_applicable: 4 };
    const complianceItems = [...checklist]
      .sort((a, b) => (rank[a.status] ?? 9) - (rank[b.status] ?? 9))
      .slice(0, 6)
      .map((c) => ({
        label: c.title,
        desc: c.check && c.check.correctiveAction ? c.check.correctiveAction : c.description,
        icon: ICONS[c.category] || 'shield-check',
        // The five real states, not a three-way collapse.
        //
        // This used to fold 'pending' into 'non-compliant', so a farm accredited
        // yesterday opened its dashboard to a column of red crosses accusing it
        // of failing requirements nobody had checked yet — 'pending' is the
        // catalogue's word for "not yet checked". It also folded
        // 'not_applicable' into 'compliant', claiming compliance with something
        // that does not apply to the farm at all.
        status: c.status,
        statusLabel: c.statusLabel,
        source: c.sourceReference,
      }));

    // Whether anyone has ever checked this farm. A score of 0% means one of two
    // very different things — checked and failing, or never visited — and the
    // gauge cannot tell them apart on its own.
    const complianceAssessed = checklist.some((c) => c.check);
    const compliantCount = complianceScore.compliant;
    const compliancePercent = complianceScore.score;

    // Visitors and training sessions, as reported.
    //
    // This was twelve hard-coded monthly numbers with a token nod to the farm's
    // counter on the last bar, which is why the panel drew a full year of
    // activity beside a "Total: 0" badge. There is no monthly source anywhere
    // in this system: the only visitor and training figures it holds are the
    // ones operators report each semester, in the reports table. So that is
    // what it charts — one bar group per reporting period, oldest first, and
    // nothing at all before the first report is submitted.
    const reported = reportCalendar.filter((r) => r.reportId);
    const activity = {
      labels: reported.map((r) => r.period.replace('Semester ', 'S')),
      visitors: reported.map((r) => Number(r.visitors) || 0),
      trainings: reported.map((r) => Number(r.sessions) || 0),
      totalVisitors: reported.reduce((sum, r) => sum + (Number(r.visitors) || 0), 0),
      totalTrainings: reported.reduce((sum, r) => sum + (Number(r.sessions) || 0), 0),
      periods: reported.length,
      nextDue: (reportCalendar.find((r) => r.status === 'upcoming')
        || reportCalendar.find((r) => r.status === 'overdue') || {}).dueDate || null,
    };

    const responsibilityStatus = [
      { task: 'Submit Semestral Report', due: reportCalendar.find((r) => r.status === 'upcoming')?.dueDate || 'On Track', urgent: false },
      { task: 'Update Operation Records', due: 'Monthly', urgent: false },
      { task: 'Notify ATI on Plan Completion', due: 'As needed', urgent: false },
      {
        task: 'Renewal of Accreditation',
        due: myFarm.expiryDate,
        urgent: Math.ceil((new Date(myFarm.expiryDate) - new Date()) / (1000 * 60 * 60 * 24)) < 180,
      },
    ];

    const stats = {
      visitorsThisYear: myFarm.visitorsThisYear,
      trainingSessions: myFarm.trainingSessions,
      complianceScore: compliancePercent,
      daysToRenewal: Math.ceil((new Date(myFarm.expiryDate) - new Date()) / (1000 * 60 * 60 * 24)),
      compliantItems: compliantCount,
      totalItems: complianceScore.applicable,
      pendingChecks: complianceScore.pending,
      openFindings: complianceScore.findings,
    };

    return res.render('pages/dashboard', {
      title: 'My LSA Dashboard — Agri-AIMS',
      page: 'dashboard',
      stats,
      statusCounts,
      recentApplications,
      myFarm,
      reportCalendar,
      activity,
      complianceItems,
      complianceAssessed,
      compliancePending: complianceScore.pending,
      responsibilityStatus,
      atiDocs,
    });
  }

  // Only ever the applicant's own record — never a fallback to applicants[0],
  // which would show someone else's application to an account whose id didn't
  // resolve.
  const myApp = applicants.find((a) => a.applicationId === currentUser.applicationId);
  if (!myApp) {
    return res.status(404).render('pages/error', {
      title: 'No Application',
      code: 404,
      message: 'No LSA application is linked to your account yet. Please contact the ATI administrator.',
    });
  }

  const lsaSteps = [
    { step: 1, label: 'Briefing', icon: 'book', desc: 'Read and sign the LSA Briefer (ATI-QF-PAD-162)' },
    { step: 2, label: 'Self-Assessment', icon: 'clipboard-check', desc: 'Complete eligibility self-assessment (ATI-QF-PAD-164)' },
    { step: 3, label: 'Submit Documents', icon: 'folder-plus', desc: 'Upload all required documentary requirements' },
    { step: 4, label: 'Document Evaluation', icon: 'search', desc: 'ATI reviews and validates submitted documents' },
    { step: 5, label: 'Field/Virtual Validation', icon: 'geo-alt', desc: 'TWG conducts on-site or virtual farm inspection' },
    { step: 6, label: 'Endorsement to ATI-CO', icon: 'send-check', desc: 'RTC endorses application documents to Central Office' },
    { step: 7, label: 'Certificate & MOA Signing', icon: 'award', desc: 'Certificate of LSA issued and MOA/MOU signed' },
  ];

  const requiredDocuments = requirementsFor(myApp);


  const myDocs = await documentModel.findByApplicant(myApp.id);
  const docChecklist = requiredDocuments.map((required) => {
    const existing = myDocs.find((d) => d.type === required.type);
    const status = existing ? existing.status : 'missing';
    return {
      type: required.type,
      name: required.name,
      form: required.form,
      hasForm: hasPrescribedForm(required.type, myApp),
      status: status === 'incomplete' ? 'missing' : status,
      submitted: Boolean(existing),
      filename: existing?.filename || null,
      uploadDate: existing?.uploadDate || null,
    };
  });

  const docStats = {
    verified: docChecklist.filter((d) => d.status === 'verified').length,
    pending: docChecklist.filter((d) => d.status === 'pending_review').length,
    missing: docChecklist.filter((d) => d.status === 'missing').length,
    total: docChecklist.length,
  };

  // Admin-issued documents (validation report, endorsement, certificate) so the
  // applicant can view/download what ATI finished — the checklist above only
  // lists the applicant's own required uploads.
  const atiDocs = await atiDocsFor(myApp.id);

  return res.render('pages/dashboard', {
    title: 'My Dashboard — Agri-AIMS',
    page: 'dashboard',
    stats: {},
    statusCounts,
    recentApplications,
    myApp,
    lsaSteps,
    docChecklist,
    docStats,
    atiDocs,
  });
}

module.exports = { renderDashboard };
