/**
 * RSC-06 — answers about using Agri-AIMS itself.
 *
 * The knowledge base held the LSA guidelines and nothing about the software, so
 * "how do I register a farmer?" retrieved "Farmer-leader or respected in the
 * community" — a confident, wrong answer, which is worse than no answer. These
 * entries describe what the system actually does, taken from the routes and the
 * role checks in them, not from imagination.
 *
 * Every fact here is checkable against the code named in `where`. If a route
 * changes, this must change with it — that is why each entry names its route.
 */

const SYSTEM_HELP = [
  {
    q: 'register a farmer, add an applicant, new application, enrol a farmer',
    a: 'Administrators register farmers at Applications → Register Farmer (/admin/farmers/new). '
      + 'It creates the application record, and optionally a login account in the same step — untick '
      + '"Create a login account" for a farmer with no email address. The older /applicants/add form '
      + 'now redirects here.',
    where: 'routes/admin.js, controllers/adminFarmerController.js',
  },
  {
    q: 'application status, where is my application, track progress, what stage',
    a: 'Open Applications and click an application id. The page shows the 7-step tracker, the '
      + 'documents submitted, the basic facilities, the farm area check and the disqualification '
      + 'declaration. Applicants see only their own application.',
    where: 'routes/applicants.js GET /:id',
  },
  {
    q: 'status meaning submitted document review under review approved rejected',
    a: 'An application moves through Submitted → Document Review → Under Review → Approved. '
      + 'It becomes Approved when it reaches step 7, where the certificate is issued.',
    where: 'controllers/accreditationHelpers.js',
  },
  {
    q: 'upload a file, attach a scan, where do I submit, submit a document, submitting documents page',
    a: 'Go to Applications → Documents → Submit Document. The list of required documents depends on '
      + 'the applicant: every applicant submits the core set, and agri-processing enterprises, '
      + 'organizations and government-owned sites each owe extra ones. Where an official form '
      + 'exists, download it, complete it, and upload the finished copy.',
    where: 'routes/documents.js, config/documentRequirements.js',
  },
  {
    q: 'geo tag, geotag, coordinates, GPS, map the farm, pin location',
    a: 'ATI evaluators record coordinates on the application page, in the geo-tag panel. Latitude must '
      + 'be between 10 and 20 and longitude between 118 and 128 — anything outside the Philippines is '
      + 'refused. Geo-tagging also happens as part of Step 5 field validation.',
    where: 'routes/applicants.js POST /geotag/:id, utils/validation.js',
  },
  {
    q: 'who can issue the certificate, certificate of accreditation, step 7, MOA',
    a: 'Only an administrator can complete Step 7, which issues the LSA Certificate and records the '
      + 'MOA. The confirmation box must be ticked; the certificate is issued under the Regional '
      + 'Director\'s name.',
    where: 'routes/accreditation.js POST /:id/step/7',
  },
  {
    q: 'field validation, TWG inspection, step 5, pass mark, how many items',
    a: 'ATI evaluators (TWG) record the site inspection at Step 5. There are 12 inspection items and '
      + 'at least 10 must be met for the farm to be compliant. Every item is stored individually, so '
      + 'the Field Validation Report shows exactly which ones failed.',
    where: 'routes/accreditation.js step 5, config/accreditationChecklists.js',
  },
  {
    q: 'self assessment, step 2, eligibility form, ATI-QF-PAD-164',
    a: 'The applicant completes the self-assessment at Step 2, before submitting documents. All 21 '
      + 'answers are stored individually, not just the score, so the basic facilities a farm claims '
      + 'can be compared with what the TWG later finds on site.',
    where: 'routes/accreditation.js step 2',
  },
  {
    q: 'semestral report, submit a report, accomplishment report, monitoring report',
    a: 'LSA operators and ATI staff submit reports at Monitoring → Reports. A report needs a period '
      + 'and the farm it covers; operators can only report on their own farm.',
    where: 'routes/reports.js POST /',
  },
  {
    q: 'compliance, monitoring visit, record a check, findings, corrective action',
    a: 'Monitoring → Compliance lists every accredited farm with a computed score. Open a farm to see '
      + 'the 18 requirements, each citing the section of the guidelines it comes from, and to record '
      + 'a check. A non-compliant finding notifies the operator.',
    where: 'routes/compliance.js',
  },
  {
    q: 'renewal, renew accreditation, re-accreditation, expiry, expire, expired, expires, certificate expiring, how long does accreditation last, five years, valid until',
    a: 'LSA accreditation runs for 5 years. Operators renew their own Learning Site at Programs → '
      + 'Renewal (/renewal); the system warns 180, 90, 30 and 7 days before expiry. The operator (or '
      + 'an administrator on their behalf) files the renewal, ATI staff review it, and an administrator '
      + 'approves the decision. Applicants who are not yet accredited have no renewal page.',
    where: 'routes/renewal.js, config/renewal.js',
  },
  {
    q: 'services, training, enrol, attend, register for a training',
    a: 'Programs → Services lists trainings and other services with filters. Members enrol themselves; '
      + 'ATI staff create services and record attendance and completion.',
    where: 'routes/services.js',
  },
  {
    q: 'password, sign in, log in, cannot log in, account locked, too many attempts',
    a: 'Sign in from the home page with your email address. After 10 failed attempts sign-in is '
      + 'blocked for 15 minutes, so wait rather than keep trying. There is no self-service password '
      + 'reset yet — ask an ATI administrator, who can create or replace your account.',
    where: 'middleware/rateLimit.js, controllers/adminFarmerController.js',
  },
  {
    q: 'roles, permissions, what can I do, access denied, why can I not see',
    a: 'There are four roles. Administrators do everything; evaluators handle document evaluation, '
      + 'field validation and endorsement; operators see their own farm, reports and services; '
      + 'applicants see their own application and documents. "Access Denied" means the page belongs '
      + 'to another role.',
    where: 'middleware/roleContext.js and the role checks in each route',
  },
  {
    q: 'notifications, bell, alerts, unread',
    a: 'The bell in the top bar shows notifications about your applications — each accreditation step, '
      + 'returned documents, a failed validation, a certificate issued, and compliance findings. '
      + 'Open it to mark them read.',
    where: 'routes/api/notificationRoutes.js, services/notify.js',
  },
  {
    q: 'community chat, channels, ATI news, announcements, where do posts come from',
    a: 'Community has channels for general discussion, the Bicol region, organic farming, technology '
      + 'sharing, market linkages and e-learning. New posts from the ATI Bicol website appear in '
      + '#region-v-bicol automatically, with a link to the original article.',
    where: 'routes/community.js, services/atiWebsite.js',
  },
  {
    q: 'messages, direct message, dm, private message, inbox, message an operator, reply, conversation',
    a: 'Messages (/messages) is private two-way messaging between two members: conversations on the '
      + 'left, the open thread on the right, refreshing every few seconds. Everyone has it. You can '
      + 'edit or delete your own messages, and a deleted one shows as "deleted" to the other person. '
      + 'Unlike Community, a private message is not moderated — only its author can change it.',
    where: 'routes/messages.js, routes/api/messageRoutes.js',
  },
  {
    q: 'directory, find a learning site, public list, visit a farm',
    a: 'Directory lists accredited Learning Sites with search and filters, so anyone can find a site '
      + 'to visit.',
    where: 'routes/directory.js',
  },
  {
    q: 'registry export, export the register, download the list of accredited sites, csv, json, xml, data feed, ATI Services registry, RSC-07',
    a: 'Monitoring → Registry Export (/registry) lets ATI staff download the register of accredited '
      + 'Learning Sites for ATI Services. The data comes from GET /api/export/lsa-registry in three '
      + 'formats — JSON, CSV or XML — one record shape in each. It is staff-only (administrators and '
      + 'evaluators); operators and applicants cannot open it.',
    where: 'routes/registry.js, routes/api/exportRoutes.js',
  },
  {
    q: 'lsa2 documents packet, upload lsa ii papers, up-scaling requirements, download lsa2 form, farm packet',
    a: 'The LSA II documentary packet is on the farm\'s up-scaling page (Programs → LSA II Up-scaling, '
      + 'then open the farm). It reuses the ordinary Documents module — the LSA II document types attach '
      + 'to the same farm record — so you download the prescribed form, complete it, and upload the '
      + 'finished copy there. Up-scaling is for farms already certified as LSA I, not for applicants.',
    where: 'routes/lsa2.js, config/lsa2.js',
  },
  {
    q: 'profile, change my password, update my details, change email, phone, upload my photo, avatar, profile picture',
    a: 'Your Profile (/profile) is where you update your own name, email, phone and photo, and change '
      + 'your sign-in password. Changing the password needs your current password and a new one of at '
      + 'least 8 characters with an uppercase letter, a lowercase letter, a number and a special '
      + 'character. This is different from a forgotten-password reset, which still needs an administrator.',
    where: 'routes/profile.js, routes/api/userRoutes.js PUT /:id',
  },
  {
    q: 'barangay, address, region province municipality, location not listed',
    a: 'Addresses use the official PSGC list: choose region, then province, then municipality, then '
      + 'barangay. All 3,471 barangays of Region V are loaded, so pick from the list rather than '
      + 'typing an address.',
    where: 'models/locationModel.js, routes/api/locationRoutes.js',
  },
];

/** In the shape chatbotKnowledge's scorer expects. */
function helpEntries() {
  return SYSTEM_HELP.map((h) => ({
    answer: h.a,
    source: 'Agri-AIMS user guide',
    keywords: `${h.q} system how do i where agri-aims`,
  }));
}

module.exports = { SYSTEM_HELP, helpEntries };
