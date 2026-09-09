/**
 * The accreditation checklists, in one place.
 *
 * These used to be declared inside the GET handlers in routes/accreditation.js,
 * which meant the POST handler that recorded the answers could not see the
 * questions. It counted the ticked boxes, stored the total, and discarded which
 * items had actually been met — so the system could say a farm scored 81% but
 * not whether it had a wash area.
 *
 * Both the page and the recorder now read from here, and the recorder stores the
 * label alongside the answer so an old report still reads correctly after the
 * wording of a question changes.
 *
 * Sources are the DA-ATI LSA I and II guidelines; the section is noted per group.
 */

/**
 * The 7 steps, in the order routes/accreditation.js actually implements them.
 *
 * This was declared three times — the accreditation overview, the tracker on the
 * application page, and the chatbot — and the three disagreed. The tracker had
 * Document Review at step 2 and Self-Assessment at step 3, which is backwards:
 * the applicant self-assesses eligibility (ATI-QF-PAD-164) BEFORE submitting
 * documents, and ATI evaluates those documents afterwards at step 4. Five of its
 * seven labels were wrong, so an applicant reading the tracker was told to do
 * things in an order the system does not support.
 */
const ACCREDITATION_STEPS = [
  { step: 1, label: 'Briefing', who: 'Applicant', icon: 'book', color: 'primary', desc: 'Read and acknowledge the LSA Briefer (ATI-QF-PAD-162)' },
  { step: 2, label: 'Self-Assessment', who: 'Applicant', icon: 'clipboard-check', color: 'info', desc: 'Complete eligibility self-assessment (ATI-QF-PAD-164)' },
  { step: 3, label: 'Submit Documents', who: 'Applicant', icon: 'folder-plus', color: 'warning', desc: 'Upload all required documentary requirements' },
  { step: 4, label: 'Document Evaluation', who: 'Admin', icon: 'search', color: 'orange', desc: 'ATI reviews documents for completeness and legibility' },
  { step: 5, label: 'Field/Virtual Validation', who: 'Admin', icon: 'geo-alt', color: 'danger', desc: 'TWG conducts on-site or virtual farm inspection + geo-tag' },
  { step: 6, label: 'Endorsement to ATI-CO', who: 'Admin', icon: 'send-check', color: 'purple', desc: 'RTC endorses scanned documents to ATI Central Office' },
  { step: 7, label: 'Certificate & MOA', who: 'Admin', icon: 'award', color: 'success', desc: 'Director issues LSA Certificate and signs MOA/MOU' },
];

/**
 * LSA-20 — who may not become an LSA operator.
 *
 * The briefer listed these and step 1 displayed them, but the applicant was
 * never asked to answer. They are shared now so the briefer page and the
 * declaration on the same page cannot drift apart.
 */
const DISQUALIFICATION_GROUNDS = [
  'Public officials and employees',
  'Spouses of public officials',
  'Unmarried children under 18 years of age of public officials',
];

/**
 * The briefer's reference lists (ATI-QF-PAD-162). These were written inline in
 * routes/accreditation.js and shown only on screen; the generated PDF now
 * renders them too, so both read one copy rather than drifting — the same
 * mistake the LSA classification list already made three times.
 */
const FARM_REQUIREMENTS = [
  { item: 'Minimum 1,000 sq.m. farm area', note: 'Except urban/peri-urban (no minimum) and CocoLSA (1 ha.)' },
  { item: 'Technology Demonstration Area', note: 'With crops, livestock, fisheries, or processing demo' },
  { item: 'Holding Area', note: 'At least 30 participants capacity' },
  { item: 'Wash Area', note: 'For farm tools and equipment' },
  { item: 'Separate Comfort Rooms (Male/Female)', note: '' },
  { item: 'Safe and accessible by land transport', note: '' },
];

