/**
 * When a Learning Site owes its semestral accomplishment report.
 *
 * This calendar was computed inside the operator dashboard and nowhere else,
 * while the submission form built its own list of periods from
 * `new Date().getFullYear()` — this year's two semesters, whoever you are. The
 * two disagreed the moment a farm was accredited part-way through a year: a
 * site certified 2026-09-04 owes Semester 1 2027 onwards, and was offered
 * Semester 1 and 2 of 2026, which it does not owe at all. Nothing it could
 * submit would match the calendar asking it to submit.
 *
 * So the derivation lives here, and the dashboard and the form both read it.
 *
 * The ATI Briefer requires "a semestral accomplishment report" for the five-year
 * accreditation; it does not define the cut-off dates. The 31 January / 31 July
 * due dates are this system's own convention, carried over from the original
 * dashboard rather than quoted from the Guidelines.
 */

/** @param {string|Date} d */
function asDate(d) {
  return d instanceof Date ? d : new Date(d);
}

/**
 * Every reporting period inside one farm's accreditation, with what has been
 * filed against it.
 *
 * A period is owed only if it falls due AFTER the certificate was issued and on
 * or before it expires — a site accredited in September does not owe the report
 * that fell due the previous January.
 *
 * @param {{accreditedSince: string, expiryDate: string}} farm
 * @param {Array<{period: string, submissionDate: string, visitors: number,
 *                trainingSessions: number, status: string, id: number}>} reports
 * @returns {Array<object>} oldest period first
 */
function calendarFor(farm, reports = []) {
  const calendar = [];
  if (!farm || !farm.accreditedSince) return calendar;

  const accreditedOn = asDate(farm.accreditedSince);
  const expiresOn = farm.expiryDate
    ? asDate(farm.expiryDate)
    : new Date(asDate(farm.accreditedSince).setFullYear(accreditedOn.getFullYear() + 5));
  const now = new Date();

  for (let yr = accreditedOn.getFullYear(); yr <= expiresOn.getFullYear(); yr += 1) {
    for (const semNum of [1, 2]) {
      const dueDate = `${yr}-${semNum === 1 ? '01' : '07'}-31`;
      const due = new Date(dueDate);
      if (due <= accreditedOn || due > expiresOn) continue;

      const period = `Semester ${semNum} ${yr}`;
      const existing = reports.find((r) => r.period === period);
      const isPast = due < now;
      const isNext = !isPast && !calendar.some((r) => r.status === 'upcoming');

      calendar.push({
        period,
        dueDate,
        status: existing ? existing.status : isNext ? 'upcoming' : isPast ? 'overdue' : 'future',
        submitted: existing ? existing.submissionDate : null,
        visitors: existing ? existing.visitors : null,
        sessions: existing ? existing.trainingSessions : null,
        reportId: existing ? existing.id : null,
        remarks: existing ? existing.remarks : null,
      });
    }
  }
  return calendar;
}

/**
 * The periods this farm may still file, overdue first — what the submission
 * form offers, and what the route validates against.
 *
 * @returns {Array<{period: string, dueDate: string, status: string}>}
 */
function openPeriods(calendar) {
  const rank = { overdue: 0, upcoming: 1, future: 2 };
  return calendar
    .filter((r) => !r.reportId)
    .sort((a, b) => (rank[a.status] ?? 9) - (rank[b.status] ?? 9))
    .map(({ period, dueDate, status }) => ({ period, dueDate, status }));
}

/** May this farm file this period? False for a period already filed or never owed. */
function mayFile(calendar, period) {
  return openPeriods(calendar).some((p) => p.period === period);
}

module.exports = { calendarFor, openPeriods, mayFile };
