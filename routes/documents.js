const fs = require('fs');
const express = require('express');
const { ALL_DOCUMENT_TYPES, LABELS, requirementsFor, adminRequirementsFor } = require('../config/documentRequirements');
const { buildZip } = require('../services/zip');
const { hasPrescribedForm } = require('../config/prescribedForms');
const { LSA2_DOCUMENTS } = require('../config/lsa2');
const { upload, humanSize, resolveStored, removeStored } = require('../config/upload');
const { requireCsrfAfterUpload } = require('../middleware/csrf');
const documentModel = require('../models/documentModel');
const documentReviewModel = require('../models/documentReviewModel');
const applicantModel = require('../models/applicantModel');
const farmModel = require('../models/farmModel');
const notify = require('../services/notify');

const router = express.Router();

router.get('/', async (req, res) => {
  const { role, currentUser } = res.locals;
  const { status, type, search } = req.query;

  let docs;

  if (role === 'applicant') {
    const appRow = await applicantModel.findByApplicationId(currentUser.applicationId);
    docs = appRow ? await documentModel.findFiltered({ applicantId: appRow.id }) : [];
  } else if (role === 'operator') {
    // `|| 1` used to stand here: an operator whose account had no Learning
    // Site linked was shown farm 1's documents as though they were their own.
    const farmId = Number(currentUser.farmId) || null;
    const applicantId = farmId ? await farmModel.getApplicantIdForFarm(farmId) : null;
    if (applicantId) {
      docs = await documentModel.findFiltered({ applicantId });
    } else {
      docs = [];
    }
  } else {
    docs = await documentModel.findFiltered({ status, type, search });
  }

  const docStats = await documentModel.statsGlobal();

  // Group by requirement, not by applicant: one container per document type
  // holding every applicant's submission of it — the order the reviewer works
  // in ("verify everyone's Signed Briefer"), and the order they appear on the
  // official checklist. Types with no submission are not shown; a type not in
  // the catalogue (legacy 'other') falls to the end.
  const typeOrder = ALL_DOCUMENT_TYPES.map((t) => t.type);
  const typeMeta = new Map(ALL_DOCUMENT_TYPES.map((t) => [t.type, t]));
  // Last resort for any type not in the catalogue (legacy 'other'): humanise the
  // key rather than print snake_case.
  const humanise = (t) => String(t).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  const labelFor = (t) => (typeMeta.get(t) && typeMeta.get(t).label)
    || LABELS[t] || humanise(t);

  const grouped = new Map();
  for (const d of docs) {
    if (!grouped.has(d.type)) grouped.set(d.type, []);
    grouped.get(d.type).push(d);
  }
  const rank = (t) => { const i = typeOrder.indexOf(t); return i === -1 ? 999 : i; };
  const docGroups = [...grouped.keys()]
    .sort((a, b) => rank(a) - rank(b))
    .map((type) => {
      const items = grouped.get(type);
      const meta = typeMeta.get(type);
      return {
        type,
        label: labelFor(type),
        form: meta ? meta.form : null,
        items,
        counts: {
          total: items.length,
          verified: items.filter((d) => d.status === 'verified').length,
          pending: items.filter((d) => d.status === 'pending_review').length,
          incomplete: items.filter((d) => d.status === 'incomplete').length,
        },
      };
    });

  res.render('pages/documents', {
    title: 'Documents — Agri-AIMS',
    page: 'documents',
    docs,
    docGroups,
    docStats,
    // Applicants and operators see the decision and its remarks; only the
    // people who make it get the controls.
    canReview: ['admin'].includes(role),
    filters: { status, type, search, success: req.query.success, error: req.query.error },
  });
});

