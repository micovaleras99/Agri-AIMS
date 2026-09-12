/**
 * Field mapping for populating the official Self-Assessment DOCX
 * (forms/prescribed/self-assessment.docx) — DATABASE VALUE -> DOCX LOCATION.
 *
 * The DOCX has no machine-readable placeholders, so values are placed by the
 * document's own structure (see services/docxFill.js):
 *   - Basic Information is a label/value table: each `label` prefix is found and
 *     its following value cell is filled.
 *   - The qualifications matrix has five columns per row
 *     (# | Qualifications | Documents Needed | Write (/) or (x) | Remarks); each
 *     checklist row is located by a distinctive prefix of its Qualifications text
 *     and a "/" (yes) or "x" (no) is written into its 4th cell.
 *
 * Several rows (Wash Area, Toilet, "Willing to serve as LSA I…", etc.) appear in
 * BOTH the Farming and Agri-Processing sections, so every checklist row is tagged
 * with the `section` it belongs to and marking is scoped to that section.
 *
 * `code` is the assessment_responses.item_code the applicant answered on-screen
 * at Step 2. Facility rows reuse f3–f6 (+ a `facility` key) and operator rows
 * reuse o1–o9 so Step-5 field validation and the Basic Facilities panel keep
 * reading the same answers. Because an applicant completes only one section, the
 * reused codes never collide.
 *
 * `locate` strings are verbatim prefixes from word/document.xml — re-extract the
 * DOCX (services/docxFill.js readZip) before changing them.
 */

/** Basic Information: DOCX label prefix -> value from the applicant record. */
const BASIC_INFO = [
  { label: 'Name of Farm', value: (a) => a.farmName || '' },
  { label: 'Name of Owner', value: (a) => `${a.firstName || ''} ${a.lastName || ''}`.trim() },
  { label: 'Address', value: (a) => a.completeAddress || '' },
  { label: 'Area (ha)', value: (a) => (a.farmArea ? String(a.farmArea) : '') },
  { label: 'Date Established', value: (a) => a.farmEstablishedDate || '' },
];

/** Required Basic Information for a valid form. */
const REQUIRED = [
  { key: 'farmName', label: 'Farm Name' },
  { key: 'completeAddress', label: 'Complete Address' },
  { key: 'farmArea', label: 'Farm Area' },
  { key: 'farmEstablishedDate', label: 'Date Established' },
];

const FARMING_ROWS = [
  { code: 'fo_priv', locate: 'Privately-owned' },
  { code: 'fo_rbo', locate: 'RBO-owned/operated farm' },
  { code: 'fo_gov', locate: 'Government-owned' },
  { code: 'fp_integ', locate: 'Integrated-diversified' },
  { code: 'fp_spec', locate: 'A specialized farm producing' },
  { code: 'fp_af', locate: 'A farm demonstrating' },
  { code: 'f3', facility: 'tda', locate: 'Technology Demonstration area/facilities (' },
  { code: 'f4', facility: 'holding_area', locate: 'Holding Area' },
  { code: 'f5', facility: 'wash_area', locate: 'Wash Area' },
  { code: 'f6', facility: 'toilet', locate: 'Toilet' },
  { code: 'f7', locate: 'Accessible by land and other transportation' },
  { code: 'o1', locate: 'Graduate of Training courses/programs relevant to Agriculture/Fisheries' },
  { code: 'o2', locate: 'Farm tiller or should be the main actor' },
  { code: 'o3', locate: 'Willing and able to demonstrate' },
  { code: 'o4', locate: 'Is a farmer-leader or is respected' },
  { code: 'o5', locate: 'Willing to be trained regularly' },
  { code: 'o6', locate: 'Physically fit to perform the responsibilities' },
  { code: 'o7', locate: 'A Filipino citizen residing in the country' },
  { code: 'o8', locate: 'Registered in the Registry System for Basic Sector' },
  { code: 'o9', locate: 'Willing to serve as LSA I for five years' },
  { code: 'f_gstaff', locate: 'For Government Owned' },
];

