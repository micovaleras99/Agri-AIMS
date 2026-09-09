/**
 * Prescribed forms, in one place.
 *
 * The client supplies official ATI forms for some documentary requirements. For
 * those, the workflow is download the blank form -> fill/sign it offline ->
 * upload the completed copy. Requirements with no prescribed form stay
 * upload-only. Which is which is decided ENTIRELY by what files exist in
 * forms/prescribed/ — so an administrator can add, replace, or remove a form by
 * dropping a file in that folder, with no code change (client requirement §1,
 * §11, §24).
 *
 * The mapping below is `requirement type -> stable filename`. The file itself is
 * the source of truth: hasPrescribedForm() checks the disk, so a type listed
 * here whose file has been removed correctly falls back to upload-only, and a
 * type not listed here is upload-only by definition.
 *
 * Some LSA I requirements currently point at the LSA II version of the form,
 * because that is the only official file the client provided (Acceptance,
 * Endorsement, Qualification). Dropping an LSA I file in under the same name
 * swaps it with no code change.
 */

const fs = require('fs');
const path = require('path');

const PRESCRIBED_DIR = path.join(__dirname, '..', 'forms', 'prescribed');

/**
 * requirement type -> the file in forms/prescribed/ that backs it.
 *
 * A value may be a bare filename, or `{ file, variants }` where `variants` maps
 * an applicant classification to a different file (the profile form differs for
 * farming vs agri-processing enterprises).
 */
const FORM_FILES = {
  // Applicant-completed
  signed_briefer: 'briefer.pdf',
  self_assessment: 'self-assessment.docx',
  farm_profile: {
    file: 'farm-profile-farming.docx',
    variants: {
      agri_processing: 'farm-profile-agri-processing.docx',
      agri_processing_enterprise: 'farm-profile-agri-processing.docx',
    },
  },
  development_plan: 'lsa-development-plan.docx',

  // Admin-completed (moved off the applicant per client §7, §8, §12, §13)
  lsa1_checklist: 'applicants-checklist.docx',
  lsa1_field_validation_report: 'field-validation-report.docx',
  lsa1_acceptance_form: 'acceptance-to-lsa.docx',
  lsa1_rtwg_endorsement: 'endorsement-checklist.docx',
  lsa1_qualification_form: 'qualification-form.docx',

  // Certificate & MOA release (client §17)
  moa: 'moa.docx',
  mou: 'mou.docx',

  // LSA II up-scaling packet (PDF p.23). The client supplied one physical copy
  // of each form, used for both LSA I and LSA II, so these reuse the same files.
  // Letter of Intent and Certificate of Good Standing have no prescribed form
  // (a free letter / an ATI-issued certificate) and stay upload-only.
  lsa2_checklist: 'applicants-checklist.docx',
  lsa2_updated_profile: {
    file: 'farm-profile-farming.docx',
    variants: {
      agri_processing: 'farm-profile-agri-processing.docx',
      agri_processing_enterprise: 'farm-profile-agri-processing.docx',
    },
  },
  lsa2_qualification_form: 'qualification-form.docx',
  lsa2_field_validation_report: 'field-validation-report.docx',
  lsa2_acceptance_form: 'acceptance-to-lsa.docx',
  lsa2_rtwg_endorsement: 'endorsement-checklist.docx',
};

/** The filename that backs a type for this applicant, or null. */
function formFileFor(type, applicant = {}) {
  const entry = FORM_FILES[type];
  if (!entry) return null;
  if (typeof entry === 'string') return entry;
  const variant = entry.variants && entry.variants[applicant.classification];
  return variant || entry.file;
}

/** Absolute path to the prescribed form for a type, or null if no file exists. */
function resolvePrescribed(type, applicant = {}) {
  const file = formFileFor(type, applicant);
  if (!file) return null;
  // file comes from our own map, never user input; the existence check is what
  // makes availability follow the folder.
  const abs = path.join(PRESCRIBED_DIR, file);
  return fs.existsSync(abs) ? abs : null;
}

/** True when a downloadable prescribed form actually exists on disk. */
function hasPrescribedForm(type, applicant = {}) {
  return resolvePrescribed(type, applicant) !== null;
}

module.exports = {
  PRESCRIBED_DIR,
  FORM_FILES,
  formFileFor,
  resolvePrescribed,
  hasPrescribedForm,
};
