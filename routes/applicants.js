// ============================================================
// routes/applicants.js — Applicant CRUD with RBAC (MySQL)
// ============================================================

const express = require('express');
const applicantModel = require('../models/applicantModel');
const documentModel = require('../models/documentModel');
const assessmentModel = require('../models/assessmentModel');
const accountAudit = require('../models/accountAuditModel');
const { FACILITIES, ACCREDITATION_STEPS } = require('../config/accreditationChecklists');
const { checkArea } = require('../config/farmEligibility');
const { isWithinPhilippines } = require('../utils/validation');
const { requirementsFor } = require('../config/documentRequirements');
const locationModel = require('../models/locationModel');
// The one definition of what each accreditation step means for status and
// progress; written by advanceStep() and read here so the two cannot disagree.
const { STEP_PROGRESS, STEP_STATUS } = require('../controllers/accreditationHelpers');

const router = express.Router();

/**
 * Accepts a barangay id from a form only if it refers to a real row; anything
 * else becomes null so a bad value can never be written or break the FK.
 */
/**
 * Turns a stored barangay id back into the four ids the cascading selects
 * need in order to re-select themselves when editing a record.
 */
async function locationSelectionFor(barangayId) {
  if (!barangayId) return null;
  const a = await locationModel.findAncestry(barangayId);
  if (!a) return null;
  return {
    regionId: a.regionId,
    provinceId: a.provinceId,
    municipalityId: a.municipalityId,
    barangayId: a.barangayId,
  };
}

async function resolveBarangayId(raw) {
  const id = Number.parseInt(String(raw ?? ''), 10);
  if (!Number.isInteger(id) || id <= 0) return null;
  return (await locationModel.barangayExists(id)) ? id : null;
}

const statusLabel = {
  submitted: 'Submitted',
  document_review: 'Document Review',
  under_review: 'Under Review',
  approved: 'Approved',
  rejected: 'Rejected',
};

router.get('/', async (req, res) => {
  const { role, currentUser } = res.locals;

  if (role === 'operator') {
    return res.status(403).render('pages/error', {
      title: 'Access Denied',
      code: 403,
      message: 'LSA Operators do not have access to the Applications module. Please use My LSA instead.',
    });
  }

  const { status, province, search, barangayId } = req.query;
  let applicants;

  if (role === 'applicant') {
    applicants = await applicantModel.findFiltered({ applicationId: currentUser.applicationId });
  } else {
    applicants = await applicantModel.findFiltered({ status, province, search, barangayId });
  }

  // An applicant only ever sees their own application, so the province list
  // (distinct provinces of every applicant) and the system-wide count are not
  // theirs to know — scope both to what they can actually see.
  const provinces = role === 'applicant' ? [] : await applicantModel.findDistinctProvinces();
  const total = role === 'applicant' ? applicants.length : await applicantModel.countAll();

  res.render('pages/applicants', {
    title: 'Applications — Agri-AIMS',
    page: 'applicants',
    applicants,
    statusLabel,
    filters: { status, province, search, barangayId },
    provinces,
    total,
  });
});

/**
 * Retired in favour of /admin/farmers/new, which does everything this form did
 * and can also create the farmer's login in the same transaction. Two separate
 * intake forms meant staff had to guess which one to use, and this one was open
 * to `applicant`, so a farmer who already had an application from signing up
 * could create a second, unlinked one for themselves.
 *
 * Kept as a redirect rather than deleted so existing links and bookmarks land
 * somewhere useful. The admin router answers with a clear refusal for non-admins.
 */
router.get('/add', (req, res) => res.redirect('/admin/farmers/new'));
router.post('/add', (req, res) => res.redirect('/admin/farmers/new'));

