// ============================================================
// routes/accreditation.js — 7-Step LSA Accreditation Functions
// Source: ATI-QF-PAD-162 Briefer + ATI-QF-PAD-164 Self-Assessment
//
// STEP 1 — Briefing           (Applicant reads + signs briefer)
// STEP 2 — Self-Assessment    (Applicant fills ATI-QF-PAD-164)
// STEP 3 — Submit Documents   (Applicant uploads the required documents)
// STEP 4 — Document Evaluation(Evaluator reviews submissions)
// STEP 5 — Field Validation   (Evaluator TWG conducts site visit)
// STEP 6 — Endorsement        (Evaluator endorses to ATI-CO)
// STEP 7 — Certificate & MOA  (Admin issues cert + MOA signing)
// ============================================================

const express = require('express');
const classifications = require('../config/classifications');
const router = express.Router();
const documentModel = require('../models/documentModel');
const applicantModel = require('../models/applicantModel');
const { getApplicant, advanceStep, canPassStep4 } = require('../controllers/accreditationHelpers');
const { certify } = require('../services/certification');
const assessmentModel = require('../models/assessmentModel');
const { FACILITY_ITEMS } = require('../config/accreditationChecklists');

/**
 * May this caller open or act on this application?
 *
 * ATI staff handle every application; an applicant handles exactly one — their
 * own. Steps 1 to 3 checked the ROLE and never the application, so any
 * signed-in applicant could open /accreditation/<any id>/step/1 and post it:
 * signing somebody else's LSA briefer under their own name, answering their
 * self-assessment, and advancing their application. That was proven against a
 * throwaway account before this was written — the victim's record came back
 * reading "acknowledged by: Al Nosy", step 1 to step 2.
 *
 * Operators have finished this procedure and are sent to their dashboard by the
 * overview handler; they are refused here for the same reason as anyone else.
 */
function mayHandleApplication(res, applicant) {
  const { role, currentUser } = res.locals;
  if (['admin', 'evaluator'].includes(role)) return true;
  return Boolean(
    applicant && currentUser && currentUser.applicationId
    && applicant.applicationId === currentUser.applicationId
  );
}

function notYours(res) {
  return res.status(403).render('pages/error', {
    title: 'Access Denied',
    code: 403,
    message: 'This is not your application. You can only open your own.',
  });
}

/**
 * Files an uploaded form as the applicant's submission for one requirement,
 * replacing any previous copy — how Steps 1 (Briefer) and 2 (Self-Assessment)
 * record the completed prescribed form the applicant uploads.
 */
async function fileUploadedRequirement(applicant, type, file, status = 'pending_review', name) {
  await documentModel.removeSameType(applicant.id, type);
  await documentModel.create({
    applicantId: applicant.id,
    applicationId: applicant.applicationId,
    applicantName: `${applicant.firstName} ${applicant.lastName}`,
    name: name || LABELS[type] || 'Document',
    type,
    filename: file.originalname,
    storedName: file.filename,
    mimeType: file.mimetype,
    sizeBytes: file.size,
    size: humanSize(file.size),
    uploadDate: new Date().toISOString().split('T')[0],
    // Applicant uploads await review; forms the admin completes are already
    // authoritative, so they are filed as verified.
    status,
    remarks: '',
  });
  await documentModel.syncCount(applicant.id);
}
const { upload, humanSize, removeStored } = require('../config/upload');
const { requireCsrfAfterUpload } = require('../middleware/csrf');
const notify = require('../services/notify');
// Steps 1 and 2 now use the prescribed-form workflow: the applicant downloads
// the official Briefer / Self-Assessment, completes and signs it offline, and
// uploads the finished copy, which is filed as their submission for that
// requirement — the same plumbing the Documents module uses.
const {
    ACCREDITATION_STEPS,
    DISQUALIFICATION_GROUNDS,
    FARM_REQUIREMENTS,
    OPERATOR_REQUIREMENTS,
} = require('../config/accreditationChecklists');
const { requirementsFor, LABELS } = require('../config/documentRequirements');
const { hasPrescribedForm } = require('../config/prescribedForms');
const { ORGANIZATION } = require('../config/organization');
const { isWithinPhilippines } = require('../utils/validation');
const { validUntilFrom } = require('../config/renewal');

