/**
 * LSA-08 — the minimum farm area rule.
 *
 * The guidelines set a floor on farm size, with two exceptions. The system
 * captured `farm_area` and printed the rule as prose in the briefer and on two
 * checklist labels, but nothing ever compared the two — a 50 sq.m. plot could be
 * accredited without a single warning.
 *
 * Source: LSA Briefer, Farm Requirements — "Minimum 1,000 sq.m. farm area
 * (except urban/peri-urban, no minimum; and CocoLSA, 1 ha.)".
 */

/** Square metres in a hectare. */
const HECTARE = 10000;

const DEFAULT_MINIMUM = 1000;
const COCO_MINIMUM = HECTARE;

/**
 * The minimum area this applicant's farm must meet, and why.
 *
 * @param {{classification?: string, lsaType?: string}} applicant
 * @returns {{minimum: number, rule: string}} minimum of 0 means no floor applies
 */
function minimumAreaFor(applicant = {}) {
  const classification = String(applicant.classification || '').toLowerCase();
  const lsaType = String(applicant.lsaType || '').toLowerCase();

  // Urban and peri-urban gardens are exempt — the guidelines ask only that they
  // be productive, because city plots cannot meet a rural floor.
  if (classification === 'urban_agriculture') {
    return { minimum: 0, rule: 'Urban and peri-urban agriculture has no minimum area, but must be productive.' };
  }

  if (lsaType === 'coco') {
    return { minimum: COCO_MINIMUM, rule: 'Coco-LSA requires at least 1 hectare (10,000 sq.m.).' };
  }

  return { minimum: DEFAULT_MINIMUM, rule: 'A Learning Site requires at least 1,000 sq.m.' };
}

/**
 * Does this farm meet its minimum?
 *
 * @param {{farmArea?: number|string, classification?: string, lsaType?: string}} applicant
 * @returns {{meets: boolean|null, minimum: number, area: number|null, rule: string, shortfall: number}}
 *          meets is null when no area has been recorded yet — "not stated" is
 *          not the same as "too small".
 */
function checkArea(applicant = {}) {
  const { minimum, rule } = minimumAreaFor(applicant);
  const raw = applicant.farmArea;
  const area = raw === null || raw === undefined || raw === '' ? null : Number(raw);

  if (area === null || Number.isNaN(area) || area <= 0) {
    return { meets: null, minimum, area: null, rule, shortfall: 0 };
  }
  return {
    meets: area >= minimum,
    minimum,
    area,
    rule,
    shortfall: Math.max(0, minimum - area),
  };
}

/** A short sentence for a form or a report. */
function describe(applicant = {}) {
  const r = checkArea(applicant);
  if (r.meets === null) return 'Farm area has not been recorded yet. ' + r.rule;
  if (r.meets) return `${r.area.toLocaleString()} sq.m. meets the requirement.`;
  return `${r.area.toLocaleString()} sq.m. is ${r.shortfall.toLocaleString()} sq.m. short. ${r.rule}`;
}

module.exports = { minimumAreaFor, checkArea, describe, DEFAULT_MINIMUM, COCO_MINIMUM, HECTARE };
