/**
 * LSA-04 — who this office is, in one place.
 *
 * The Regional Director's name was typed directly into the endorsement letter
 * route and, worse, into the certificate template itself — the official document
 * the farmer receives. The office name, its address and the ATI Central Office
 * address were scattered across half a dozen files besides. When the director
 * changes, none of that should require editing an EJS template.
 *
 * Environment variables override every value, so a deployment sets its own
 * details in .env without touching code. The defaults are ATI-RTC V (Bicol),
 * which is what this system was built for.
 *
 * Deliberately not a database table: these change once every few years, and a
 * settings table would mean a settings screen to maintain. Add one if ATI ever
 * wants staff to edit this without a deploy.
 */

const ORGANIZATION = {
  /** The signing officer on endorsements and certificates. */
  director: process.env.ORG_DIRECTOR || 'JOEY A. BELARMINO, Ph.D.',
  directorTitle: process.env.ORG_DIRECTOR_TITLE || 'Center Director',

  /** This regional office. */
  office: process.env.ORG_OFFICE || 'ATI-RTC V (Bicol)',
  officeShort: process.env.ORG_OFFICE_SHORT || 'ATI-RTC V',
  address: process.env.ORG_ADDRESS || 'Diversion Road, San Agustin, Pili, Camarines Sur',
  region: process.env.ORG_REGION || 'Region V — Bicol',

  /** Where endorsements are sent. */
  centralOffice: process.env.ORG_CENTRAL_OFFICE || 'ATI Central Office, Diliman, Quezon City',

  /** Public contact, used by the chatbot fallback and the footer. */
  email: process.env.ORG_EMAIL || 'rtc5_dcc@ati.da.gov.ph',
  phone: process.env.ORG_PHONE || '054-477-1579',
};

/** "NAME, Title, Office" — the signature block on official output. */
function signatureBlock() {
  return {
    name: ORGANIZATION.director,
    title: `${ORGANIZATION.directorTitle}, ${ORGANIZATION.office}`,
  };
}

module.exports = { ORGANIZATION, signatureBlock };
