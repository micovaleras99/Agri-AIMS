/**
 * Shared accreditation step transitions (used by routes/accreditation.js).
 */

const applicantModel = require('../models/applicantModel');

/**
 * Overall progress as a real fraction of the 7 steps completed, not a hand-tuned
 * curve. You are working ON `accreditationStep`, so the steps before it are the
 * ones done; a fully approved application is 100%. This is the single source the
 * stored `progress` and every display read from, so the bar always matches the
 * "Step N of 7" it sits beside.
 */
function progressFor(step, status) {
  if (status === 'approved') return 100;
  const completed = Math.max(0, (Number(step) || 1) - 1);
  return Math.round((completed / 7) * 100);
}

const STEP_STATUS = {
  1: 'submitted',
  2: 'submitted',
  3: 'document_review',
  4: 'document_review',
  5: 'under_review',
  6: 'under_review',
  7: 'approved',
};

// The progress on arriving at each step, derived from the one formula and that
// step's status — so reaching step 7 (which this system treats as approved) is
// 100%, and the earlier steps are their real fraction of the seven.
const STEP_PROGRESS = Object.fromEntries(
  [1, 2, 3, 4, 5, 6, 7].map((s) => [s, progressFor(s, STEP_STATUS[s])]),
);

async function getApplicant(id) {
  return applicantModel.findById(parseInt(id, 10));
}

async function advanceStep(id, step, extraFields = {}) {
  const applicant = await getApplicant(id);
  if (!applicant) return false;
  // The final status decides progress — advancing to step 7 to award the
  // certificate carries status:'approved', which is 100%, while merely reaching
  // step 7 to await it is not.
  const status = extraFields.status ?? STEP_STATUS[step] ?? applicant.status;
  await applicantModel.patch(parseInt(id, 10), {
    accreditationStep: step,
    status,
    progress: progressFor(step, status),
    ...extraFields,
  });
  return true;
}

/**
 * May Step 4 be passed?
 *
 * Every submitted document must have been decided and accepted. Passing Step 4
 * moves the application to field validation and, at Step 6, builds the
 * endorsement packet from `status = 'verified'` rows only — so a pass with
 * documents still pending would endorse an application on paperwork nobody
 * looked at, and the packet would silently leave out the rest.
 *
 * This is a rule the system enforces, not one quoted from the Guidelines: the
 * Guidelines say Step 4 is where documents are reviewed for "completeness and
 * legibility" and do not spell out what blocks a pass.
 *
 * Note what is deliberately NOT required: the full checklist from
 * requirementsFor(). Three of those documents — the Field Validation Report,
 * the RTWG endorsement, the checklist itself — are produced by ATI at Steps 5
 * and 6, after this one. Demanding them here would deadlock the procedure.
 *
 * @param {Array<{status: string}>} docs  every document on the application
 * @returns {{ ok: boolean, reason: string|null, pending: number, rejected: number }}
 */
function canPassStep4(docs) {
  const pending = docs.filter((d) => d.status === 'pending_review').length;
  const rejected = docs.filter((d) => d.status === 'incomplete').length;

  if (!docs.length) {
    return { ok: false, reason: 'No documents have been submitted yet.', pending, rejected };
  }
  if (pending || rejected) {
    const parts = [];
    if (pending) parts.push(`${pending} still awaiting a decision`);
    if (rejected) parts.push(`${rejected} marked for revision`);
    return {
      ok: false,
      reason: `Every document must be accepted before this step can be passed — ${parts.join(' and ')}.`,
      pending,
      rejected,
    };
  }
  return { ok: true, reason: null, pending, rejected };
}

module.exports = {
  canPassStep4,
  getApplicant,
  advanceStep,
  progressFor,
  STEP_PROGRESS,
  STEP_STATUS,
};
