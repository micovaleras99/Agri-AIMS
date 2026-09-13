/**
 * Prescribed-form downloads, optionally pre-filled for an applicant.
 *
 * GET /forms/:type sends the blank official form. When the form is one we can
 * pre-fill and an applicant is in context — the signed-in applicant, or staff
 * viewing ?applicant=<id> — the applicant's Basic Information is injected into a
 * COPY of the form and that copy is sent. The stored template in
 * forms/prescribed/ is never modified, so an admin can still replace it freely
 * and a form with an unexpected layout simply comes back blank, never broken.
 *
 * Blank templates are not private, but the folder is still not served by
 * express.static: `:type` must resolve through the config allowlist, which is
 * what keeps "../../.env" out.
 *
 * Mounted under requireAuthPage in app.js.
 */

const fs = require('fs');
const path = require('path');
const express = require('express');
const { resolvePrescribed } = require('../config/prescribedForms');
const { fillDocx } = require('../services/docxFill');
const applicantModel = require('../models/applicantModel');
const farmModel = require('../models/farmModel');
const locationModel = require('../models/locationModel');
const documentModel = require('../models/documentModel');
const { resolveStored } = require('../config/upload');
const selfAssessmentDoc = require('../services/selfAssessmentDoc');

const router = express.Router();

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** Forms the system generates by filling the official DOCX, keyed by type. */
const GENERATED_DOCS = {
  self_assessment: selfAssessmentDoc,
  development_plan: require('../services/developmentPlanDoc'),
  farm_profile: require('../services/farmProfileDoc'),
  // Admin forms: the system fills them, the admin signs and uploads the signed
  // copy — so these expose fillBuffer (Download filled) only, not generate().
  lsa1_field_validation_report: require('../services/fieldValidationDoc'),
  lsa1_rtwg_endorsement: require('../services/endorsementDoc'),
  lsa1_checklist: require('../services/checklistDoc'),
  lsa2_checklist: require('../services/checklistDoc'),
  lsa1_qualification_form: require('../services/qualificationDoc'),
  lsa2_qualification_form: require('../services/qualificationDoc'),
};

/**
 * One address line from its parts, de-duplicated.
 *
 * `farmAddress` means different things by how the record was created: on
 * self-registration it is only the street/purok (barangay, city and province are
 * picked separately), while the admin farmer form calls it "Complete Farm
 * Address" and a person may type the whole thing there. So the barangay, city and
 * province are appended to the street, but any part already written into the
 * street is skipped rather than repeated — the self-reg case gets a full address
 * built up, the already-complete case is left as it stands.
 */
function composeAddressLine(street, barangayName, municipality, province) {
  const s = String(street || '').trim();
  const sLc = s.toLowerCase();
  const brgy = barangayName ? `Brgy. ${barangayName}` : '';
  const extra = [brgy, municipality, province].filter((p) => {
    if (!p) return false;
    const bare = String(p).replace(/^Brgy\.\s*/i, '');
    return !sLc.includes(bare.toLowerCase());
  });
  return [s, ...extra].filter(Boolean).join(', ');
}

/**
 * The applicant's complete address for a pre-filled form. The barangay, city and
 * province are derived from `barangay_id` (the authoritative hierarchy) rather
 * than the plain-text columns, which can drift; those columns are the fallback
 * when no barangay is recorded.
 */
async function completeAddress(a) {
  if (!a) return '';
  const anc = a.barangayId ? await locationModel.findAncestry(a.barangayId).catch(() => null) : null;
  return composeAddressLine(
    a.farmAddress,
    anc && anc.barangayName,
    (anc && anc.municipalityName) || a.municipality,
    (anc && anc.provinceName) || a.province
  );
}