const OPERATOR_REQUIREMENTS = [
  { item: 'Graduate of Agriculture/Fisheries training', doc: 'Training certificate' },
  { item: 'Farm tiller / main operator (not just owner)', doc: '' },
  { item: 'Willing to demonstrate technologies', doc: '' },
  { item: 'Farmer-leader or community-respected', doc: 'Certificate of Good Standing from Brgy. Captain' },
  { item: 'Willing to be trained regularly', doc: '' },
  { item: 'Physically fit', doc: 'Medical Certificate' },
  { item: 'Filipino citizen', doc: 'Birth Certificate (if required)' },
  { item: 'Registered in RSBSA (DA)', doc: 'RSBSA Certificate / NCFRS for coconut' },
  { item: 'Willing to serve as LSA for 5 years', doc: '' },
];

const BRIEFER_META = {
  formCode: 'ATI-QF-PAD-162 Rev. 00 · Effectivity Date: August 2, 2022',
  title: 'Learning Site for Agriculture',
  subtitle: 'HOW TO BECOME A LEARNING SITE FOR AGRICULTURE',
  overview: [
    'A farm that practices applicable agricultural technologies, employs doable farming '
      + 'strategies, and operates successfully, thus worthy of emulation. The Farmer/Farm '
      + 'Family is relatively advanced compared to the rest of the farmers.',
    'The LSA includes a successful agri-processing enterprise owned by a processor who is '
      + 'not necessarily a farmer/farm family.',
  ],
  processingNote: 'Farmers and non-farmers engaged in processing of fruits & vegetables, meat, '
    + 'fish, and agricultural products including by-products.',
};

/** Step 2 — self-assessment, ATI-QF-PAD-164. */
const FARM_CHECKLIST = [
  { id: 'f1', category: 'Farm', label: 'The farm can be privately-owned, RBO-operated, or Government-owned' },
  { id: 'f2', category: 'Farm', label: 'Farm is integrated/diversified, specialized, or demonstrates AF technologies' },
  { id: 'f3', category: 'Farm', label: 'Has Technology Demonstration Area (min. 1,000 sq.m.)', facility: 'tda' },
  { id: 'f4', category: 'Farm', label: 'Has Holding Area (accommodates at least 30 participants)', facility: 'holding_area' },
  { id: 'f5', category: 'Farm', label: 'Has Wash Area for tools and equipment', facility: 'wash_area' },
  { id: 'f6', category: 'Farm', label: 'Has Toilet/Comfort Room (separate for male and female)', facility: 'toilet' },
  { id: 'f7', category: 'Farm', label: 'Accessible by land and other transportation facilities' },
];

const OPERATOR_CHECKLIST = [
  { id: 'o1', category: 'Operator', label: 'Graduate of Agriculture/Fisheries training courses relevant to LSA' },
  { id: 'o2', category: 'Operator', label: 'Farm tiller — main actor in farm operation, not just owner/business person' },
  { id: 'o3', category: 'Operator', label: 'Willing and able to demonstrate technologies to clientele at any time' },
  { id: 'o4', category: 'Operator', label: 'Farmer-leader or respected in the community' },
  { id: 'o5', category: 'Operator', label: 'Willing to be trained regularly by ATI' },
  { id: 'o6', category: 'Operator', label: 'Physically fit to perform responsibilities as LSA operator' },
  { id: 'o7', category: 'Operator', label: 'Filipino citizen residing in the Philippines' },
  { id: 'o8', category: 'Operator', label: 'Registered in RSBSA (DA) or NCFRS (PCA for coconut)' },
  { id: 'o9', category: 'Operator', label: 'Willing to sustain operation as LSA I for five (5) years' },
];

const DOC_CHECKLIST = [
  { id: 'd1', category: 'Documents', label: 'Proof of land ownership (land title, tax declaration, or legal use agreement)' },
  { id: 'd2', category: 'Documents', label: 'Certificate of training from recognized institution' },
  { id: 'd3', category: 'Documents', label: 'Certificate of Good Standing from Barangay Captain' },
  { id: 'd4', category: 'Documents', label: 'Medical Certificate from licensed physician' },
  { id: 'd5', category: 'Documents', label: 'RSBSA Certificate / NCFRS Registration' },
];