// ══════════════════════════════════════════════════════════════
// STEP 1 — BRIEFING
// Who: Applicant
// Function: Read the LSA Briefer (ATI-QF-PAD-162), acknowledge
//           requirements and responsibilities, sign to confirm
// ══════════════════════════════════════════════════════════════

// GET /accreditation/:id/step/1 — Show briefer content
router.get('/:id/step/1', async (req, res) => {
    const { role } = res.locals;
    if (!['admin','evaluator','applicant'].includes(role)) {
        return res.redirect(`/applicants/${req.params.id}`);
    }

    const applicant = await getApplicant(req.params.id);
    if (!applicant) return res.redirect('/applicants');
    if (!mayHandleApplication(res, applicant)) return notYours(res);

    // LSA classifications from briefer
    // Was a third hand-written copy of the same list, with a third set of
    // codes ('GAP', 'flowers', 'urban') that matched neither the form nor the
    // database. It now reads from the one config.
    const lsaClassifications = {
        farming: classifications.farming().map((c) => ({ code: c.key, label: c.label, desc: c.desc })),
        processing: classifications.processing().map((c) => ({ code: c.key, label: c.label, desc: c.desc }))
    };

    // The briefer's reference lists live in config so the on-screen briefer and
    // the generated PDF render the same content.
    const farmRequirements = FARM_REQUIREMENTS;
    const operatorRequirements = OPERATOR_REQUIREMENTS;
    const disqualified = DISQUALIFICATION_GROUNDS;

    res.render('pages/accreditation/step1-briefing', {
        declarationError: req.query.error === 'declaration',
        fileError: req.query.error === 'file',
        title:    `Step 1: Briefing — ${applicant.applicationId}`,
        page:     'applicants',
        applicant,
        lsaClassifications,
        farmRequirements,
        operatorRequirements,
        disqualified,
        readonly: !['applicant','admin'].includes(role)
    });
});

// POST /accreditation/:id/step/1 — Applicant uploads the signed briefer
router.post('/:id/step/1', upload.single('file'), requireCsrfAfterUpload, async (req, res) => {
    const { role } = res.locals;
    // The file is on disk before any check below runs, so every refusal removes it.
    const discard = () => { if (req.file) removeStored(req.file.filename); };

    if (!['admin','applicant'].includes(role)) {
        discard();
        return res.redirect(`/applicants/${req.params.id}`);
    }

    const applicant = await getApplicant(req.params.id);
    if (!applicant) { discard(); return res.redirect('/applicants'); }
    if (!mayHandleApplication(res, applicant)) { discard(); return notYours(res); }

    // LSA-20 — the briefer names who may not be an LSA operator, so the
    // applicant has to answer it rather than just read it. Refusing here is
    // right: an unanswered declaration is not a technicality, it is the
    // eligibility question itself.
    const certified = ['readBriefer', 'notDisqualified', 'agreeResponsibilities']
        .every((k) => req.body[k] === 'on');
    if (!certified) {
        discard();
        return res.redirect(`/accreditation/${req.params.id}/step/1?error=declaration`);
    }
    if (req.uploadRejected === 'type' || !req.file) {
        discard();
        return res.redirect(`/accreditation/${req.params.id}/step/1?error=file`);
    }

    const today = new Date().toLocaleDateString('en-CA');
    await fileUploadedRequirement(applicant, 'signed_briefer', req.file);

    const ok = await advanceStep(req.params.id, 2, {
        step1_brieferSigned:    true,
        step1_brieferDate:      today,
        step1_acknowledgedBy:   `${applicant.firstName} ${applicant.lastName}`,
        notDisqualified:        1,
        disqualificationDeclaredAt: today,
    });
    if (!ok) return res.redirect('/applicants');

    await notify.accreditationAdvanced(applicant, 2);
    res.redirect(`/accreditation/${req.params.id}/step/2?advanced=1`);
});