const AGRI_ROWS = [
  { code: 'ao_priv', locate: 'Privately-owned' },
  { code: 'ao_rbo', locate: 'RBO-owned/operated farm' },
  { code: 'ao_gov', locate: 'Government-owned' },
  { code: 'f3', facility: 'tda', locate: 'Technology Demonstration area/facilities' },
  { code: 'f4', facility: 'holding_area', locate: 'Holding Area' },
  { code: 'f5', facility: 'wash_area', locate: 'Wash Area' },
  { code: 'f6', facility: 'toilet', locate: 'Toilet' },
  { code: 'ap_multi', locate: 'Multi-product or specialized' },
  { code: 'f7', locate: 'Accessible by land and other transportation' },
  { code: 'o1', locate: 'Graduate of Training courses/programs relevant to Agriculture/Fisheries Processing' },
  { code: 'o2', locate: 'Main actor in the operation of the enterprise' },
  { code: 'o3', locate: 'Willing and able to demonstrate' },
  { code: 'o4', locate: 'Is a leader or is respected in the community' },
  { code: 'o5', locate: 'Willing to be trained regularly' },
  { code: 'o6', locate: 'Physically fit to perform the responsibilities' },
  { code: 'o7', locate: 'A Filipino citizen residing in the country' },
  { code: 'ap_equip', locate: 'Recipient of processing equipment and facilities' },
  { code: 'ap_award', locate: 'related awards from credible' },
  { code: 'o9', locate: 'Willing to serve as LSA I for five years' },
  { code: 'ap_gstaff', locate: 'For Government Owned' },
];

/** Human-readable labels for the on-screen checklist, keyed by locate text. */
const LABELS = {
  fo_priv: 'Privately-owned', fo_rbo: 'RBO-owned / operated (4H Club, RIC, cooperative, etc.)',
  fo_gov: 'Government-owned',
  fp_integ: 'Integrated / diversified farm',
  fp_spec: 'A specialized farm producing a specific commodity in sizable volume',
  fp_af: 'A farm demonstrating agri-fishery technology/ies',
  f3: 'Technology Demonstration Area / facilities', f4: 'Holding Area',
  f5: 'Wash Area', f6: 'Toilet / Comfort Room',
  f7: 'Accessible by land and other transportation',
  o1: 'Graduate of relevant Agriculture/Fisheries training',
  o2: 'Main actor / farm tiller in the operation (not just owner)',
  o3: 'Willing and able to demonstrate technologies to clientele',
  o4: 'Farmer-leader or respected in the community',
  o5: 'Willing to be trained regularly',
  o6: 'Physically fit to perform LSA responsibilities',
  o7: 'A Filipino citizen residing in the country',
  o8: 'Registered in RSBSA (DA) / NCFRS (PCA for coconut)',
  o9: 'Willing to serve as LSA I for five (5) years',
  f_gstaff: 'For government-owned: staff permanently assigned to maintain and demonstrate technologies',
  ao_priv: 'Privately-owned', ao_rbo: 'RBO-owned / operated (4H Club, RIC, cooperative, etc.)',
  ao_gov: 'Government-owned',
  ap_multi: 'Multi-product or specialized',
  ap_equip: 'Recipient of processing equipment/facilities or other DA/DTI/DOST benefits',
  ap_award: 'Recipient of agri-processing related awards from credible institutions',
  ap_gstaff: 'For government-owned: staff permanently assigned to maintain and demonstrate technologies',
};

const SECTIONS = {
  farming: { key: 'farming', title: 'For Farming LSA', rows: FARMING_ROWS },
  agri: { key: 'agri', title: 'For Agri-Processing LSA', rows: AGRI_ROWS },
};

/** The enterprise type (and thus the DOCX section) for an applicant. */
function sectionKeyFor(applicant = {}) {
  const c = String(applicant.classification || '').toLowerCase();
  return c.includes('agri_process') || c.includes('processing') ? 'agri' : 'farming';
}

/** The checklist rows an applicant answers on-screen, as saveResponses() items. */
function itemsFor(applicant) {
  return SECTIONS[sectionKeyFor(applicant)].rows.map((r) => ({
    id: r.code,
    category: SECTIONS[sectionKeyFor(applicant)].title,
    label: LABELS[r.code] || r.locate,
    facility: r.facility || null,
  }));
}

module.exports = {
  BASIC_INFO, REQUIRED, SECTIONS, LABELS,
  sectionKeyFor, itemsFor,
};
