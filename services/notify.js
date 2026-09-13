/**
 * Notification senders, one per thing that actually happens in the system.
 *
 * Routes call these rather than writing rows directly, so the wording and the
 * links stay consistent and a failure to notify never breaks the action that
 * triggered it — a farmer's certificate must still be issued even if the
 * notification insert fails.
 */

const notificationModel = require('../models/notificationModel');
const { ic } = require('../config/icons');
const userModel = require('../models/userModel');
const mailer = require('../config/mailer');
const logger = require('../utils/logger');

/** Notifying is a side effect: log the failure and let the caller continue. */
async function safely(label, fn) {
  try {
    return await fn();
  } catch (err) {
    logger.error(`notify: ${label} failed`, err);
    return 0;
  }
}

/**
 * Emails a notification that has already been written to the database.
 *
 * Deliberately NOT awaited by the senders below. SMTP talks to a machine on the
 * internet, and a slow or unreachable mail server would otherwise hold open the
 * web request that triggered it — an applicant would watch a spinner because a
 * mail host was down. The row is already saved, so the bell is correct whatever
 * happens here; delivery is best effort and failures are logged.
 *
 * @param {number[]} userIds
 * @param {{title: string, body?: string, link?: string}} payload
 */
function emailInBackground(userIds, payload) {
  if (!mailer.isConfigured()) return;
  Promise.resolve()
    .then(async () => {
      const people = await userModel.emailsByIds(userIds);
      for (const person of people) {
        await mailer.send(person.email, payload);
      }
    })
    .catch((err) => logger.error('notify: email delivery failed', err));
}

/**
 * Write one notification, then email it. Every sender below goes through here
 * rather than calling the model directly, so a new sender cannot accidentally
 * be in-app only — which is what the whole system was until now.
 */
// Notifications carry a Bootstrap-style icon name; store it as the Phosphor
// classes the client renders directly, so the whole app speaks one icon set.
function withIcon(payload) {
  return payload && payload.icon ? { ...payload, icon: ic(payload.icon) } : payload;
}

async function createOne(payload) {
  payload = withIcon(payload);
  const id = await notificationModel.create(payload);
  emailInBackground([payload.userId], payload);
  return id;
}

/** The same for a fan-out to many recipients. */
async function createMany(userIds, payload) {
  payload = withIcon(payload);
  const written = await notificationModel.createForUsers(userIds, payload);
  emailInBackground(userIds, payload);
  return written;
}

const STEP_LABELS = {
  1: 'Briefing',
  2: 'Self-Assessment',
  3: 'Submit Documents',
  4: 'Document Evaluation',
  5: 'Field/Virtual Validation',
  6: 'Endorsement to ATI-CO',
  7: 'Certificate & MOA',
};

/** The applicant's accreditation moved forward. */
async function accreditationAdvanced(applicant, step) {
  return safely('accreditationAdvanced', async () => {
    const userId = await notificationModel.findUserIdByApplicationId(applicant.applicationId);
    if (!userId) return 0;
    return createOne({
      userId,
      type: 'accreditation_step',
      title: `Your application moved to Step ${step}: ${STEP_LABELS[step] || ''}`.trim(),
      body: `Application ${applicant.applicationId} is now at step ${step} of 7.`,
      link: `/accreditation/${applicant.id}`,
      icon: 'arrow-right-circle',
    });
  });
}

/** Documents were returned for correction at Step 4. */
async function documentsReturned(applicant, remarks) {
  return safely('documentsReturned', async () => {
    const userId = await notificationModel.findUserIdByApplicationId(applicant.applicationId);
    if (!userId) return 0;
    return createOne({
      userId,
      type: 'documents_returned',
      title: 'Your documents need revision',
      body: remarks ? String(remarks).slice(0, 900) : 'The evaluator returned your submission for correction.',
      link: `/accreditation/${applicant.id}/step/3`,
      icon: 'exclamation-triangle',
    });
  });
}

/** Field validation found the farm non-compliant. */
async function validationFailed(applicant, remarks) {
  return safely('validationFailed', async () => {
    const userId = await notificationModel.findUserIdByApplicationId(applicant.applicationId);
    if (!userId) return 0;
    return createOne({
      userId,
      type: 'validation_result',
      title: 'Field validation found items to address',
      body: remarks ? String(remarks).slice(0, 900) : 'The TWG recorded findings from the site visit.',
      link: `/applicants/${applicant.id}`,
      icon: 'clipboard-x',
    });
  });
}

/** The certificate was issued — the good news. */
async function certificateIssued(applicant, certNo, validUntil) {
  return safely('certificateIssued', async () => {
    const userId = await notificationModel.findUserIdByApplicationId(applicant.applicationId);
    if (!userId) return 0;
    return createOne({
      userId,
      type: 'certificate_issued',
      title: 'Your LSA certificate has been issued',
      body: `Certificate ${certNo} is valid until ${validUntil}.`,
      link: `/applicants/${applicant.id}`,
      icon: 'award',
    });
  });
}