// ══════════════════════════════════════════════════════════════
// STEP 2 — SELF-ASSESSMENT
// Who: Applicant
// Function: Complete ATI-QF-PAD-164 eligibility self-assessment
//           Checks farm, operator, and document qualifications
// ══════════════════════════════════════════════════════════════

// GET /accreditation/:id/step/2
router.get('/:id/step/2', async (req, res) => {
    const { role } = res.locals;
    const applicant = await getApplicant(req.params.id);
    if (!applicant) return res.redirect('/applicants');
    if (!mayHandleApplication(res, applicant)) return notYours(res);

    // The Self-Assessment is now the prescribed ATI-QF-PAD-164 form: download,
    // complete offline, upload. The completed copy filed at Step 1/2 is what a
    // reviewer reads, so the on-screen checklist is no longer needed here.
    const myDocs = await documentModel.findByApplicant(applicant.id);
    const submitted = myDocs.find((d) => d.type === 'self_assessment') || null;

    res.render('pages/accreditation/step2-selfassessment', {
        title:    `Step 2: Self-Assessment — ${applicant.applicationId}`,
        page:     'applicants',
        applicant,
        submitted,
        // The four basic facilities the applicant declares — pre-ticked from a
        // previous submission so revisiting the step shows what was answered.
        facilities:       FACILITY_ITEMS,
        facilityAnswers:  await assessmentModel.answerMap(applicant.id, 2),
        fileError: req.query.error === 'file',
        readonly: !['applicant','admin'].includes(role)
    });
});

// POST /accreditation/:id/step/2 — Applicant uploads the completed self-assessment
router.post('/:id/step/2', upload.single('file'), requireCsrfAfterUpload, async (req, res) => {
    const { role } = res.locals;
    const discard = () => { if (req.file) removeStored(req.file.filename); };

    if (!['admin','applicant'].includes(role)) {
        discard();
        return res.redirect(`/applicants/${req.params.id}`);
    }

    const owner = await getApplicant(req.params.id);
    if (!owner) { discard(); return res.redirect('/applicants'); }
    if (!mayHandleApplication(res, owner)) { discard(); return notYours(res); }

    if (req.uploadRejected === 'type' || !req.file) {
        discard();
        return res.redirect(`/accreditation/${req.params.id}/step/2?error=file`);
    }

    await fileUploadedRequirement(owner, 'self_assessment', req.file);

    // The applicant's own claim about the four basic facilities (PDF p.11),
    // saved as the Step 2 answers the Basic Facilities panel reads as "Declared".
    await assessmentModel.saveResponses(owner.id, 2, FACILITY_ITEMS, req.body,
        `${owner.firstName} ${owner.lastName}`);

    await advanceStep(req.params.id, 3, {
        step2_completedDate: new Date().toISOString().split('T')[0],
        step2_remarks:       req.body.remarks || ''
    });

    await notify.accreditationAdvanced(owner, 3);
    res.redirect(`/accreditation/${req.params.id}/step/3?advanced=1`);
});


// ══════════════════════════════════════════════════════════════
// STEP 3 — SUBMIT DOCUMENTS
// Who: Applicant
// Function: Upload the documentary requirements that apply to this applicant
//           as listed in ATI List of Documentary Requirements
// ══════════════════════════════════════════════════════════════

// GET /accreditation/:id/step/3
router.get('/:id/step/3', async (req, res) => {
    const { role } = res.locals;
    const applicant = await getApplicant(req.params.id);
    if (!applicant) return res.redirect('/applicants');
    if (!mayHandleApplication(res, applicant)) return notYours(res);

    const myDocs = await documentModel.findByApplicant(applicant.id);

    // Conditional requirements (agri-processing, organization, government) are
    // included automatically based on this applicant's category/classification.
    const requiredDocs = requirementsFor(applicant);

    // Map each required doc to its submitted copy (if any)
    const docStatus = requiredDocs.map(rd => {
        const submitted = myDocs.find(d => d.type === rd.type);
        return {
            ...rd,
            hasForm:      hasPrescribedForm(rd.type, applicant),
            submitted:    !!submitted,
            docId:        submitted ? submitted.id : null,
            status:       submitted ? submitted.status : 'missing',
            filename:     submitted ? submitted.filename : null,
            uploadDate:   submitted ? submitted.uploadDate : null
        };
    });

    const submittedCount = docStatus.filter(d => d.submitted).length;
    const verifiedCount  = docStatus.filter(d => d.status === 'verified').length;

    res.render('pages/accreditation/step3-documents', {
        title:          `Step 3: Submit Documents — ${applicant.applicationId}`,
        page:           'applicants',
        applicant,
        docStatus,
        submittedCount,
        verifiedCount,
        totalRequired:  requiredDocs.length,
        readonly:       !['applicant','admin'].includes(role)
    });
});

