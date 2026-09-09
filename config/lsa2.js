/**
 * LSA I → LSA II up-scaling.
 *
 * Every string below is taken from the DA-ATI guidelines, not invented:
 *   - eligibility criteria: "Additional Requirements for LSA I to be up-scaled
 *     to LSA II" (PDF p.16)
 *   - the five steps: "Procedure in Certifying the LSA II" (PDF p.21)
 *   - the document list: "The documents to be submitted per applicant" (PDF p.23)
 *
 * Two of the four criteria can be answered from data the system already holds;
 * the other two are judgements the ATI has to make, so they are recorded as
 * staff decisions rather than guessed at.
 */

const MIN_YEARS_AS_LSA1 = 1;

/**
 * @typedef {{key:string,label:string,source:string,auto:boolean,detail?:string,met?:boolean}} Criterion
 */

/** PDF p.21 — the five steps, in order. */
const LSA2_STEPS = [
  { step: 1, label: 'Submission of documentary requirements', who: 'Applicant' },
  { step: 2, label: 'Evaluation of documentary requirements', who: 'ATI-RTC' },
  { step: 3, label: 'Field / Virtual Validation', who: 'TWG' },
  { step: 4, label: 'Endorsement to ATI-CO by the RTC', who: 'ATI-RTC' },
  { step: 5, label: 'Issuance of Certificate and MOA / MOU signing', who: 'ATI-CO' },
];

/** PDF p.23 — the packet submitted per applicant. */
const LSA2_DOCUMENTS = [
  { type: 'lsa2_checklist', label: "LSA II Applicant's Checklist of Requirements" },
  { type: 'lsa2_letter_of_intent', label: 'Letter of Intent to become Farming/Agri-Processing LSA II' },
  { type: 'lsa2_updated_profile', label: 'Updated Farm/Agri-Processing Enterprise Profile' },
  { type: 'lsa2_qualification_form', label: 'LSA II Qualification Form' },
  { type: 'lsa2_field_validation_report', label: 'Field Validation Report' },
  { type: 'lsa2_acceptance_form', label: 'Acceptance to Become LSA II Form' },
  { type: 'lsa2_rtwg_endorsement', label: 'Endorsement of the RTWG' },
  { type: 'lsa2_good_standing', label: 'Certificate of Good Standing as LSA' },
].map((d) => ({ ...d, name: d.label, form: 'LSA II', required: true, appliesTo: null }));

/** Whole years between a date and now, or null when there is no date. */
function yearsSince(dateish) {
  if (!dateish) return null;
  const from = new Date(dateish);
  if (Number.isNaN(from.getTime())) return null;
  return (Date.now() - from.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
}

/**
 * Evaluates the four criteria on PDF p.16 for one accredited farm.
 *
 * @param {{accreditedSince?:string, status?:string}} farm
 * @param {{approvedReports:number, completedTrainings:number}} evidence
 * @param {{competenceEnhanced?:boolean, valueChainCovered?:boolean}} [decisions]
 *        the two judgements ATI records; undefined means "not yet assessed"
 * @returns {{criteria:Criterion[], autoMet:number, eligible:boolean, pending:number}}
 */
function evaluateEligibility(farm = {}, evidence = {}, decisions = {}) {
  const years = yearsSince(farm.accreditedSince);
  const longEnough = years !== null && years >= MIN_YEARS_AS_LSA1;

  const criteria = [
    {
      key: 'certified_one_year',
      label: `Certified as an LSA for at least ${MIN_YEARS_AS_LSA1} year`,
      source: 'LSA Guidelines — Qualification Requirements (up-scaling)',
      auto: true,
      met: longEnough,
      detail: years === null
        ? 'No accreditation date recorded for this farm.'
        : `Accredited since ${farm.accreditedSince} — ${years.toFixed(1)} years.`,
    },
    {
      key: 'track_record',
      label: 'Track record of exceptional performance as LSA I',
      source: 'LSA Guidelines — established by reviewing monitoring and accomplishment reports',
      auto: true,
      met: (evidence.approvedReports || 0) > 0,
      detail: `${evidence.approvedReports || 0} approved monitoring report(s) on file.`,
    },
    {
      key: 'competence_enhanced',
      label: 'Farmer / farm family / owner competence enhanced',
      source: 'LSA Guidelines — assessed by ATI',
      auto: false,
      met: decisions.competenceEnhanced,
      detail: `${evidence.completedTrainings || 0} completed ATI training(s) recorded.`,
    },
    {
      key: 'value_chain',
      label: 'Farm activities cover the value chain',
      source: 'LSA Guidelines — assessed by ATI',
      auto: false,
      met: decisions.valueChainCovered,
      detail: 'Recorded by the evaluator after reviewing farm operations.',
    },
  ];

  return {
    criteria,
    autoMet: criteria.filter((c) => c.auto && c.met === true).length,
    pending: criteria.filter((c) => c.met === undefined || c.met === null).length,
    // All four must hold; an unassessed judgement is not a pass.
    eligible: criteria.every((c) => c.met === true),
  };
}

module.exports = { LSA2_STEPS, LSA2_DOCUMENTS, MIN_YEARS_AS_LSA1, evaluateEligibility, yearsSince };
