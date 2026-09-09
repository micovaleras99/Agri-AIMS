/**
 * Shared validation helpers for registration / user payloads.
 */

const { Resolver } = require('dns').promises;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidEmail(email) {
  return typeof email === 'string' && EMAIL_RE.test(email.trim());
}

/**
 * At least 8 chars, one upper, one lower, one digit, one special.
 */
function isStrongPassword(password) {
  if (typeof password !== 'string' || password.length < 8) return false;
  if (!/[a-z]/.test(password)) return false;
  if (!/[A-Z]/.test(password)) return false;
  if (!/[0-9]/.test(password)) return false;
  if (!/[^A-Za-z0-9]/.test(password)) return false;
  return true;
}

const PASSWORD_RULES =
  'Password must be at least 8 characters and include uppercase, lowercase, a number, and a special character.';


/**
 * Philippine coordinate bounds, as the geo-tag form already states them
 * (Lat 10–20°N, Lng 118–128°E).
 *
 * The rule was written twice and the two copies disagreed: the geo-tag route
 * checked both axes, while step 5 checked latitude only — so a field validation
 * could store a longitude anywhere on Earth. One definition now, used by both.
 */
const PH_BOUNDS = { minLat: 10, maxLat: 20, minLng: 118, maxLng: 128 };

/**
 * @param {unknown} lat
 * @param {unknown} lng
 * @returns {boolean} true only when both are numbers inside the bounds
 */
function isWithinPhilippines(lat, lng) {
  const a = Number(lat);
  const b = Number(lng);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return a >= PH_BOUNDS.minLat && a <= PH_BOUNDS.maxLat
      && b >= PH_BOUNDS.minLng && b <= PH_BOUNDS.maxLng;
}

const EMAIL_FORMAT_ERROR = 'Invalid email format';
const EMAIL_DOMAIN_ERROR =
  'That email domain does not exist or cannot receive mail. Please check the spelling.';

/**
 * DNS codes that mean the domain genuinely cannot take mail. Anything else —
 * a timed-out lookup, an unreachable resolver, a machine with no network at
 * all, which is the normal state of an offline demo — is our problem and not
 * the registrant's, so those cases let the address through. This check exists
 * to catch typos (gmial.com, yahoo.con), not to be a gate.
 */
const NO_MAIL_CODES = new Set(['ENOTFOUND', 'ENODATA', 'NXDOMAIN', 'EBADNAME']);

/**
 * One lookup per domain per process. A DNS round trip on this network costs
 * about two seconds, and a registration form is mostly the same handful of
 * domains, so without this every sign-up pays for a question already answered.
 *
 * ponytail: no TTL and no size cap — the set of domains a single ATI office
 * sees in one uptime is small. Give it an LRU if that stops being true.
 */
const domainCache = new Map();

/**
 * Does the address's domain have somewhere to deliver mail?
 *
 * This is deliberately NOT a check that the mailbox exists — proving that
 * needs a confirmation email, and asking the mail server directly (SMTP VRFY /
 * RCPT TO) is both blocked by the large providers and a good way onto a
 * blocklist.
 *
 * @param {string} email
 * @returns {Promise<boolean>} false only when DNS positively says the domain
 *          has no mail destination
 */
async function emailDomainAcceptsMail(email) {
  const domain = String(email).trim().split('@').pop().toLowerCase();
  if (!domain) return false;
  if (domainCache.has(domain)) return domainCache.get(domain);
  const result = await lookupDomain(domain);
  domainCache.set(domain, result);
  return result;
}

async function lookupDomain(domain) {
  const resolver = new Resolver({ timeout: 3000, tries: 1 });

  try {
    const mx = await resolver.resolveMx(domain);
    if (mx.length) return true;
  } catch (err) {
    if (!NO_MAIL_CODES.has(err.code)) return true;
  }

  // RFC 5321 §5.1: a domain with no MX record but with an address record still
  // takes mail at that address. Rare, but rejecting one would turn a valid
  // sign-up away, which is the more expensive mistake here.
  try {
    return (await resolver.resolve4(domain)).length > 0;
  } catch (err) {
    return !NO_MAIL_CODES.has(err.code);
  }
}

/**
 * The one place both email rules live, so no registration path can end up
 * with the shape check and not the domain check.
 *
 * @param {unknown} email
 * @returns {Promise<string|null>} an error message to show, or null if the
 *          address is usable
 */
async function checkEmail(email) {
  if (!isValidEmail(email)) return EMAIL_FORMAT_ERROR;
  if (!(await emailDomainAcceptsMail(email))) return EMAIL_DOMAIN_ERROR;
  return null;
}

module.exports = {
  isValidEmail,
  emailDomainAcceptsMail,
  checkEmail,
  EMAIL_FORMAT_ERROR,
  EMAIL_DOMAIN_ERROR,
  isStrongPassword,
  EMAIL_RE,
  PASSWORD_RULES,
  isWithinPhilippines,
  PH_BOUNDS,
};