// POST /accreditation/:id/step/3 — Mark documents as submitted, advance to step 4
router.post('/:id/step/3', async (req, res) => {
    const { role } = res.locals;
    if (!['admin','applicant'].includes(role)) {
        return res.redirect(`/applicants/${req.params.id}`);
    }

    const applicant = await getApplicant(req.params.id);
    if (!applicant) return res.redirect('/applicants');
    if (!mayHandleApplication(res, applicant)) return notYours(res);

    const myDocs = await documentModel.findByApplicant(applicant.id);
    const docCount   = myDocs.length;

    await advanceStep(req.params.id, 4, {
        step3_submittedDate:  new Date().toISOString().split('T')[0],
        step3_docsSubmitted:  docCount,
        step3_docsRequired:   12,
        documents:            docCount
    });

    await notify.accreditationAdvanced(applicant, 4);
    res.redirect(`/accreditation/${req.params.id}/step/4?advanced=1`);
});


// ══════════════════════════════════════════════════════════════
// STEP 4 — DOCUMENT EVALUATION
// Who: Evaluator
// Function: Review submitted documents for completeness and legibility;
//           approve or return
// ══════════════════════════════════════════════════════════════

// GET /accreditation/:id/step/4
router.get('/:id/step/4', async (req, res) => {
    const { role } = res.locals;
    if (!['admin','evaluator'].includes(role)) {
        return res.status(403).render('pages/error', {
            title: 'Access Denied', code: 403,
            message: 'Step 4 — Document Evaluation is restricted to ATI Evaluators.'
        });
    }

    const applicant = await getApplicant(req.params.id);
    if (!applicant) return res.redirect('/applicants');

    const myDocs = await documentModel.findByApplicant(applicant.id);

    const docSummary = {
        total:      myDocs.length,
        verified:   myDocs.filter(d => d.status === 'verified').length,
        pending:    myDocs.filter(d => d.status === 'pending_review').length,
        incomplete: myDocs.filter(d => d.status === 'incomplete').length
    };

    const evalResult = applicant.step4_evalResult || null;

    res.render('pages/accreditation/step4-docevaluation', {
        title:      `Step 4: Document Evaluation — ${applicant.applicationId}`,
        page:       'applicants',
        applicant,
        myDocs,
        docSummary,
        evalResult,
        // The same rule the POST enforces, so the page can say why the button
        // is unavailable instead of letting the evaluator find out by pressing it.
        passGate:   canPassStep4(myDocs),
        blocked:    req.query.blocked === '1'
    });
});