router.get('/edit/:id', async (req, res) => {
  const { role } = res.locals;
  if (!['admin'].includes(role)) {
    return res.status(403).render('pages/error', {
      title: 'Access Denied',
      code: 403,
      message: 'Only administrators and evaluators can edit applications.',
    });
  }
  const applicant = await applicantModel.findById(parseInt(req.params.id, 10));
  if (!applicant) return res.redirect('/applicants');

  res.render('pages/applicant-form', {
    title: `Edit — ${applicant.firstName} ${applicant.lastName}`,
    page: 'applicants',
    applicant,
    action: `/applicants/edit/${applicant.id}`,
    method: 'POST',
    locationSelection: await locationSelectionFor(applicant.barangayId),
  });
});

router.post('/edit/:id', async (req, res) => {
  const { role } = res.locals;
  if (!['admin'].includes(role)) {
    return res.status(403).render('pages/error', {
      title: 'Access Denied',
      code: 403,
      message: 'Unauthorized.',
    });
  }
  const id = parseInt(req.params.id, 10);
  const existing = await applicantModel.findById(id);
  if (!existing) return res.redirect('/applicants');

  // The barangay decides the place names when one is set — see
  // locationModel.placeNamesFor. Without this the edit form could save a
  // municipality that disagreed with the barangay directly beside it.
  const barangayId = (await resolveBarangayId(req.body.barangayId)) ?? existing.barangayId;
  const place = await locationModel.placeNamesFor(barangayId);

  await applicantModel.update(id, {
    firstName: req.body.firstName || existing.firstName,
    lastName: req.body.lastName || existing.lastName,
    email: req.body.email || existing.email,
    phone: req.body.phone || existing.phone,
    // LSA-10 — captured at registration and then unreachable: the field was on
    // the admin form only, so it could never be corrected or filled in later,
    // and every applicant in the system had it blank.
    rsbsaNumber: req.body.rsbsaNumber !== undefined
      ? String(req.body.rsbsaNumber).trim()
      : existing.rsbsaNumber,
    farmName: req.body.farmName || existing.farmName,
    // parseInt("-5") is truthy, so a negative area sailed through and the
    // minimum-area rule would then report a nonsensical shortfall.
    farmArea: Math.max(0, parseInt(req.body.farmArea, 10) || 0) || existing.farmArea,
    farmAddress: req.body.farmAddress || existing.farmAddress,
    region: place ? place.region : (req.body.region || existing.region),
    province: place ? place.province : (req.body.province || existing.province),
    municipality: place ? place.municipality : (req.body.municipality || existing.municipality),
    barangayId,
    lsaType: req.body.lsaType || existing.lsaType,
    category: req.body.category || existing.category,
    classification: req.body.classification || existing.classification,
    status: req.body.status || existing.status,
    // Category and classification decide which documents are required, so the
    // denominator shown on the progress bar has to move with them.
    totalDocs: requirementsFor({
      category: req.body.category || existing.category,
      classification: req.body.classification || existing.classification,
    }).length,
  });

  res.redirect(`/applicants/${req.params.id}?success=updated`);
});

router.post('/geotag/:id', async (req, res) => {
  const { role, currentUser } = res.locals;
  if (!['admin'].includes(role)) {
    return res.status(403).render('pages/error', {
      title: 'Access Denied',
      code: 403,
      message: 'Only ATI Evaluators (TWG) can record geo-tag coordinates during field validation.',
    });
  }

  const id = parseInt(req.params.id, 10);
  const existing = await applicantModel.findById(id);
  if (!existing) return res.redirect('/applicants');

  const lat = parseFloat(req.body.latitude);
  const lng = parseFloat(req.body.longitude);

  if (!isWithinPhilippines(lat, lng)) {
    return res.redirect(`/applicants/${req.params.id}?geoerror=invalid`);
  }

  const patch = {
    latitude: lat,
    longitude: lng,
    geoTaggedBy: `${currentUser.firstName} ${currentUser.lastName}`,
    geoTaggedDate: new Date().toISOString().split('T')[0],
    geoTagStatus: 'tagged',
  };

  if (existing.accreditationStep < 5) {
    // The status and the progress both come from the step table rather than
    // being written out again here. They agree with it today; the registration
    // default did not, which is how a new applicant showed 20%.
    patch.accreditationStep = 5;
    patch.status = STEP_STATUS[5];
    patch.progress = Math.max(existing.progress, STEP_PROGRESS[5]);
  }

  await applicantModel.patch(id, patch);
  res.redirect(`/applicants/${req.params.id}?geotagged=1`);
});