/** A document arrived and someone has to review it. */
/**
 * One document accepted or rejected. Separate from documentsReturned(), which
 * is the whole-application verdict at the end of Step 4: this one names the
 * document, so an applicant with twelve requirements is told which of them to
 * fix rather than that "the documents" need work.
 *
 * @param {object} applicant
 * @param {string} documentName
 * @param {'verified'|'incomplete'} status
 * @param {string} remarks
 */
async function documentReviewed(applicant, documentName, status, remarks, doc = null) {
  if (!applicant) return 0;
  const accepted = status === 'verified';
  return safely('documentReviewed', async () => {
    const userId = await notificationModel.findUserIdByApplicationId(applicant.applicationId);
    if (!userId) return 0;
    // A rejection links straight to the re-submission form for that requirement,
    // with the applicant and document already chosen — so "needs revision" comes
    // with the one action that answers it, not just a trip back to the list.
    const resubmit = !accepted && doc && doc.type
      ? `/documents/submit?type=${encodeURIComponent(doc.type)}&applicant=${doc.applicantId}&resubmit=1`
      : '/documents';
    return createOne({
      userId,
      type: accepted ? 'document_accepted' : 'document_rejected',
      title: accepted ? `Document accepted: ${documentName}` : `Document needs revision: ${documentName}`,
      body: remarks
        ? (accepted ? String(remarks).slice(0, 900)
          : `${String(remarks).slice(0, 850)} — open this to re-submit.`)
        : `Your "${documentName}" was accepted.`,
      link: resubmit,
      icon: accepted ? 'check-circle' : 'exclamation-triangle',
    });
  });
}

async function documentSubmitted(applicant, documentName) {
  return safely('documentSubmitted', async () => {
    const reviewers = await notificationModel.findUserIdsByRole(['admin']);
    return createMany(reviewers, {
      type: 'document_submitted',
      title: 'A document is waiting for review',
      body: `${applicant ? `${applicant.firstName} ${applicant.lastName}` : 'An applicant'} submitted "${documentName}".`,
      link: '/documents?status=pending_review',
      icon: 'upload',
    });
  });
}

/** ATI staff registered a farmer, who should know the account exists. */
async function accountCreatedByAdmin(userId, applicationId) {
  return safely('accountCreatedByAdmin', async () =>
    createOne({
      userId,
      type: 'account_created',
      title: 'Welcome to Agri-AIMS',
      body: `Your account and application ${applicationId} were created by ATI staff. Start at Step 1: Briefing.`,
      link: '/dashboard',
      icon: 'person-check',
    })
  );
}

/** A new e-learning article was picked up (RSC-03). */
async function elearningArticle(article, recipientIds) {
  const fromWebsite = article.source === 'ati_website';
  return safely('elearningArticle', async () =>
    createMany(recipientIds, {
      type: 'elearning_article',
      title: fromWebsite ? 'New from the ATI Bicol website' : 'New on the ATI e-Learning site',
      body: String(article.title).slice(0, 900),
      link: '/community',
      icon: fromWebsite ? 'newspaper' : 'mortarboard',
    })
  );
}

/** A service was opened for applications (RSC-04). */
async function serviceAnnounced(service, recipientIds) {
  return safely('serviceAnnounced', async () =>
    createMany(recipientIds, {
      type: 'service_announced',
      title: `New ${String(service.serviceType).replace(/_/g, ' ')}: ${service.name}`,
      body: String(service.description || '').slice(0, 900),
      link: `/services/${service.id}`,
      icon: 'calendar-event',
    })
  );
}

/** A compliance check recorded something that needs fixing (RSC-05). */
async function complianceFinding(userId, requirementTitle, correctiveAction, farmId) {
  return safely('complianceFinding', async () =>
    createOne({
      userId,
      type: 'compliance_finding',
      title: `Compliance item needs attention: ${requirementTitle}`,
      body: correctiveAction ? String(correctiveAction).slice(0, 900) : 'An ATI monitoring check recorded a finding.',
      link: farmId ? `/compliance/farm/${farmId}` : '/dashboard',
      icon: 'shield-exclamation',
    })
  );
}

/** An LSA II up-scaling application moved through the PDF p.21 procedure. */
async function lsa2Advanced(application, farm, step) {
  return safely('lsa2Advanced', async () => {
    const labels = {
      1: 'Submission of documentary requirements',
      2: 'Evaluation of documentary requirements',
      3: 'Field / Virtual Validation',
      4: 'Endorsement to ATI-CO',
      5: 'Issuance of Certificate and MOA / MOU signing',
    };
    const userId = await notificationModel.findUserIdByFarmId(farm.id);
    if (!userId) return 0;
    return createOne({
      userId,
      type: 'lsa2_step',
      title: `LSA II up-scaling moved to Step ${step}: ${labels[step] || ''}`.trim(),
      body: `${farm.name} — application ${application.referenceNo} is now at step ${step} of 5.`,
      link: `/lsa2/farm/${farm.id}`,
      icon: 'arrow-up-circle',
    });
  });
}