// POST /accreditation/:id/step/4 — Evaluator submits assessment result
router.post('/:id/step/4', async (req, res) => {
    const { role, currentUser } = res.locals;
    if (!['admin','evaluator'].includes(role)) {
        return res.status(403).render('pages/error', {
            title: 'Access Denied', code: 403, message: 'Unauthorized.'
        });
    }

    const result = req.body.evalResult; // 'passed' | 'returned'

    // The form hides the Pass button when documents are outstanding, but the
    // form is not the authority — a stale page or a direct POST reaches here too.
    if (result === 'passed') {
        const gate = canPassStep4(await documentModel.findByApplicant(parseInt(req.params.id, 10)));
        if (!gate.ok) {
            return res.redirect(`/accreditation/${req.params.id}/step/4?blocked=1`);
        }
    }

    if (result === 'passed') {
        await advanceStep(req.params.id, 5, {
            step4_evalDate:    new Date().toISOString().split('T')[0],
            step4_evalResult:  'passed',
            step4_evalRemarks: req.body.evalRemarks || '',
            step4_evalBy:      `${currentUser.firstName} ${currentUser.lastName}`
        });
        await notify.accreditationAdvanced(await getApplicant(req.params.id), 5);
        res.redirect(`/accreditation/${req.params.id}/step/5?advanced=1`);
    } else {
        await applicantModel.patch(parseInt(req.params.id, 10), {
            step4_evalResult: 'returned',
            step4_evalRemarks: req.body.evalRemarks || '',
            step4_evalBy: `${currentUser.firstName} ${currentUser.lastName}`,
            step4_evalDate: new Date().toISOString().split('T')[0],
            status: 'document_review',
        });
        await notify.documentsReturned(await getApplicant(req.params.id), req.body.evalRemarks);
        res.redirect(`/applicants/${req.params.id}?returned=1`);
    }
});


// ══════════════════════════════════════════════════════════════
// STEP 5 — FIELD / VIRTUAL VALIDATION
// Who: Evaluator (TWG)
// Function: On-site or virtual farm inspection for compliance;
//           geo-tagging of farm location; validation report
// ══════════════════════════════════════════════════════════════

// GET /accreditation/:id/step/5
router.get('/:id/step/5', async (req, res) => {
    const { role } = res.locals;
    if (!['admin','evaluator'].includes(role)) {
        return res.status(403).render('pages/error', {
            title: 'Access Denied', code: 403,
            message: 'Step 5 — Field Validation is restricted to ATI Evaluators (TWG).'
        });
    }

    const applicant = await getApplicant(req.params.id);
    if (!applicant) return res.redirect('/applicants');

    // Field validation is now upload-only against the prescribed report form
    // (client §12): the admin downloads ATI-QF-PAD-165, conducts the visit,
    // fills it, uploads it, and records a remark and result. The old 12-item
    // on-screen checklist is retired.
    const myDocs = await documentModel.findByApplicant(applicant.id);
    const report = myDocs.find((d) => d.type === 'lsa1_field_validation_report') || null;

    // Basic facilities: what the TWG has already recorded (if re-validating),
    // falling back to what the applicant declared in Step 2 as the starting tick.
    const claimed = await assessmentModel.answerMap(applicant.id, 2);
    const verified = await assessmentModel.answerMap(applicant.id, 5);
    const facilityAnswers = {};
    for (const f of FACILITY_ITEMS) {
        facilityAnswers[f.id] = f.id in verified ? verified[f.id] : Boolean(claimed[f.id]);
    }

    res.render('pages/accreditation/step5-fieldvalidation', {
        title:             `Step 5: ${ACCREDITATION_STEPS[4].label} — ${applicant.applicationId}`,
        page:              'applicants',
        applicant,
        reportForm:        hasPrescribedForm('lsa1_field_validation_report', applicant),
        report,
        facilities:        FACILITY_ITEMS,
        facilityAnswers,
        facilityClaimed:   claimed,
        fileError:         req.query.error === 'file',
        validationResult:  applicant.step5_validationResult || null
    });
});