router.get('/submit', async (req, res) => {
  const { role, currentUser } = res.locals;

  let applicants = [];

  if (role === 'applicant') {
    // Applicants can only submit documents for themselves
    const appRow = await applicantModel.findByApplicationId(currentUser.applicationId);
    if (appRow) {
      applicants = [{
        id: appRow.id,
        applicationId: appRow.applicationId,
        firstName: appRow.firstName,
        lastName: appRow.lastName,
      }];
    }
  } else if (role === 'operator') {
    // Operators can submit documents for their farm's linked applicant
    const farmId = currentUser.farmId;
    if (farmId) {
      const applicantId = await farmModel.getApplicantIdForFarm(farmId);
      if (applicantId) {
        const appRow = await applicantModel.findById(applicantId);
        if (appRow) {
          applicants = [{
            id: appRow.id,
            applicationId: appRow.applicationId,
            firstName: appRow.firstName,
            lastName: appRow.lastName,
          }];
        }
      }
    }
  } else {
    // Admin and other roles can submit documents for any applicant
    applicants = await applicantModel.listIdNamePairs();
  }

  // The form shows one applicant's own requirements with where each one stands,
  // instead of a blind pick from 35 types. An applicant or operator has exactly
  // one; staff pick whom first, then get the same picker for that person.
  const lockApplicant = applicants.length === 1;
  let targetId = null;
  if (lockApplicant) {
    targetId = applicants[0].id;
  } else if (req.query.applicant && applicants.some((a) => String(a.id) === String(req.query.applicant))) {
    targetId = Number(req.query.applicant);
  }

  let requirements = null;
  let submittingFor = null;
  if (targetId != null) {
    const appRow = await applicantModel.findById(targetId);
    if (appRow) {
      submittingFor = applicants.find((a) => String(a.id) === String(targetId)) || null;
      const existing = await documentModel.findByApplicant(appRow.id);
      const rank = { incomplete: 0, missing: 1, pending_review: 2, verified: 3 };
      // Staff also file the admin-owned forms (field validation report,
      // acceptance, endorsement, checklist, qualification); applicants do not.
      const base = ['admin'].includes(role)
        ? [...requirementsFor(appRow), ...adminRequirementsFor(appRow)]
        : requirementsFor(appRow);
      // Uploading from the LSA II up-scaling page: its packet is separate from
      // the LSA I checklist, so add it here or the operator's picker (which has
      // no "Other document" option) would have nothing to select.
      if (typeof req.query.type === 'string' && req.query.type.startsWith('lsa2_')) {
        base.push(...LSA2_DOCUMENTS);
      }
      requirements = base
        .map((r) => {
          const doc = existing.find((d) => d.type === r.type);
          return {
            type: r.type,
            label: r.label || r.name,
            form: r.form || null,
            hasForm: hasPrescribedForm(r.type, appRow),
            status: doc ? doc.status : 'missing',
            remarks: doc ? doc.remarks : null,
          };
        })
        // What needs doing first: returned, then not-yet-submitted, then the
        // rest. A reviewer's "please fix" should be the first thing they see.
        .sort((a, b) => (rank[a.status] ?? 9) - (rank[b.status] ?? 9));
    }
  }

  res.render('pages/document-submit', {
    docTypes: ALL_DOCUMENT_TYPES,
    docLabels: LABELS,
    query: req.query,
    title: 'Submit Document — Agri-AIMS',
    page: 'documents',
    applicants,
    requirements,
    submittingFor,
    lockApplicant,
  });
});

/**
 * A readable filename for a submission, matching the generated forms'
 * "Development-Plan-Laarni-Nacario.pdf" style: the requirement label and the
 * applicant, keeping the uploaded file's own extension.
 */
function submissionFilename(label, applicant, originalName) {
  const slug = (s) => String(s || '').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-');
  const ext = (String(originalName || '').match(/\.[A-Za-z0-9]+$/) || [''])[0].toLowerCase();
  const base = slug(label) || 'Document';
  const who = applicant ? slug(`${applicant.firstName || ''} ${applicant.lastName || ''}`) : '';
  return `${base}${who ? `-${who}` : ''}${ext}`;
}