router.post('/delete/:id', async (req, res) => {
  const { currentUser } = res.locals;
  if (res.locals.role !== 'admin') {
    return res.status(403).render('pages/error', {
      title: 'Access Denied',
      code: 403,
      message: 'Only administrators can delete applications.',
    });
  }
  const id = parseInt(req.params.id, 10);
  // Permanent, and the one place accreditation history is actually destroyed
  // (documents, assessments, development plan, etc. cascade). Record it against
  // the application id first, so the audit trail outlives the record itself —
  // account deactivation is the non-destructive alternative for a lost login.
  const applicant = await applicantModel.findById(id);
  if (applicant) {
    await accountAudit.log({
      applicationId: applicant.applicationId,
      action: 'deleted',
      actorId: currentUser ? currentUser.id : null,
      actorName: currentUser ? `${currentUser.firstName} ${currentUser.lastName}`.trim() : 'admin',
      detail: 'Applicant record and all its documents/assessments permanently deleted.',
    });
  }
  await applicantModel.remove(id);
  res.redirect('/applicants?success=deleted');
});

router.get('/:id', async (req, res) => {
  const { role, currentUser } = res.locals;
  if (role === 'operator') {
    return res.status(403).render('pages/error', {
      title: 'Access Denied',
      code: 403,
      message: 'LSA Operators do not have access to this page.',
    });
  }

  const applicant = await applicantModel.findById(parseInt(req.params.id, 10));
  if (!applicant) {
    return res.status(404).render('pages/error', {
      title: 'Not Found',
      code: 404,
      message: 'Application not found.',
    });
  }

  // The LIST is filtered to the applicant's own application, but this page was
  // not: any signed-in applicant could read any other application by changing
  // the id in the URL — name, email, phone, RSBSA number, farm and documents.
  if (role === 'applicant' && applicant.applicationId !== currentUser.applicationId) {
    return res.status(403).render('pages/error', {
      title: 'Access Denied',
      code: 403,
      message: 'This is not your application. You can only open your own.',
    });
  }

  // Fetch document statistics for this applicant
  const documents = await documentModel.findFiltered({ applicantId: applicant.id });
  const docStats = {
    verified: documents.filter(d => d.status === 'verified').length,
    pending: documents.filter(d => d.status === 'pending_review').length,
    missing: documents.filter(d => d.status === 'missing' || d.status === 'incomplete').length,
  };

  // Single source of truth — this list used to disagree with the routes that
  // implement the steps, showing Document Review before Self-Assessment.
  const accreditationSteps = ACCREDITATION_STEPS;

  // What the applicant claimed in step 2 and what the TWG verified in step 5.
  const selfAssessment = await assessmentModel.findByStep(applicant.id, 2);
  const fieldValidation = await assessmentModel.findByStep(applicant.id, 5);
  const facilityStatus = await assessmentModel.facilityStatus(applicant.id);
  // LSA-08 — the minimum area rule, computed rather than assumed.
  const areaCheck = checkArea(applicant);

  res.render('pages/applicant-detail', {
    title: `${applicant.firstName} ${applicant.lastName} — Agri-AIMS`,
    page: 'applicants',
    applicant,
    docStats,
    accreditationSteps,
    statusLabel,
    selfAssessment,
    fieldValidation,
    facilityStatus,
    facilities: FACILITIES,
    areaCheck,
  });
});

module.exports = router;

