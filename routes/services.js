// ============================================================
// routes/services.js — RSC-04: extension services offered to members
//
// Admin and evaluator staff create and manage services and record who took
// part; operators and applicants browse them and apply.
// ============================================================

const express = require('express');
const serviceModel = require('../models/serviceModel');
const applicantModel = require('../models/applicantModel');
const locationModel = require('../models/locationModel');
const notificationModel = require('../models/notificationModel');
const notify = require('../services/notify');

const router = express.Router();

const STAFF = ['admin'];

function denied(res, message) {
  return res.status(403).render('pages/error', { title: 'Access Denied', code: 403, message });
}

/** Untrusted barangay id from a form; null unless it resolves. */
async function resolveBarangayId(raw) {
  const id = Number.parseInt(String(raw ?? ''), 10);
  if (!Number.isInteger(id) || id <= 0) return null;
  return (await locationModel.barangayExists(id)) ? id : null;
}

async function locationSelectionFor(barangayId) {
  if (!barangayId) return null;
  const a = await locationModel.findAncestry(barangayId);
  if (!a) return null;
  return { regionId: a.regionId, provinceId: a.provinceId, municipalityId: a.municipalityId, barangayId: a.barangayId };
}

/** The application row behind the signed-in user, when there is one. */
async function applicantIdFor(currentUser) {
  if (!currentUser || !currentUser.applicationId) return null;
  const row = await applicantModel.findByApplicationId(currentUser.applicationId);
  return row ? row.id : null;
}

// GET /services — the catalogue
router.get('/', async (req, res) => {
  const { role, currentUser } = res.locals;
  const { serviceType, status, search } = req.query;

  // Members (applicants, operators) only see services they can still join;
  // ended ones — completed, cancelled, or past their date — drop off for them.
  // Managing staff keep the full list, including history.
  const memberView = !STAFF.includes(role);
  const services = await serviceModel.findFiltered({
    serviceType, status, search, hideEnded: memberView,
  });
  const stats = await serviceModel.stats(memberView);
  const myParticipation = await serviceModel.findParticipationForUser(currentUser.id);
  const joinedIds = new Set(myParticipation.map((p) => p.serviceId));

  res.render('pages/services', {
    title: 'Services — Agri-AIMS',
    page: 'services',
    services,
    stats,
    myParticipation,
    joinedIds,
    filters: { serviceType, status, search },
    typeLabels: serviceModel.SERVICE_TYPE_LABELS,
    serviceTypes: serviceModel.SERVICE_TYPES,
    statuses: serviceModel.STATUSES,
    canManage: STAFF.includes(role),
  });
});

// GET /services/new — staff only
router.get('/new', async (req, res) => {
  if (!STAFF.includes(res.locals.role)) return denied(res, 'Only ATI staff can add services.');
  res.render('pages/service-form', {
    title: 'New Service — Agri-AIMS',
    page: 'services',
    service: null,
    action: '/services/new',
    locationSelection: null,
    typeLabels: serviceModel.SERVICE_TYPE_LABELS,
    serviceTypes: serviceModel.SERVICE_TYPES,
    statuses: serviceModel.STATUSES,
    error: null,
  });
});

router.post('/new', async (req, res) => {
  if (!STAFF.includes(res.locals.role)) return denied(res, 'Only ATI staff can add services.');
  const b = req.body;
  if (!String(b.name || '').trim()) {
    return res.status(400).render('pages/service-form', {
      title: 'New Service — Agri-AIMS',
      page: 'services',
      service: b,
      action: '/services/new',
      locationSelection: await locationSelectionFor(await resolveBarangayId(b.barangayId)),
      typeLabels: serviceModel.SERVICE_TYPE_LABELS,
      serviceTypes: serviceModel.SERVICE_TYPES,
      statuses: serviceModel.STATUSES,
      error: 'A service name is required.',
    });
  }

  const id = await serviceModel.create({
    serviceType: b.serviceType,
    name: String(b.name).trim(),
    description: b.description,
    provider: b.provider,
    targetBeneficiaries: b.targetBeneficiaries,
    eligibility: b.eligibility,
    venue: b.venue,
    barangayId: await resolveBarangayId(b.barangayId),
    scheduleStart: b.scheduleStart || null,
    scheduleEnd: b.scheduleEnd || null,
    slots: b.slots ? Number.parseInt(String(b.slots), 10) || null : null,
    status: b.status,
    remarks: b.remarks,
    createdBy: res.locals.currentUser.id,
  });

  // Announcing is opt-in, so a draft can be prepared without alerting anyone.
  if (b.announce === 'on') {
    const service = await serviceModel.findById(id);
    const recipients = await notificationModel.findUserIdsByRole(['operator', 'applicant']);
    await notify.serviceAnnounced(service, recipients);
  }

  res.redirect(`/services/${id}?created=1`);
});

