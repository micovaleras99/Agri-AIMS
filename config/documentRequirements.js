/**
 * LSA I documentary requirements (ATI List of Documentary Requirements).
 *
 * This list was copy-pasted into four places — routes/accreditation.js,
 * controllers/dashboardController.js, and twice inside document-submit.ejs —
 * which is why the category-specific requirements were missing everywhere: each
 * copy only ever carried the twelve that apply to a private farm.
 *
 * `appliesTo` is null for the twelve every applicant must submit. The rest are
 * conditional on what the applicant is, per the guidelines:
 *   - agri-processing enterprises: business permit, DTI/SEC, FDA (PDF p.13, p.18)
 *   - farmer/fisher organizations: board resolution, SEC/CDA, BIR (PDF p.18)
 *   - government-owned sites: Special Order (PDF p.15, p.18)
 */

/** @typedef {{type:string,label:string,name:string,form:string,required:boolean,appliesTo:null|((a:object)=>boolean)}} DocRequirement */

const { LSA2_DOCUMENTS } = require('./lsa2');

const isAgriProcessing = (a) =>
  a.classification === 'agri_processing' || a.classification === 'agri_processing_enterprise';
const isOrganization = (a) => a.category === 'organization';
const isGovernment = (a) => a.category === 'government';

const RAW = [
  ['signed_briefer', 'Signed Briefer', 'ATI-QF-PAD-162', null],
  ['self_assessment', 'Self-Assessment Form', 'ATI-QF-PAD-164', null],
  ['letter_of_intent', 'Letter of Intent', 'Addressed to ATI Director', null],
  ['endorsement', 'LGU / PLGU Endorsement Letter', 'MAO / PAO or PCA (Coco-LSA)', null],
  ['farm_profile', 'Farm/Agri-Enterprise Profile Form', 'ATI-QF-PAD-48', null],
  ['farm_layout', 'Farm Layout — Current & Existing', 'Areal View', null],
  ['medical_certificate', 'Medical Certificate', 'Licensed physician', null],
  ['good_standing', 'Certificate of Good Standing', 'Barangay Captain', null],
  ['training_certificates', 'Training Certificates', 'Agriculture / Fisheries / Agri-Processing', null],
  ['rsbsa_certificate', 'RSBSA Certificate', 'DA RSBSA / PCA NCFRS (Coco)', null],
  // The LSA Development Plan is a standard applicant submission with its own
  // prescribed form (client §10); it applies to every applicant.
  ['development_plan', 'LSA Development Plan', 'ATI-QF-PAD-97', null],
  ['land_title', 'Land Title / Tax Declaration', 'Certified True Copy', null],

  // p.19 — the rest of the packet compiled per applicant.
  ["lsa1_checklist", "Applicant's Checklist of Requirements I", 'LSA I', null],
  ['lsa1_qualification_form', 'LSA I Qualification Form', 'LSA I', null],
  ['lsa1_field_validation_report', 'Field Validation Report', 'LSA I', null],
  ['lsa1_acceptance_form', 'Acceptance to Become LSA I Form', 'LSA I', null],
  ['lsa1_rtwg_endorsement', 'Endorsement of the RTWG', 'LSA I', null],

  ['business_permit', "Mayor's / Business Permit", 'Agri-processing enterprise', isAgriProcessing],
  ['dti_sec_registration', 'DTI or SEC Registration', 'Agri-processing enterprise', isAgriProcessing],
  ['fda_registration', 'FDA Registration (LTO / CPR)', 'Agri-processing enterprise', isAgriProcessing],

  ['board_resolution', 'Board Resolution', 'Farmers/Fishers organization', isOrganization],
  ['org_registration', 'SEC / CDA / DOLE Registration', 'Farmers/Fishers organization', isOrganization],
  ['bir_registration', 'BIR Registration', 'Farmers/Fishers organization', isOrganization],

  ['special_order', 'Special Order', 'Government-owned site', isGovernment],
];

/**
 * Requirements the ATI administrator completes, not the applicant (client §7,
 * §8, §12, §13, §19): the field validation report, the acceptance form, the
 * RTWG endorsement, the applicant's checklist, and the qualification form. The
 * admin downloads the prescribed form, completes it, and uploads it; the
 * applicant never submits these. Everything else is the applicant's own.
 */
const ADMIN_OWNED = new Set([
  'lsa1_field_validation_report',
  'lsa1_acceptance_form',
  'lsa1_rtwg_endorsement',
  'lsa1_checklist',
  'lsa1_qualification_form',
]);

/** @type {DocRequirement[]} */
const DOCUMENT_REQUIREMENTS = RAW.map(([type, label, form, appliesTo]) => ({
  type,
  label,
  // Two consumers named this field differently; carry both so neither changed.
  name: label,
  form,
  required: true,
  appliesTo,
  responsible: ADMIN_OWNED.has(type) ? 'admin' : 'applicant',
}));

/**
 * The documents this particular applicant must submit — their own only. The
 * admin-owned forms are excluded here so they no longer appear on the
 * applicant's Step 3 checklist.
 * @param {{category?:string, classification?:string}} applicant
 * @returns {DocRequirement[]}
 */
function requirementsFor(applicant = {}) {
  return DOCUMENT_REQUIREMENTS.filter((d) =>
    d.responsible === 'applicant' && (!d.appliesTo || d.appliesTo(applicant)));
}

/**
 * The forms the administrator completes for this applicant.
 * @param {{category?:string, classification?:string}} applicant
 * @returns {DocRequirement[]}
 */
function adminRequirementsFor(applicant = {}) {
  return DOCUMENT_REQUIREMENTS.filter((d) =>
    d.responsible === 'admin' && (!d.appliesTo || d.appliesTo(applicant)));
}

/**
 * Everything the Documents module may accept: the LSA I requirements plus the
 * LSA II packet (PDF p.23). requirementsFor() deliberately does NOT include the
 * LSA II documents — those belong to an up-scaling application, not to the
 * original accreditation checklist.
 */
const ALL_DOCUMENT_TYPES = [...DOCUMENT_REQUIREMENTS, ...LSA2_DOCUMENTS];

/** type -> label, for the submit form's name lookup. */
const LABELS = Object.fromEntries(ALL_DOCUMENT_TYPES.map((d) => [d.type, d.label]));

/**
 * A readable, deterministic filename for an uploaded submission, built from the
 * document TYPE and the applicant — not the raw upload name — e.g.
 * "Letter-of-Intent-Juan-Dela-Cruz.pdf". The uploaded file's own extension is
 * kept. `fallbackLabel` covers a custom "other" type with no catalogue entry.
 */
function submissionFilename(type, applicant, originalName, fallbackLabel) {
  const slug = (s) => String(s || '').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-');
  const ext = (String(originalName || '').match(/\.[A-Za-z0-9]+$/) || [''])[0].toLowerCase();
  const base = slug(LABELS[type] || fallbackLabel || type) || 'Document';
  const who = applicant ? slug(`${applicant.firstName || ''} ${applicant.lastName || ''}`) : '';
  return `${base}${who ? `-${who}` : ''}${ext}`;
}

module.exports = {
  DOCUMENT_REQUIREMENTS, ALL_DOCUMENT_TYPES, requirementsFor, adminRequirementsFor, LABELS, submissionFilename,
};