router.post('/submit', upload.single('file'), requireCsrfAfterUpload, async (req, res) => {
  if (req.uploadRejected === 'type') return res.redirect('/documents/submit?error=type');
  if (!req.file) return res.redirect('/documents/submit?error=missing');

  // Same rule as the evidence route: the file is on disk before any of the
  // authorisation below runs, so a refusal has to remove it.
  const discard = () => { if (req.file) removeStored(req.file.filename); };

  const { role, currentUser } = res.locals;

  const selectedApplicantId = parseInt(req.body.applicantId, 10);
  
  // Authorization check: ensure user can submit for the selected applicant
  if (role === 'applicant') {
    // Applicants can only submit for themselves
    const appRow = await applicantModel.findByApplicationId(currentUser.applicationId);
    if (!appRow || appRow.id !== selectedApplicantId) {
      discard();
      return res.status(403).render('pages/error', {
        title: 'Access Denied',
        code: 403,
        message: 'You can only submit documents for your own application.',
      });
    }
  } else if (role === 'operator') {
    // Operators can only submit for their farm's linked applicant
    const farmId = currentUser.farmId;
    if (farmId) {
      const applicantId = await farmModel.getApplicantIdForFarm(farmId);
      if (!applicantId || applicantId !== selectedApplicantId) {
        discard();
        return res.status(403).render('pages/error', {
          title: 'Access Denied',
          code: 403,
          message: 'You can only submit documents for your farm\'s applicant.',
        });
      }
    } else {
      discard();
      return res.status(403).render('pages/error', {
        title: 'Access Denied',
        code: 403,
        message: 'No farm assigned to your account.',
      });
    }
  }
  // Admins can submit for any applicant (no additional checks needed)

  const applicant = await applicantModel.findById(selectedApplicantId);

  // The picker posts the requirement directly. "Other document" posts the
  // sentinel __other__ and the real type in docTypeOther, so staff can file a
  // type outside the applicant's standard checklist.
  let docType = req.body.docType;
  if (docType === '__other__') docType = req.body.docTypeOther;
  if (!docType) {
    discard();
    return res.redirect('/documents/submit?error=type&pick=1'
      + (Number.isInteger(selectedApplicantId) ? '&applicant=' + selectedApplicantId : ''));
  }

  // One requirement, one document. Re-uploading replaces the previous
  // submission instead of leaving a duplicate row and an unreachable file.
  const replaced = await documentModel.removeSameType(selectedApplicantId, docType);

  await documentModel.create({
    applicantId: selectedApplicantId || 0,
    applicationId: applicant ? applicant.applicationId : 'N/A',
    applicantName: applicant ? `${applicant.firstName} ${applicant.lastName}` : 'Unknown',
    // Prefer the client's label, but fall back to the type's own label so a
    // submission is never stored as the generic "Document" — the picker posts
    // the type reliably, the docName only as a convenience.
    name: req.body.docName || LABELS[docType] || 'Document',
    type: docType,
    // Store a readable name built from the requirement + applicant (like the
    // generated forms), not the raw upload name (e.g. "scan_0012.pdf").
    filename: submissionFilename(req.body.docName || LABELS[docType], applicant, req.file.originalname),
    storedName: req.file.filename,
    mimeType: req.file.mimetype,
    sizeBytes: req.file.size,
    size: humanSize(req.file.size),
    uploadDate: new Date().toISOString().split('T')[0],
    status: 'pending_review',
    remarks: '',
  });

  if (applicant) {
    await documentModel.syncCount(applicant.id);
  }

  await notify.documentSubmitted(applicant, req.body.docName || 'Document');
  res.redirect('/documents?success=' + (replaced ? 'replaced' : 'submitted'));
});

// POST /documents/:id/review — accept or reject one document.
//
// Step 4 already passes or returns the whole application. This is the decision
// underneath it: which of the twelve requirements is actually acceptable. The
// evaluator can now say so per document, and the applicant is told which one.
router.post('/:id/review', async (req, res) => {
  const { role, currentUser } = res.locals;
  if (!['admin'].includes(role)) {
    return res.status(403).render('pages/error', {
      title: 'Access Denied',
      code: 403,
      message: 'Only ATI evaluators and administrators may review documents.',
    });
  }

  const id = parseInt(req.params.id, 10);
  const doc = Number.isNaN(id) ? null : await documentModel.findById(id);
  if (!doc) {
    return res.status(404).render('pages/error', {
      title: 'Not Found', code: 404, message: 'That document no longer exists.',
    });
  }

  // 'back' keeps the evaluator on the page they decided from — the Step 4
  // worksheet or the documents list — instead of always landing on one of them.
  const back = req.body.back === 'step4'
    ? `/accreditation/${doc.applicantId}/step/4`
    : '/documents';

  const updated = await documentModel.review(id, {
    status: req.body.status,
    remarks: req.body.remarks,
    reviewerId: currentUser && currentUser.id,
  });

  // review() returns null for an unknown status and for a rejection with no
  // reason given. The second is the one that matters: telling someone to fix a
  // document without saying what is wrong is the gap this feature closes.
  if (!updated) {
    return res.redirect(`${back}?error=review`);
  }

  const applicant = await applicantModel.findById(doc.applicantId);
  await notify.documentReviewed(applicant, doc.name, updated.status, updated.remarks, updated);

  return res.redirect(`${back}?success=${updated.status === 'verified' ? 'accepted' : 'rejected'}`);
});