// POST /accreditation/:id/step/5 — admin records the field validation
router.post('/:id/step/5', upload.single('file'), requireCsrfAfterUpload, async (req, res) => {
    const { role, currentUser } = res.locals;
    const discard = () => { if (req.file) removeStored(req.file.filename); };
    if (!['admin','evaluator'].includes(role)) {
        discard();
        return res.status(403).render('pages/error', {
            title: 'Access Denied', code: 403, message: 'Unauthorized.'
        });
    }

    const applicant = await getApplicant(req.params.id);
    if (!applicant) { discard(); return res.redirect('/applicants'); }

    if (req.uploadRejected === 'type') {
        discard();
        return res.redirect(`/accreditation/${req.params.id}/step/5?error=file`);
    }

    // The admin decides the outcome directly; a compliant result must carry the
    // completed report, either uploaded now or already on file.
    const result = req.body.validationResult === 'compliant' ? 'compliant' : 'non-compliant';
    const existing = (await documentModel.findByApplicant(applicant.id))
        .find((d) => d.type === 'lsa1_field_validation_report');
    if (result === 'compliant' && !req.file && !existing) {
        discard();
        return res.redirect(`/accreditation/${req.params.id}/step/5?error=file`);
    }

    if (req.file) {
        await fileUploadedRequirement(applicant, 'lsa1_field_validation_report', req.file, 'verified');
    }

    // What the TWG confirmed on site for the four basic facilities — saved as the
    // Step 5 answers the Basic Facilities panel reads as "Verified on site".
    await assessmentModel.saveResponses(applicant.id, 5, FACILITY_ITEMS, req.body,
        `${currentUser.firstName} ${currentUser.lastName}`);

    const lat = parseFloat(req.body.latitude);
    const lng = parseFloat(req.body.longitude);
    const extraFields = {
        step5_validationDate:   new Date().toISOString().split('T')[0],
        step5_validationType:   req.body.validationType || 'Field',
        step5_validationResult: result,
        step5_twgRemarks:       req.body.twgRemarks || '',
        step5_inspectedBy:      `${currentUser.firstName} ${currentUser.lastName}`
    };
    if (isWithinPhilippines(lat, lng)) {
        extraFields.latitude      = lat;
        extraFields.longitude     = lng;
        extraFields.geoTaggedBy   = `${currentUser.firstName} ${currentUser.lastName}`;
        extraFields.geoTaggedDate = new Date().toISOString().split('T')[0];
        extraFields.geoTagStatus  = 'tagged';
    }

    if (result === 'compliant') {
        await advanceStep(req.params.id, 6, extraFields);
        await notify.accreditationAdvanced(await getApplicant(req.params.id), 6);
        res.redirect(`/accreditation/${req.params.id}/step/6?advanced=1`);
    } else {
        await applicantModel.patch(parseInt(req.params.id, 10), extraFields);
        await notify.validationFailed(await getApplicant(req.params.id), req.body.twgRemarks);
        res.redirect(`/applicants/${req.params.id}?noncompliant=1`);
    }
});


// ══════════════════════════════════════════════════════════════
// STEP 6 — ENDORSEMENT TO ATI-CO
// Who: Evaluator (ATI-RTC)
// Function: Compile and endorse scanned application documents
//           with RTWG endorsement to ATI Central Office
// ══════════════════════════════════════════════════════════════

// GET /accreditation/:id/step/6
router.get('/:id/step/6', async (req, res) => {
    const { role } = res.locals;
    if (!['admin','evaluator'].includes(role)) {
        return res.status(403).render('pages/error', {
            title: 'Access Denied', code: 403,
            message: 'Step 6 — Endorsement is restricted to ATI-RTC Evaluators.'
        });
    }

    const applicant = await getApplicant(req.params.id);
    if (!applicant) return res.redirect('/applicants');

    const allDocs = await documentModel.findByApplicant(applicant.id);
    const myDocs = allDocs.filter((d) => d.status === 'verified');
    const endorsementDoc = allDocs.find((d) => d.type === 'lsa1_rtwg_endorsement') || null;

    // Endorsement letter template data
    const endorsementData = {
        rtcDirector:  ORGANIZATION.director,
        rtcOffice:    ORGANIZATION.office,
        rtcAddress:   ORGANIZATION.address,
        atiCoAddress: ORGANIZATION.centralOffice,
        endorseDate:  applicant.step6_endorsedDate || new Date().toISOString().split('T')[0]
    };

    res.render('pages/accreditation/step6-endorsement', {
        title:           `Step 6: Endorsement — ${applicant.applicationId}`,
        page:            'applicants',
        applicant,
        verifiedDocs:    myDocs,
        endorsementData,
        endorsementForm: hasPrescribedForm('lsa1_rtwg_endorsement', applicant),
        endorsementDoc,
        confirmError:    req.query.error === 'confirm',
        endorsed:        !!applicant.step6_endorsedDate
    });
});