const CONTENT_TYPES = {
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

/**
 * Which forms can be pre-filled, and the Basic Information each takes. The label
 * is matched as the start of a cell in the form's table, so it need not be the
 * full label text. A value that is empty is skipped, leaving that blank blank.
 */
const FILLABLE = {
  self_assessment: (a) => [
    { label: 'Name of Farm', value: a.farmName },
    { label: 'Name of Owner', value: `${a.firstName || ''} ${a.lastName || ''}`.trim() },
    { label: 'Address', value: a.fullAddress || a.farmAddress || [a.municipality, a.province].filter(Boolean).join(', ') },
  ],
  // Farm Profile is now authored on-screen and filled in full by
  // services/farmProfileDoc.js (see GENERATED_DOCS), so it is not a simple
  // label-prefill here.
};

/** The applicant whose data should fill the form, or null to send it blank. */
async function targetApplicant(req) {
  const { role, currentUser } = req.res.locals;
  if (role === 'applicant' && currentUser.applicationId) {
    return applicantModel.findByApplicationId(currentUser.applicationId);
  }
  if (role === 'operator' && currentUser.farmId) {
    const id = await farmModel.getApplicantIdForFarm(currentUser.farmId);
    return id ? applicantModel.findById(id) : null;
  }
  if (['admin'].includes(role) && req.query.applicant) {
    return applicantModel.findById(parseInt(req.query.applicant, 10));
  }
  return null;
}

/** Render the "missing required information" page for a generated form. */
function renderMissing(res, missing) {
  return res.status(422).render('pages/error', {
    title: 'Information Incomplete', code: 422,
    message: `Some required information is missing, so the form can't be generated yet: ${missing.join(', ')}. Please complete it in the application first.`,
  });
}

/**
 * GET /forms/:type/download — the completed official DOCX, filled from the
 * database. Streams the applicant's current generated copy (creating one on the
 * fly if none exists), as a download with a readable filename. This is both the
 * "Preview" (opens in Word / Google Docs) and the "Download".
 */
router.get('/:type/download', async (req, res) => {
  const gen = GENERATED_DOCS[req.params.type];
  const applicant = await targetApplicant(req).catch(() => null);
  if (!gen || !gen.generate || !applicant) {
    return res.status(404).render('pages/error', {
      title: 'Not Found', code: 404, message: 'No generated form is available here for that applicant.',
    });
  }

  let doc = (await documentModel.findByApplicant(applicant.id))
    .find((d) => d.type === gen.DOC_TYPE);
  if (!doc) {
    const result = await gen.generate(applicant);
    if (!result.ok) return renderMissing(res, result.missing);
    doc = await documentModel.findById(result.docId);
  }

  const abs = resolveStored(doc.storedName);
  if (!abs) {
    return res.status(404).render('pages/error', {
      title: 'Not Found', code: 404, message: 'That file is missing from storage.',
    });
  }
  res.type(doc.mimeType || DOCX_MIME);
  // A PDF previews inline in the browser; a DOCX (fallback) downloads.
  const disposition = /\.pdf$/i.test(doc.storedName) ? 'inline' : 'attachment';
  res.setHeader('Content-Disposition', `${disposition}; filename="${doc.filename}"`);
  return res.sendFile(abs);
});

/**
 * GET /forms/:type/filled — the applicant's filled form as an editable .docx.
 * Best-effort (fills whatever data exists) and never stored — this is the
 * "Download" action in the Documentary Requirements list, giving the applicant
 * an editable Word copy of their own answers, distinct from the official PDF
 * kept in Document Management.
 */
router.get('/:type/filled', async (req, res) => {
  const gen = GENERATED_DOCS[req.params.type];
  const applicant = await targetApplicant(req).catch(() => null);
  if (!gen || !gen.fillBuffer || !applicant) {
    return res.status(404).render('pages/error', {
      title: 'Not Found', code: 404, message: 'No fillable form is available here for that applicant.',
    });
  }
  const cu = res.locals.currentUser || {};
  const evaluator = `${cu.firstName || ''} ${cu.lastName || ''}`.trim();
  const { buffer, filename } = await gen.fillBuffer(applicant, { evaluator });
  res.type(DOCX_MIME);
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  return res.send(buffer);
});

/**
 * POST /forms/:type/regenerate — rebuild the completed DOCX from the latest
 * database values, replacing the stored copy. Redirects back to the step.
 */
router.post('/:type/regenerate', async (req, res) => {
  const gen = GENERATED_DOCS[req.params.type];
  if (req.body.applicant) req.query.applicant = req.body.applicant;
  const applicant = await targetApplicant(req).catch(() => null);
  if (!gen || !applicant) return res.redirect('/applicants');

  const result = await gen.generate(applicant);
  if (!result.ok) return renderMissing(res, result.missing);
  return res.redirect(`/accreditation/${applicant.id}/step/2?regenerated=1`);
});

router.get('/:type', async (req, res) => {
  const applicant = await targetApplicant(req).catch(() => null);
  const abs = resolvePrescribed(req.params.type, applicant || res.locals.currentUser || {});
  if (!abs) {
    return res.status(404).render('pages/error', {
      title: 'Not Found', code: 404, message: 'No prescribed form is available for that requirement.',
    });
  }
  const ext = path.extname(abs).toLowerCase();

  const spec = FILLABLE[req.params.type];
  if (spec && applicant && ext === '.docx') {
    // Resolve the complete address (street + barangay + city + province) before
    // the form is filled, so the Address blank is not just the street or the
    // city/province.
    applicant.fullAddress = await completeAddress(applicant);
    const filled = fillDocx(fs.readFileSync(abs), spec(applicant));
    res.type(CONTENT_TYPES['.docx']);
    res.setHeader('Content-Disposition', `attachment; filename="${path.basename(abs)}"`);
    return res.send(filled);
  }

  res.type(CONTENT_TYPES[ext] || 'application/octet-stream');
  return res.download(abs, path.basename(abs));
});

module.exports = router;

// ponytail: self-check for the address composer — run `node routes/forms.js`.
if (require.main === module) {
  const eq = (got, want, msg) =>
    console.assert(got === want, `${msg}: got ${JSON.stringify(got)}`);
  eq(composeAddressLine('Purok 2', 'San Isidro', 'Pili', 'Camarines Sur'),
    'Purok 2, Brgy. San Isidro, Pili, Camarines Sur', 'self-reg street + parts');
  eq(composeAddressLine('Purok 2, Brgy. San Isidro, Pili, Camarines Sur', 'San Isidro', 'Pili', 'Camarines Sur'),
    'Purok 2, Brgy. San Isidro, Pili, Camarines Sur', 'already-complete is not duplicated');
  eq(composeAddressLine('', 'San Isidro', 'Pili', 'Camarines Sur'),
    'Brgy. San Isidro, Pili, Camarines Sur', 'no street');
  eq(composeAddressLine('Purok 2', null, 'Pili', 'Camarines Sur'),
    'Purok 2, Pili, Camarines Sur', 'no barangay recorded');
  eq(composeAddressLine('', null, '', ''), '', 'nothing at all');
  console.log('composeAddressLine self-check passed');
  process.exit(0);
}
