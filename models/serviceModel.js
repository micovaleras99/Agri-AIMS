/**
 * Extension services offered to members, and who took part (RSC-04).
 * The five service types mirror the LSA II components in the guidelines.
 */

const { query, pool } = require('../config/database');
const { likeTerm } = require('../utils/search');
const { rowToCamel } = require('../utils/caseConvert');

const SERVICE_TYPES = [
  'training',
  'demonstration',
  'information_support',
  'technical_assistance',
  'complementary_project',
];

const SERVICE_TYPE_LABELS = {
  training: 'Training',
  demonstration: 'Demonstration Service',
  information_support: 'Information Support',
  technical_assistance: 'Technical Assistance',
  complementary_project: 'Complementary Project',
};

const STATUSES = ['planned', 'open', 'ongoing', 'completed', 'cancelled'];
const PARTICIPANT_STATUSES = ['applied', 'approved', 'rejected', 'waitlisted', 'withdrawn'];

const SELECT_BASE = `
  SELECT s.id, s.service_type, s.name, s.description, s.provider, s.target_beneficiaries,
         s.eligibility, s.venue, s.barangay_id, s.schedule_start, s.schedule_end, s.slots,
         s.status, s.remarks, s.created_by, s.created_at, s.updated_at,
         b.name AS barangay_name, m.name AS municipality_name, p.name AS province_name,
         (SELECT COUNT(*) FROM service_participants sp WHERE sp.service_id = s.id) AS participant_count,
         (SELECT COUNT(*) FROM service_participants sp WHERE sp.service_id = s.id AND sp.attended = 1) AS attended_count
  FROM services s
  LEFT JOIN barangays b      ON b.id = s.barangay_id
  LEFT JOIN municipalities m ON m.id = b.municipality_id
  LEFT JOIN provinces p      ON p.id = m.province_id
`;

function toDateString(value) {
  return value instanceof Date ? value.toISOString().split('T')[0] : value;
}

function formatRow(row) {
  if (!row) return null;
  const o = rowToCamel(row);
  o.scheduleStart = toDateString(o.scheduleStart);
  o.scheduleEnd = toDateString(o.scheduleEnd);
  o.typeLabel = SERVICE_TYPE_LABELS[o.serviceType] || o.serviceType;
  o.locationLabel = o.barangayName
    ? `${o.barangayName}, ${o.municipalityName}, ${o.provinceName}`
    : o.venue || '';
  return o;
}

/**
 * @param {{ serviceType?: string, status?: string, search?: string,
 *           upcomingOnly?: boolean, hideEnded?: boolean }} filters
 * `hideEnded` drops services that are over — completed, cancelled, or past their
 * end date — so members only ever see what they can still take part in.
 */