/**
 * An accreditation is running out — Table 10, "Renewal Notification".
 *
 * Goes to the operator, who is the one who has to act, and to ATI staff, who
 * have to plan the visit. Sending nothing when there is no operator account
 * would leave a farm silently lapsing, so staff are told either way.
 */
async function renewalDue(farm, daysLeft) {
  return safely('renewalDue', async () => {
    const urgency = daysLeft <= 30 ? 'expires very soon' : 'is coming up for renewal';
    const title = `${farm.name}: accreditation ${urgency}`;
    const body = `Accreditation expires on ${farm.expiryDate} — ${daysLeft} day${daysLeft === 1 ? '' : 's'} left. `
      + 'Submit the renewal application before that date to stay accredited.';

    const recipients = new Set();
    const operatorId = await notificationModel.findUserIdByFarmId(farm.id);
    if (operatorId) recipients.add(operatorId);
    for (const id of await notificationModel.findUserIdsByRole(['admin'])) recipients.add(id);
    if (!recipients.size) return 0;

    return createMany([...recipients], {
      type: 'renewal_due',
      title,
      body,
      link: `/renewal?farm=${farm.id}`,
      icon: daysLeft <= 30 ? 'exclamation-triangle' : 'calendar-event',
    });
  });
}

/** An operator has applied to renew; the reviewers need to see it. */
async function renewalSubmitted(farm, renewalId) {
  return safely('renewalSubmitted', async () => {
    const staff = await notificationModel.findUserIdsByRole(['admin']);
    if (!staff.length) return 0;
    return createMany(staff, {
      type: 'renewal_submitted',
      title: `Renewal application: ${farm.name}`,
      body: `${farm.operator || 'The operator'} has applied to renew the accreditation of ${farm.name}.`,
      link: `/renewal/${renewalId}`,
      icon: 'arrow-repeat',
    });
  });
}

/**
 * A semestral accomplishment report has been filed and needs a decision.
 *
 * Every other submission in the system tells someone it arrived — documents,
 * renewals. Reports did not, so one could sit unreviewed for a
 * semester with nobody aware it was waiting.
 */
async function reportSubmitted(farm, report) {
  return safely('reportSubmitted', async () => {
    const staff = await notificationModel.findUserIdsByRole(['admin']);
    if (!staff.length) return 0;
    return createMany(staff, {
      type: 'report_submitted',
      title: `Semestral report: ${farm.name}`,
      body: `${farm.operator || 'The operator'} filed the ${report.period} report — `
        + `${report.visitors} visitor(s), ${report.trainingSessions} training session(s).`,
      link: '/reports',
      icon: 'file-earmark-bar-graph',
    });
  });
}

/** ATI accepted the report, or returned it for correction. */
async function reportDecided(farm, report) {
  return safely('reportDecided', async () => {
    const userId = await notificationModel.findUserIdByFarmId(farm.id);
    if (!userId) return 0;
    const approved = report.status === 'approved';
    return createOne({
      userId,
      type: 'report_decided',
      title: approved
        ? `${report.period} report accepted`
        : `${report.period} report returned for correction`,
      body: approved
        ? `ATI has accepted the ${report.period} accomplishment report for ${farm.name}.`
        : (report.remarks || 'See the remarks on the report.'),
      link: '/reports',
      icon: approved ? 'check-circle' : 'arrow-counterclockwise',
    });
  });
}

/** The renewal was approved or rejected; the operator needs the outcome. */
async function renewalDecided(farm, { approved, newValidUntil, remarks }) {
  return safely('renewalDecided', async () => {
    const userId = await notificationModel.findUserIdByFarmId(farm.id);
    if (!userId) return 0;
    return createOne({
      userId,
      type: 'renewal_decided',
      title: approved
        ? `Accreditation renewed: ${farm.name}`
        : `Renewal not approved: ${farm.name}`,
      body: approved
        ? `The accreditation of ${farm.name} now runs to ${newValidUntil}.`
        : (remarks || 'ATI did not approve the renewal. See the remarks on the application.'),
      link: `/renewal?farm=${farm.id}`,
      icon: approved ? 'patch-check' : 'x-circle',
    });
  });
}

module.exports = {
  documentReviewed,
  accreditationAdvanced,
  lsa2Advanced,
  documentsReturned,
  validationFailed,
  certificateIssued,
  documentSubmitted,
  accountCreatedByAdmin,
  elearningArticle,
  serviceAnnounced,
  complianceFinding,
  renewalDue,
  renewalSubmitted,
  reportSubmitted,
  reportDecided,
  renewalDecided,
};
