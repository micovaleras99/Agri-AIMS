/**
 * Convert DB snake_case keys to camelCase for EJS / JSON clients.
 */

function snakeToCamel(str) {
  return str.replace(/_([a-z])/g, (_, ch) => ch.toUpperCase());
}

function camelToSnake(str) {
  return str.replace(/[A-Z]/g, (ch) => `_${ch.toLowerCase()}`);
}

/**
 * @param {Record<string, unknown>} row
 * @returns {Record<string, unknown>}
 */
const BOOL_SNAKE = new Set(['step1_briefer_signed', 'step2_qualified']);

function rowToCamel(row) {
  if (!row) return row;
  const out = {};
  for (const [key, val] of Object.entries(row)) {
    const camel = snakeToCamel(key);
    if (BOOL_SNAKE.has(key) && (val === 0 || val === 1 || val === true || val === false)) {
      out[camel] = Boolean(val);
    } else {
      out[camel] = val;
    }
  }
  return out;
}

/**
 * Normalize booleans and DATE fields for views that expect strings "YYYY-MM-DD".
 * @param {Record<string, unknown>} obj
 */
/**
 * EJS templates historically used keys like step1_brieferDate (not step1BrieferDate).
 * Duplicate those aliases onto the object for backward compatibility.
 * @param {Record<string, unknown>} o
 */
function applyLegacyApplicantAliases(o) {
  if (!o) return o;
  const pairs = [
    ['step1BrieferSigned', 'step1_brieferSigned'],
    ['step1BrieferDate', 'step1_brieferDate'],
    ['step1AcknowledgedBy', 'step1_acknowledgedBy'],
    ['step2SelfAssessmentScore', 'step2_selfAssessmentScore'],
    ['step2Qualified', 'step2_qualified'],
    ['step2CompletedDate', 'step2_completedDate'],
    ['step2Remarks', 'step2_remarks'],
    ['step3SubmittedDate', 'step3_submittedDate'],
    ['step3DocsSubmitted', 'step3_docsSubmitted'],
    ['step3DocsRequired', 'step3_docsRequired'],
    ['step3ReceivedBy', 'step3_receivedBy'],
    ['step4EvalDate', 'step4_evalDate'],
    ['step4EvalResult', 'step4_evalResult'],
    ['step4EvalRemarks', 'step4_evalRemarks'],
    ['step4EvalBy', 'step4_evalBy'],
    ['step5ValidationDate', 'step5_validationDate'],
    ['step5ValidationType', 'step5_validationType'],
    ['step5ValidationResult', 'step5_validationResult'],
    ['step5CheckedItems', 'step5_checkedItems'],
    ['step5TwgRemarks', 'step5_twgRemarks'],
    ['step5InspectedBy', 'step5_inspectedBy'],
    ['step6EndorsedDate', 'step6_endorsedDate'],
    ['step6EndorsedBy', 'step6_endorsedBy'],
    ['step6EndorsementNo', 'step6_endorsementNo'],
    ['step6EndorseRemarks', 'step6_endorseRemarks'],
    ['step7CertificateNo', 'step7_certificateNo'],
    ['step7IssueDate', 'step7_issueDate'],
    ['step7ValidUntil', 'step7_validUntil'],
    ['step7MoaDate', 'step7_moaDate'],
    ['step7IssuedBy', 'step7_issuedBy'],
    ['step7MoaRemarks', 'step7_moaRemarks'],
  ];
  for (const [modern, legacy] of pairs) {
    if (o[modern] !== undefined) o[legacy] = o[modern];
  }
  return o;
}

function normalizeApplicantForView(obj) {
  const o = { ...obj };
  const dateKeys = [
    'submissionDate', 'geoTaggedDate', 'step1BrieferDate', 'step2CompletedDate',
    'step3SubmittedDate', 'step4EvalDate', 'step5ValidationDate', 'step6EndorsedDate',
    'step7IssueDate', 'step7ValidUntil', 'step7MoaDate',
  ];
  for (const k of dateKeys) {
    if (o[k] instanceof Date) {
      o[k] = o[k].toISOString().split('T')[0];
    }
  }
  // mysql2 returns DECIMAL as a string to preserve precision, so latitude and
  // longitude arrived as "13.6218000". Views call .toFixed(4) on them, which
  // threw and killed the GIS map's applicant pins. farmModel already coerces
  // these; applicants did not. Coordinates are safe as doubles — the money
  // DECIMALs elsewhere are deliberately left as strings.
  for (const k of ['latitude', 'longitude']) {
    if (o[k] != null && o[k] !== '') o[k] = Number(o[k]);
  }

  applyLegacyApplicantAliases(o);
  return o;
}

module.exports = { rowToCamel, camelToSnake, snakeToCamel, normalizeApplicantForView, applyLegacyApplicantAliases };