// GET /services/:id
router.get('/:id', async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  const service = await serviceModel.findById(id);
  if (!service) {
    return res.status(404).render('pages/error', { title: 'Not Found', code: 404, message: 'Service not found.' });
  }

  const { role, currentUser } = res.locals;
  const canManage = STAFF.includes(role);
  // Staff manage the service; members take part in it. Nobody does both.
  const canEnrol = !canManage;
  const participants = canManage ? await serviceModel.findParticipants(id) : [];
  const mine = (await serviceModel.findParticipationForUser(currentUser.id)).find((p) => p.serviceId === id) || null;

  res.render('pages/service-detail', {
    title: `${service.name} — Agri-AIMS`,
    page: 'services',
    service,
    participants,
    mine,
    canManage,
    canEnrol,
    participantStatuses: serviceModel.PARTICIPANT_STATUSES,
    query: req.query,
  });
});

// POST /services/:id/edit — staff only
router.post('/:id/edit', async (req, res) => {
  if (!STAFF.includes(res.locals.role)) return denied(res, 'Only ATI staff can edit services.');
  const id = Number.parseInt(req.params.id, 10);
  const existing = await serviceModel.findById(id);
  if (!existing) return res.redirect('/services');

  const b = req.body;
  await serviceModel.update(id, {
    serviceType: b.serviceType || existing.serviceType,
    name: String(b.name || existing.name).trim(),
    description: b.description,
    provider: b.provider,
    targetBeneficiaries: b.targetBeneficiaries,
    eligibility: b.eligibility,
    venue: b.venue,
    barangayId: await resolveBarangayId(b.barangayId),
    scheduleStart: b.scheduleStart || null,
    scheduleEnd: b.scheduleEnd || null,
    slots: b.slots ? Number.parseInt(String(b.slots), 10) || null : null,
    status: b.status || existing.status,
    remarks: b.remarks,
  });
  res.redirect(`/services/${id}?updated=1`);
});

// GET /services/:id/edit
router.get('/:id/edit', async (req, res) => {
  if (!STAFF.includes(res.locals.role)) return denied(res, 'Only ATI staff can edit services.');
  const service = await serviceModel.findById(Number.parseInt(req.params.id, 10));
  if (!service) return res.redirect('/services');

  res.render('pages/service-form', {
    title: `Edit ${service.name} — Agri-AIMS`,
    page: 'services',
    service,
    action: `/services/${service.id}/edit`,
    locationSelection: await locationSelectionFor(service.barangayId),
    typeLabels: serviceModel.SERVICE_TYPE_LABELS,
    serviceTypes: serviceModel.SERVICE_TYPES,
    statuses: serviceModel.STATUSES,
    error: null,
  });
});

// POST /services/:id/apply — a member signs up
router.post('/:id/apply', async (req, res) => {
  // ATI staff deliver these services; they are not beneficiaries of them.
  // Everything else on this page already draws that line — STAFF gates creating
  // and editing a service, and participation outcomes are recorded through
  // /participants/:pid, which is staff-only. Enrolment was the one path with no
  // check on either the route or the button, so an evaluator could sign up for
  // a training they are meant to be running.
  if (STAFF.includes(res.locals.role)) {
    return denied(res, 'ATI staff deliver services rather than enrol in them. '
      + 'Use the participants list to record who attended.');
  }

  const id = Number.parseInt(req.params.id, 10);
  const service = await serviceModel.findById(id);
  if (!service) return res.redirect('/services');

  if (!['open', 'ongoing', 'planned'].includes(service.status)) {
    return res.redirect(`/services/${id}?closed=1`);
  }

  const applicantId = await applicantIdFor(res.locals.currentUser);
  await serviceModel.addParticipant(id, res.locals.currentUser.id, applicantId);
  res.redirect(`/services/${id}?applied=1`);
});

// POST /services/:id/participants/:pid — staff record the outcome
router.post('/:id/participants/:pid', async (req, res) => {
  if (!STAFF.includes(res.locals.role)) return denied(res, 'Only ATI staff can update participation records.');
  const serviceId = Number.parseInt(req.params.id, 10);
  const participantId = Number.parseInt(req.params.pid, 10);

  const participant = await serviceModel.findParticipantById(participantId);
  if (!participant || participant.serviceId !== serviceId) return res.redirect(`/services/${serviceId}`);

  await serviceModel.updateParticipant(participantId, {
    applicationStatus: req.body.applicationStatus,
    attended: req.body.attended === 'on',
    completedAt: req.body.completedAt || null,
    remarks: req.body.remarks,
  });
  res.redirect(`/services/${serviceId}?participant=updated`);
});

module.exports = router;