// POST /accreditation/:id/step/6 — Submit endorsement (with the completed letter)
router.post('/:id/step/6', upload.single('file'), requireCsrfAfterUpload, async (req, res) => {
    const { role, currentUser } = res.locals;
    const discard = () => { if (req.file) removeStored(req.file.filename); };
    if (!['admin','evaluator'].includes(role)) {
        discard();
        return res.status(403).render('pages/error', {
            title: 'Access Denied', code: 403, message: 'Unauthorized.'
        });
    }

    // The confirmation on the form had no name, so it never arrived and a direct
    // POST endorsed an application nobody had confirmed. Require it here.
    if (req.body.confirmEndorse !== 'on') {
        discard();
        return res.redirect(`/accreditation/${req.params.id}/step/6?error=confirm`);
    }

    const applicant = await getApplicant(req.params.id);
    if (!applicant) { discard(); return res.redirect('/applicants'); }

    // The signed endorsement letter is filed if the admin uploaded one.
    if (req.file && req.uploadRejected !== 'type') {
        await fileUploadedRequirement(applicant, 'lsa1_rtwg_endorsement', req.file, 'verified');
    } else {
        discard();
    }

    const endorsementNo = `ATI-RTC5-${new Date().getFullYear()}-${String(req.params.id).padStart(4,'0')}`;

    await advanceStep(req.params.id, 7, {
        step6_endorsedDate:    new Date().toISOString().split('T')[0],
        step6_endorsedBy:      `${currentUser.firstName} ${currentUser.lastName}`,
        step6_endorsementNo:   endorsementNo,
        step6_endorseRemarks:  req.body.endorseRemarks || ''
    });

    await notify.accreditationAdvanced(await getApplicant(req.params.id), 7);
    res.redirect(`/accreditation/${req.params.id}/step/7?advanced=1`);
});


// ══════════════════════════════════════════════════════════════
// STEP 7 — CERTIFICATE ISSUANCE & MOA/MOU SIGNING
// Who: Admin (ATI Director)
// Function: Issue LSA Certificate and execute MOA/MOU with
//           operator for 5-year accreditation period
// ══════════════════════════════════════════════════════════════

// GET /accreditation/:id/step/7
router.get('/:id/step/7', async (req, res) => {
    const { role } = res.locals;
    if (role !== 'admin') {
        return res.status(403).render('pages/error', {
            title: 'Access Denied', code: 403,
            message: 'Step 7 — Certificate Issuance is restricted to ATI Administrators (Director).'
        });
    }

    const applicant = await getApplicant(req.params.id);
    if (!applicant) return res.redirect('/applicants');

    // Generate certificate number
    const certNo    = applicant.step7_certificateNo ||
                      `ATI-LSA-${applicant.region.replace(/\s/g,'')}-${new Date().getFullYear()}-${String(applicant.id).padStart(4,'0')}`;
    const issueDate = applicant.step7_issueDate || new Date().toISOString().split('T')[0];
    const validUntil = applicant.step7_validUntil ||
                       `${new Date().getFullYear() + 5}-${new Date().toISOString().split('T')[0].substring(5)}`;

    // MOA responsibilities (from ATI Briefer)
    const moaResponsibilities = [
        { party: 'LSA Operator', items: [
            'Prepare and implement a development plan for LSA enhancement',
            'Provide at least 20% counterpart (labor, land, facilities) for enhancement',
            'Implement a diversified and integrated farming system',
            'Make available the farm as a technology demonstration area',
            'Provide lectures and orientations to on-site training participants',
            'Share technologies applied to fellow farmers/agri-processors',
            'Attend ATI-required monitoring and capability-building activities',
            'Maintain operation records (production, sales, visitors, technologies)',
            'Allow ATI personnel to conduct field monitoring visits',
            'Submit a semestral accomplishment report to ATI',
            'Sustain operation as LSA I for five (5) years'
        ]},
        { party: ORGANIZATION.office, items: [
            'Provide technical assistance, training, and capability building',
            'Conduct regular monitoring and evaluation visits',
            'Provide fund support as applicable based on approved development plan',
            'Issue and maintain Certificate of Accreditation as LSA I',
            'Facilitate linkages with other government agencies and institutions'
        ]}
    ];

    const certificateDoc = (await documentModel.findByApplicant(applicant.id))
        .find((d) => d.type === 'lsa_certificate') || null;

    res.render('pages/accreditation/step7-certificate', {
        organization:        ORGANIZATION,
        title:               `Step 7: Certificate — ${applicant.applicationId}`,
        page:                'applicants',
        applicant,
        certNo,
        issueDate,
        validUntil,
        moaResponsibilities,
        certificateDoc,
        confirmError:        req.query.error === 'confirm',
        alreadyIssued:       !!applicant.step7_certificateNo
    });
});

