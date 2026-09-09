/**
 * Renewal / re-accreditation — Objective 2.5.
 *
 * The validity period was written inline in the Step 7 route as
 * `parseInt(issueDate) + 5`, so nothing else in the system could ask how long a
 * certificate lasts. It lives here now, and the certificate route reads it from
 * here, because the reminder job and the renewal screen have to agree with the
 * certificate or they are describing a different date.
 *
 * Five years is the Guidelines' own figure: the operator undertakes to "sustain
 * operation as LSA I for five (5) years" (checklist item o9), and Step 7 has
 * always issued a five-year certificate. Nothing here invents a period.
 */

/** Years a Learning Site accreditation runs before it must be renewed. */
const VALIDITY_YEARS = 5;

/**
 * How far ahead the operator is warned, in days.
 *
 * These are reminder cadence, not policy — the Guidelines set no notice period,
 * so this is deliberately a schedule rather than a rule, and changing it changes
 * nothing but when an email-style alert appears. Descending, so the reminder
 * that fires is always the closest window not yet used.
 */
const REMINDER_DAYS = [180, 90, 30, 7];

/** A farm is "expiring" once inside the widest reminder window. */
const EXPIRING_SOON_DAYS = REMINDER_DAYS[0];

/** Midnight-anchored days from today to `date`; negative once past. */
function daysUntil(date) {
  if (!date) return null;
  const then = date instanceof Date ? new Date(date) : new Date(String(date));
  if (Number.isNaN(then.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  then.setHours(0, 0, 0, 0);
  return Math.round((then - today) / 86400000);
}

/**
 * Where an accreditation stands today.
 *
 * `unknown` is a real state and is not "active": a farm with no expiry date on
 * record has not been shown to be current, and saying otherwise is the same
 * mistake the compliance score used to make.
 *
 * @param {string|Date|null} expiryDate
 * @returns {{ state: 'unknown'|'expired'|'expiring'|'active', days: number|null, label: string }}
 */
function validityStatus(expiryDate) {
  const days = daysUntil(expiryDate);
  if (days === null) return { state: 'unknown', days: null, label: 'No expiry date on record' };
  if (days < 0) return { state: 'expired', days, label: `Expired ${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} ago` };
  if (days <= EXPIRING_SOON_DAYS) return { state: 'expiring', days, label: `Expires in ${days} day${days === 1 ? '' : 's'}` };
  return { state: 'active', days, label: `Valid for ${days} more days` };
}

/**
 * The date a certificate issued on `from` runs until.
 * @param {string|Date} from  ISO date or Date
 * @returns {string} ISO date
 */
function validUntilFrom(from) {
  const d = from instanceof Date ? new Date(from) : new Date(String(from));
  if (Number.isNaN(d.getTime())) throw new Error('validUntilFrom: invalid date ' + from);
  d.setFullYear(d.getFullYear() + VALIDITY_YEARS);
  return d.toISOString().split('T')[0];
}

/**
 * The reminder window a farm currently sits in, or null when none applies.
 *
 * The tightest window it has ENTERED, which is the largest number it is now
 * under: a farm 100 days out is in the 180-day window (it has not reached 90
 * yet) and will fall into the 90-day one eleven days later. Each window fires
 * once, so an operator gets four notices spread over the final six months.
 */
function reminderWindow(expiryDate) {
  const days = daysUntil(expiryDate);
  if (days === null || days < 0) return null;
  const hit = REMINDER_DAYS.filter((d) => days <= d);
  return hit.length ? Math.min(...hit) : null;
}

/** Renewal application states, in the order they occur. */
const RENEWAL_STATUSES = ['submitted', 'under_review', 'approved', 'rejected'];

const RENEWAL_STATUS_LABELS = {
  submitted: 'Submitted',
  under_review: 'Under Review',
  approved: 'Approved',
  rejected: 'Rejected',
};

module.exports = {
  VALIDITY_YEARS,
  REMINDER_DAYS,
  EXPIRING_SOON_DAYS,
  RENEWAL_STATUSES,
  RENEWAL_STATUS_LABELS,
  daysUntil,
  validityStatus,
  validUntilFrom,
  reminderWindow,
};