/** Step 5 — TWG physical inspection. */
const VALIDATION_CHECKLIST = [
  { id: 'vc1', category: 'Farm Facilities', label: 'Technology Demonstration Area exists and is operational', facility: 'tda' },
  { id: 'vc2', category: 'Farm Facilities', label: 'Holding Area can accommodate at least 30 participants', facility: 'holding_area' },
  { id: 'vc3', category: 'Farm Facilities', label: 'Wash Area is present and functional', facility: 'wash_area' },
  { id: 'vc4', category: 'Farm Facilities', label: 'Separate comfort rooms for male and female are available', facility: 'toilet' },
  { id: 'vc5', category: 'Farm Facilities', label: 'Farm is accessible by land and other transportation' },
  { id: 'vc6', category: 'Farm Area', label: 'Farm area meets minimum requirement (1,000 sq.m. or applicable)' },
  { id: 'vc7', category: 'Farm Operations', label: 'Farming or agri-processing operations are active and demonstrable' },
  { id: 'vc8', category: 'Farm Operations', label: 'Technologies being practiced are appropriate to declared classification' },
  { id: 'vc9', category: 'Operator', label: 'Operator is present and capable of demonstrating technologies' },
  { id: 'vc10', category: 'Operator', label: 'Operator is the main actor in farm operations (not just owner)' },
  { id: 'vc11', category: 'Records', label: 'Farm records (production, sales, visitors) are being maintained' },
  { id: 'vc12', category: 'Records', label: 'Training/activity logs are available for inspection' },
];

/**
 * How many of the ${VALIDATION_CHECKLIST.length} inspection items must be met for the farm to pass
 * field validation. The route and the live indicator on the form both grade
 * against this; they used to hardcode 10 separately, which is how the step
 * labels drifted apart in the first place.
 */
const VALIDATION_PASS_MARK = 10;

/** Every step-2 item, in the order the form presents them. */
const STEP2_ITEMS = [...FARM_CHECKLIST, ...OPERATOR_CHECKLIST, ...DOC_CHECKLIST];

/** Items for a given step, or an empty array for a step that has no checklist. */
function itemsForStep(step) {
  if (Number(step) === 2) return STEP2_ITEMS;
  if (Number(step) === 5) return VALIDATION_CHECKLIST;
  return [];
}

/**
 * The four basic facilities the guidelines require (PDF p.11). Both checklists
 * ask about them — step 2 as the applicant's own claim, step 5 as what the TWG
 * actually saw — so each item that maps to one carries a `facility` key.
 */
const FACILITIES = [
  { key: 'tda', label: 'Technology Demonstration Area' },
  { key: 'holding_area', label: 'Holding Area' },
  { key: 'wash_area', label: 'Wash Area' },
  { key: 'toilet', label: 'Toilet / Comfort Room' },
];

/**
 * The four facilities as saveResponses() items. `id` doubles as the checkbox
 * field name and the stored item_code, so it uses the farm checklist's existing
 * short codes (f3..f6 — Technology Demo Area, Holding Area, Wash Area, Toilet)
 * to fit item_code VARCHAR(16) and stay consistent with the rest of the
 * checklist. `facility` is the key facilityStatus() groups by. One definition so
 * the two forms and the Basic Facilities panel can never drift apart.
 */
const FACILITY_CODE = { tda: 'f3', holding_area: 'f4', wash_area: 'f5', toilet: 'f6' };
const FACILITY_ITEMS = FACILITIES.map((f) => ({
  id: FACILITY_CODE[f.key],
  facility: f.key,
  label: f.label,
  category: 'Farm',
}));

module.exports = {
  ACCREDITATION_STEPS,
  DISQUALIFICATION_GROUNDS,
  FARM_REQUIREMENTS,
  OPERATOR_REQUIREMENTS,
  BRIEFER_META,
  VALIDATION_PASS_MARK,
  FARM_CHECKLIST,
  OPERATOR_CHECKLIST,
  DOC_CHECKLIST,
  VALIDATION_CHECKLIST,
  STEP2_ITEMS,
  FACILITIES,
  FACILITY_ITEMS,
  itemsForStep,
};