// POST /accreditation/:id/step/7 — Issue certificate, upload scanned copy, finalize MOA
router.post('/:id/step/7', upload.single('file'), requireCsrfAfterUpload, async (req, res) => {
    const discard = () => { if (req.file) removeStored(req.file.filename); };
    if (res.locals.role !== 'admin') {
        discard();
        return res.status(403).render('pages/error', {
            title: 'Access Denied', code: 403, message: 'Unauthorized.'
        });
    }

    // Same defect, on the step that issues the official certificate.
    if (req.body.confirmCert !== 'on') {
        discard();
        return res.redirect(`/accreditation/${req.params.id}/step/7?error=confirm`);
    }

    const applicant = await getApplicant(req.params.id);
    if (!applicant) { discard(); return res.redirect('/applicants'); }

    // The admin uploads the scanned certificate; the applicant downloads it
    // (client §17). It is filed as a verified document the applicant can read.
    if (req.file && req.uploadRejected !== 'type') {
        await fileUploadedRequirement(applicant, 'lsa_certificate', req.file, 'verified', 'LSA Certificate');
    } else {
        discard();
    }

    const issueDate  = req.body.issueDate  || new Date().toISOString().split('T')[0];
    const validUntil = req.body.validUntil || validUntilFrom(issueDate);
    const certNo     = req.body.certNo     ||
                       `ATI-LSA-${applicant.region.replace(/\s/g,'')}-${new Date().getFullYear()}-${String(applicant.id).padStart(4,'0')}`;

    // The Learning Site is created BEFORE the application is stamped, so a farm
    // that cannot be created does not leave behind a certified application with
    // nowhere to be certified — the admin sees the failure and can post again.
    const handover = await certify(applicant, {
        accreditedSince: issueDate,
        expiryDate:      validUntil,
    });

    await advanceStep(req.params.id, 7, {
        status:               'approved',
        step7_certificateNo:  certNo,
        step7_issueDate:      issueDate,
        step7_validUntil:     validUntil,
        step7_moaDate:        req.body.moaDate || issueDate,
        // The certificate is issued under the Director's name, the same one that
        // signs it — not the staff member who happened to click the button.
        step7_issuedBy:       ORGANIZATION.director,
        step7_moaRemarks:     req.body.moaRemarks || ''
    });

    await notify.certificateIssued(applicant, certNo, validUntil);
    res.redirect(`/applicants/${req.params.id}?certified=1&farm=${handover.farmId}`);
});


// ══════════════════════════════════════════════════════════════
// STEP OVERVIEW — /accreditation/:id
// All roles: View current step status + navigate to active step
// ══════════════════════════════════════════════════════════════
router.get('/:id', async (req, res) => {
    const { role } = res.locals;
    if (role === 'operator') return res.redirect('/dashboard');

    const applicant = await getApplicant(req.params.id);
    if (!applicant) return res.redirect('/applicants');
    if (!mayHandleApplication(res, applicant)) return notYours(res);

    const steps = ACCREDITATION_STEPS;

    // Once the admin uploads the scanned certificate, the applicant downloads it.
    const certificateDoc = (await documentModel.findByApplicant(applicant.id))
        .find((d) => d.type === 'lsa_certificate') || null;

    res.render('pages/accreditation/overview', {
        title:     `Accreditation — ${applicant.applicationId}`,
        page:      'applicants',
        applicant,
        steps,
        certificateDoc,
        query:     req.query
    });
});

module.exports = router;
