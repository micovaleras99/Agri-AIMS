/**
 * Provision of Assistance (PDF p.26-29).
 *
 * Every figure and rule here is quoted from the guidelines:
 *   p.26  two kinds of assistance an LSA may receive
 *   p.27  up to PhP 150,000 for facility enhancement, PhP 100,000 for calamity;
 *         in-cash, in-kind or a combination; breakdown of expenditure items
 *         attached to the Development Plan; quarterly Project Completion Report
 *         required by the COA
 *   p.28  documentary evidence required for calamity assistance
 *   p.29  the request must be submitted within three months of the disaster
 */

/** PDF p.26 — what an LSA may be given. */
const ASSISTANCE_TYPES = [
  {
    key: 'financial_technical',
    label: 'Financial and Technical Assistance',
    detail:
      'Priority is given to those who relatively need more assistance, based on the assessment ' +
      'and evaluation and the submitted Development Plan.',
  },
  {
    key: 'technical_only',
    label: 'Technical Assistance Only',
    detail:
      'Developed farms and agri-processing enterprises operating successfully that do not require ' +
      'financial assistance, and government institutions, which have their own funds.',
  },
];

/** PDF p.27 — the two financial assistance ceilings, in pesos. */
const ASSISTANCE_KINDS = [
  { key: 'facility', label: 'Facility Enhancement', cap: 150000 },
  { key: 'calamity', label: 'Calamity Assistance', cap: 100000 },
];

const CAPS = Object.fromEntries(ASSISTANCE_KINDS.map((k) => [k.key, k.cap]));

/** PDF p.27 — "in-cash, in-kind, or a combination of two". */
const RELEASE_FORMS = [
  { key: 'cash', label: 'In cash' },
  { key: 'in_kind', label: 'In kind' },
  { key: 'combination', label: 'Combination of cash and in kind' },
];

/**
 * PDF p.28 — documentary evidence, calamity requests only.
 *
 * Each item carries a key so an uploaded file can say which of the three it
 * is, and the page can show what is still outstanding. The wording is quoted
 * from the guidelines and is what the request form displays.
 */
const CALAMITY_EVIDENCE_ITEMS = [
  { key: 'calamity_damage_media', label: 'Pictures or videos showing the damages on the LSA' },
  { key: 'calamity_lgu_certification', label: 'Certification from the LGU Agriculture Office that the damages are due to the named disaster' },
  { key: 'calamity_reconstruction_plan', label: 'Proposal on how the LSA will be reconstructed or re-developed, with a detailed breakdown of expenditure items' },
];

/** The same three as plain text, for the warning box on the request form. */
const CALAMITY_EVIDENCE = CALAMITY_EVIDENCE_ITEMS.map((e) => e.label);

/** @param {string} key @returns {string|null} */
function evidenceLabel(key) {
  const found = CALAMITY_EVIDENCE_ITEMS.find((e) => e.key === key);
  return found ? found.label : null;
}

/** PDF p.29 — the request window after a disaster. */
const CALAMITY_WINDOW_MONTHS = 3;

/** PDF p.29 — review stages, in order. */
const ASSISTANCE_STAGES = [
  { key: 'submitted', label: 'Request submitted to the ATI Training Center' },
  { key: 'under_review', label: 'Reviewed by the PASS of the RTC for authenticity and soundness' },
  { key: 'inspected', label: 'Ocular inspection undertaken to validate the documents and damages' },
  { key: 'approved', label: 'Approved — supplemental Memorandum of Agreement executed' },
  { key: 'rejected', label: 'Not approved' },
];

/** Whole months between two dates, used for the calamity window. */
function monthsBetween(from, to = new Date()) {
  const a = new Date(from);
  const b = new Date(to);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  return (b.getTime() - a.getTime()) / (30.44 * 24 * 60 * 60 * 1000);
}

/**
 * Validates a request against the guidelines.
 *
 * @param {{kind:string, amountRequested:number, disasterDate?:string, requestedAt?:string}} req
 * @param {Array<{amount:number}>} items  the expenditure breakdown
 * @returns {string[]} problems, empty when the request is acceptable
 */
function validateRequest(req, items = []) {
  const errors = [];
  const cap = CAPS[req.kind];

  if (!cap) {
    errors.push('Choose whether this is facility enhancement or calamity assistance.');
    return errors;
  }

  const amount = Number(req.amountRequested);
  if (!Number.isFinite(amount) || amount <= 0) {
    errors.push('Enter the amount being requested.');
  } else if (amount > cap) {
    errors.push(
      `The guidelines allow up to PhP ${cap.toLocaleString('en-PH')} for ` +
        `${ASSISTANCE_KINDS.find((k) => k.key === req.kind).label.toLowerCase()}.`
    );
  }

  // p.27 — the breakdown is what justifies the amount, so it has to add up.
  if (!items.length) {
    errors.push('Attach a detailed breakdown of the expenditure items.');
  } else {
    const total = items.reduce((s, i) => s + Number(i.amount || 0), 0);
    if (Number.isFinite(amount) && Math.round(total) !== Math.round(amount)) {
      errors.push(
        `The expenditure items total PhP ${total.toLocaleString('en-PH')}, which does not match ` +
          `the PhP ${amount.toLocaleString('en-PH')} requested.`
      );
    }
  }

  if (req.kind === 'calamity') {
    if (!req.disasterDate) {
      errors.push('Name the date of the disaster event.');
    } else {
      const months = monthsBetween(req.disasterDate, req.requestedAt || new Date());
      if (months === null) {
        errors.push('That disaster date is not a valid date.');
      } else if (months < 0) {
        errors.push('The disaster date is in the future.');
      } else if (months > CALAMITY_WINDOW_MONTHS) {
        errors.push(
          `Calamity assistance must be requested within ${CALAMITY_WINDOW_MONTHS} months of the ` +
            `disaster; this one occurred about ${months.toFixed(1)} months ago.`
        );
      }
    }
  }

  return errors;
}

module.exports = {
  ASSISTANCE_TYPES,
  ASSISTANCE_KINDS,
  CAPS,
  RELEASE_FORMS,
  CALAMITY_EVIDENCE,
  CALAMITY_EVIDENCE_ITEMS,
  evidenceLabel,
  CALAMITY_WINDOW_MONTHS,
  ASSISTANCE_STAGES,
  validateRequest,
  monthsBetween,
};