// The uploads directory is not public; this is the only way out, and it applies
// the same rules as viewing the document record itself.
router.get('/:id/file', async (req, res) => {
  const { role, currentUser } = res.locals;
  const doc = await documentModel.findById(parseInt(req.params.id, 10));
  if (!doc || !doc.storedName) {
    return res.status(404).render('pages/error', {
      title: 'Not Found', code: 404, message: 'That document has no uploaded file.',
    });
  }

  let allowed = ['admin'].includes(role);
  if (role === 'applicant') allowed = doc.applicationId === currentUser.applicationId;
  if (role === 'operator' && currentUser.farmId) {
    allowed = (await farmModel.getApplicantIdForFarm(currentUser.farmId)) === doc.applicantId;
  }
  if (!allowed) {
    return res.status(403).render('pages/error', {
      title: 'Access Denied', code: 403, message: 'You cannot view this document.',
    });
  }

  const abs = resolveStored(doc.storedName);
  if (!abs) {
    return res.status(404).render('pages/error', {
      title: 'Not Found', code: 404, message: 'That file is missing from storage.',
    });
  }
  res.type(doc.mimeType || 'application/octet-stream');
  // Word files aren't viewable inline, so send them as a download with their
  // real name; PDFs and images stay inline so they open in the browser tab.
  if (/\.docx$/i.test(doc.storedName)) {
    res.setHeader('Content-Disposition', `attachment; filename="${doc.filename || 'document.docx'}"`);
  }
  return res.sendFile(abs);
});

// GET /documents/:id/history — the submission/validation timeline for this
// document's requirement (all attempts), as JSON for the history modal.
router.get('/:id/history', async (req, res) => {
  const { role, currentUser } = res.locals;
  const doc = await documentModel.findById(parseInt(req.params.id, 10));
  if (!doc) return res.status(404).json({ success: false, error: 'Not found' });

  let allowed = ['admin'].includes(role);
  if (role === 'applicant') allowed = doc.applicationId === currentUser.applicationId;
  if (role === 'operator' && currentUser.farmId) {
    allowed = (await farmModel.getApplicantIdForFarm(currentUser.farmId)) === doc.applicantId;
  }
  if (!allowed) return res.status(403).json({ success: false, error: 'Forbidden' });

  const events = await documentReviewModel.historyFor(doc.applicantId, doc.type);
  return res.json({ success: true, document: doc.name, events });
});

// GET /documents/package/:applicantId — the central-office submission package.
//
// ATI emails the validated documents to the Central Office together with the
// endorsement (client §14, §15). This gathers every verified document for an
// application — the applicant's own plus the admin-completed field validation
// report, acceptance, and endorsement — into one .zip the admin downloads and
// attaches, rather than collecting files by hand.
router.get('/package/:applicantId', async (req, res) => {
  const { role } = res.locals;
  if (!['admin'].includes(role)) {
    return res.status(403).render('pages/error', {
      title: 'Access Denied', code: 403,
      message: 'Only ATI administrators may download the submission package.',
    });
  }

  const applicantId = parseInt(req.params.applicantId, 10);
  const applicant = await applicantModel.findById(applicantId);
  if (!applicant) {
    return res.status(404).render('pages/error', {
      title: 'Not Found', code: 404, message: 'That application does not exist.',
    });
  }

  const verified = await documentModel.findVerifiedByApplicant(applicantId);
  const entries = [];
  for (const d of verified) {
    const abs = resolveStored(d.storedName);
    if (!abs || !fs.existsSync(abs)) continue; // a row whose file is gone is skipped, not fatal
    const ext = (d.storedName.match(/\.[a-z0-9]+$/i) || [''])[0];
    entries.push({ name: `${d.name}${ext}`, data: fs.readFileSync(abs) });
  }

  if (!entries.length) {
    return res.redirect(`/applicants/${applicantId}?nopackage=1`);
  }

  const safeApp = String(applicant.applicationId).replace(/[^\w-]+/g, '_');
  const zip = buildZip(entries);
  res.type('application/zip');
  res.setHeader('Content-Disposition',
    `attachment; filename="Application_${safeApp}_Validated_Documents.zip"`);
  return res.send(zip);
});

router.use((err, req, res, next) => {
  if (err && err.code === 'LIMIT_FILE_SIZE') return res.redirect('/documents/submit?error=size');
  return next(err);
});

module.exports = router;