async function findFiltered(filters = {}) {
  const clauses = [];
  const params = [];

  if (filters.serviceType && SERVICE_TYPES.includes(filters.serviceType)) {
    clauses.push('s.service_type = ?');
    params.push(filters.serviceType);
  }
  if (filters.status && STATUSES.includes(filters.status)) {
    clauses.push('s.status = ?');
    params.push(filters.status);
  }
  if (filters.search) {
    const q = likeTerm(filters.search);
    clauses.push('(s.name LIKE ? OR s.description LIKE ? OR s.provider LIKE ?)');
    params.push(q, q, q);
  }
  if (filters.upcomingOnly) {
    clauses.push('(s.schedule_end IS NULL OR s.schedule_end >= CURDATE())');
  }
  if (filters.hideEnded) {
    clauses.push("s.status NOT IN ('completed', 'cancelled')");
    clauses.push('(s.schedule_end IS NULL OR s.schedule_end >= CURDATE())');
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = await query(
    `${SELECT_BASE} ${where} ORDER BY COALESCE(s.schedule_start, s.created_at) DESC, s.id DESC`,
    params
  );
  return rows.map(formatRow);
}

async function findById(id) {
  const rows = await query(`${SELECT_BASE} WHERE s.id = ? LIMIT 1`, [id]);
  return formatRow(rows[0]);
}

async function create(data) {
  const [res] = await pool.execute(
    `INSERT INTO services
      (service_type, name, description, provider, target_beneficiaries, eligibility, venue,
       barangay_id, schedule_start, schedule_end, slots, status, remarks, created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      SERVICE_TYPES.includes(data.serviceType) ? data.serviceType : 'training',
      data.name,
      data.description || null,
      data.provider || 'ATI-RTC V',
      data.targetBeneficiaries || '',
      data.eligibility || '',
      data.venue || '',
      data.barangayId ?? null,
      data.scheduleStart || null,
      data.scheduleEnd || null,
      data.slots ?? null,
      STATUSES.includes(data.status) ? data.status : 'planned',
      data.remarks || null,
      data.createdBy ?? null,
    ]
  );
  return res.insertId;
}

async function update(id, data) {
  await query(
    `UPDATE services SET
       service_type = ?, name = ?, description = ?, provider = ?, target_beneficiaries = ?,
       eligibility = ?, venue = ?, barangay_id = ?, schedule_start = ?, schedule_end = ?,
       slots = ?, status = ?, remarks = ?
     WHERE id = ?`,
    [
      SERVICE_TYPES.includes(data.serviceType) ? data.serviceType : 'training',
      data.name,
      data.description || null,
      data.provider || 'ATI-RTC V',
      data.targetBeneficiaries || '',
      data.eligibility || '',
      data.venue || '',
      data.barangayId ?? null,
      data.scheduleStart || null,
      data.scheduleEnd || null,
      data.slots ?? null,
      STATUSES.includes(data.status) ? data.status : 'planned',
      data.remarks || null,
      id,
    ]
  );
}

async function remove(id) {
  await query('DELETE FROM services WHERE id = ?', [id]);
}

/**
 * Counts by type and by status, for the module header. With `activeOnly`, the
 * per-type counts include only services that have not ended, so the header a
 * member sees matches the services actually listed to them.
 */
async function stats(activeOnly = false) {
  const activeWhere = activeOnly
    ? "WHERE status NOT IN ('completed', 'cancelled') AND (schedule_end IS NULL OR schedule_end >= CURDATE())"
    : '';
  const byType = await query(`SELECT service_type, COUNT(*) AS c FROM services ${activeWhere} GROUP BY service_type`);
  const byStatus = await query('SELECT status, COUNT(*) AS c FROM services GROUP BY status');
  const [[participants]] = [await query('SELECT COUNT(*) AS c FROM service_participants')];
  const [[attended]] = [await query('SELECT COUNT(*) AS c FROM service_participants WHERE attended = 1')];
  return {
    byType: Object.fromEntries(byType.map((r) => [r.service_type, r.c])),
    byStatus: Object.fromEntries(byStatus.map((r) => [r.status, r.c])),
    total: byType.reduce((sum, r) => sum + r.c, 0),
    participants: participants.c,
    attended: attended.c,
  };
}

// ─── Participants ──────────────────────────────────────────────

/**
 * What a member of staff needs in order to judge one enrolment.
 *
 * This used to select the name, the email, the role, the application id and the
 * farm name — and then the page asked staff to approve or reject the enrolment
 * against the service's eligibility criteria. There was nothing to judge it on:
 * whether the person is a certified LSA or still an applicant, what they farm,
 * or where they are were all absent from the row being decided.
 *
 * The farm is joined through the applicant, so an operator enrolling shows the
 * accreditation their own farm holds rather than the application they no longer
 * have.
 */
const PARTICIPANT_SELECT = `
  SELECT sp.id, sp.service_id, sp.user_id, sp.applicant_id, sp.application_status,
         sp.attended, sp.completed_at, sp.remarks, sp.created_at,
         u.first_name, u.last_name, u.email, u.role,
         a.application_id, a.farm_name, a.status AS applicant_status,
         a.accreditation_step, a.classification, a.category, a.lsa_type,
         a.province, a.municipality, a.farm_area,
         f.id AS farm_id, f.name AS accredited_farm, f.status AS farm_status,
         f.accredited_since, f.expiry_date,
         (SELECT COUNT(*) FROM service_participants x
           WHERE x.user_id = sp.user_id AND x.attended = 1) AS services_attended
  FROM service_participants sp
  JOIN users u           ON u.id = sp.user_id
  LEFT JOIN applicants a ON a.id = sp.applicant_id
  LEFT JOIN farms f      ON f.id = COALESCE(
                            u.farm_id,
                            (SELECT id FROM farms WHERE applicant_id = a.id ORDER BY id LIMIT 1)
                          )
`;

/**
 * The one thing a reviewer looks at first: is this person a certified LSA, or
 * still working through accreditation? Derived here so the page states it the
 * same way everywhere and does not re-implement the rule per template.
 *
 * @returns {{state: string, label: string}}
 *   certified  the farm is accredited and current
 *   lapsed     it was accredited and the certificate has run out
 *   applying   an application is in progress, with the step it has reached
 *   none       neither — a user with no farm and no application
 */
function standingOf(o) {
  if (o.farmStatus === 'active' || o.farmStatus === 'accredited') {
    return { state: 'certified', label: 'Certified LSA' };
  }
  if (o.farmId) return { state: 'lapsed', label: 'LSA — ' + (o.farmStatus || 'not active') };
  if (o.applicationId) {
    return {
      state: 'applying',
      label: 'Applicant · step ' + (o.accreditationStep || 1) + ' of 7',
    };
  }
  return { state: 'none', label: 'No farm or application on record' };
}

function formatParticipant(row) {
  if (!row) return null;
  const o = rowToCamel(row);
  o.completedAt = toDateString(o.completedAt);
  o.accreditedSince = toDateString(o.accreditedSince);
  o.expiryDate = toDateString(o.expiryDate);
  o.fullName = `${o.firstName} ${o.lastName}`.trim();
  o.standing = standingOf(o);
  o.classificationLabel = o.classification
    ? String(o.classification).replace(/_/g, ' ')
    : null;
  o.location = [o.municipality, o.province].filter(Boolean).join(', ') || null;
  o.servicesAttended = Number(o.servicesAttended) || 0;
  return o;
}

async function findParticipants(serviceId) {
  const rows = await query(`${PARTICIPANT_SELECT} WHERE sp.service_id = ? ORDER BY sp.id ASC`, [serviceId]);
  return rows.map(formatParticipant);
}

async function findParticipationForUser(userId) {
  const rows = await query(
    `SELECT sp.id, sp.service_id, sp.application_status, sp.attended, sp.completed_at,
            s.name, s.service_type, s.status, s.schedule_start
       FROM service_participants sp
       JOIN services s ON s.id = sp.service_id
      WHERE sp.user_id = ?
      ORDER BY sp.id DESC`,
    [userId]
  );
  return rows.map((r) => {
    const o = rowToCamel(r);
    o.scheduleStart = toDateString(o.scheduleStart);
    o.typeLabel = SERVICE_TYPE_LABELS[o.serviceType] || o.serviceType;
    return o;
  });
}

/** Idempotent: applying twice keeps the first record rather than erroring. */
async function addParticipant(serviceId, userId, applicantId = null) {
  const [res] = await pool.execute(
    `INSERT INTO service_participants (service_id, user_id, applicant_id, application_status)
     VALUES (?,?,?, 'applied')
     ON DUPLICATE KEY UPDATE application_status = IF(application_status = 'withdrawn', 'applied', application_status)`,
    [serviceId, userId, applicantId]
  );
  return res.insertId || null;
}

async function updateParticipant(id, data) {
  await query(
    `UPDATE service_participants
        SET application_status = ?, attended = ?, completed_at = ?, remarks = ?
      WHERE id = ?`,
    [
      PARTICIPANT_STATUSES.includes(data.applicationStatus) ? data.applicationStatus : 'applied',
      data.attended ? 1 : 0,
      data.completedAt || null,
      data.remarks || '',
      id,
    ]
  );
}

async function findParticipantById(id) {
  const rows = await query(`${PARTICIPANT_SELECT} WHERE sp.id = ? LIMIT 1`, [id]);
  return formatParticipant(rows[0]);
}

module.exports = {
  SERVICE_TYPES,
  SERVICE_TYPE_LABELS,
  STATUSES,
  PARTICIPANT_STATUSES,
  findFiltered,
  findById,
  create,
  update,
  remove,
  stats,
  findParticipants,
  findParticipationForUser,
  addParticipant,
  updateParticipant,
  findParticipantById,
  formatRow,
};
