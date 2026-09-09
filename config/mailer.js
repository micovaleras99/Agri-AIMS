/**
 * Where notification email is actually sent from.
 *
 * `services/notify.js` wrote rows to the `notifications` table and nothing else.
 * Those appear in the bell inside the app, so an applicant learns their
 * documents were returned only if they happen to sign in. This sends the same
 * notification to the address they registered with.
 *
 * One integration, any provider — it is plain SMTP, so the choice is four lines
 * of .env rather than a rewrite:
 *
 *   Gmail          SMTP_HOST=smtp.gmail.com        SMTP_PORT=587
 *                  SMTP_USER=you@gmail.com         SMTP_PASS=<16-char app password>
 *   Outlook        SMTP_HOST=smtp-mail.outlook.com SMTP_PORT=587
 *   Mailtrap       SMTP_HOST=sandbox.smtp.mailtrap.io SMTP_PORT=2525
 *   Local Mailhog  SMTP_HOST=127.0.0.1             SMTP_PORT=1025
 *
 * GMAIL NEEDS AN APP PASSWORD, not your account password. Google stopped
 * accepting the account password for SMTP in 2022. Turn on 2-Step Verification,
 * then create an App Password at myaccount.google.com/apppasswords and use the
 * 16 characters it gives you as SMTP_PASS.
 *
 * FOR A DEFENCE, consider Mailtrap or Mailhog instead: they capture everything
 * the system sends without delivering it to real inboxes, so a demo cannot post
 * test mail to a panelist's real address.
 *
 * Nothing is sent without SMTP_HOST and SMTP_USER. With no configuration every
 * notification still lands in the bell exactly as it does today — a missing or
 * expired mail password can never stop the system working.
 */

const nodemailer = require('nodemailer');
const logger = require('../utils/logger');

const HOST = process.env.SMTP_HOST || '';
const PORT = Number(process.env.SMTP_PORT || 587);
const USER = process.env.SMTP_USER || '';
const PASS = process.env.SMTP_PASS || '';
/** Port 465 is implicit TLS; 587 and 2525 start plain and upgrade with STARTTLS. */
const SECURE = process.env.SMTP_SECURE
  ? process.env.SMTP_SECURE === 'true'
  : PORT === 465;
const FROM = process.env.SMTP_FROM || (USER ? `Agri-AIMS <${USER}>` : '');

/** The public URL used in email links; localhost is right for a local demo. */
const BASE_URL = (process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 3000}`)
  .replace(/\/+$/, '');

/**
 * Whether email can be sent at all.
 *
 * A host with a username but no password is NOT configured — that is a
 * half-finished setup, and treating it as ready would make every notification
 * attempt an authentication that cannot succeed and fill the log with failures.
 * A host with no username at all is a local catcher like Mailhog, which wants
 * no authentication, so that counts as ready.
 *
 * @returns {boolean}
 */
function isConfigured() {
  if (!HOST) return false;
  return USER ? Boolean(PASS) : true;
}

let transport = null;
function getTransport() {
  if (!isConfigured()) return null;
  if (!transport) {
    transport = nodemailer.createTransport({
      host: HOST,
      port: PORT,
      secure: SECURE,
      auth: PASS ? { user: USER, pass: PASS } : undefined,
      // A mail server that is slow or unreachable must not hold a web request
      // open; the send is given ten seconds and then abandoned.
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
    });
  }
  return transport;
}

/** Escapes text going into the HTML part. */
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * The body of a notification email, from the same fields the bell shows.
 * Kept deliberately plain: HTML mail that leans on CSS renders unpredictably,
 * and every client shows a table and a link correctly.
 */
function renderHtml({ title, body, link }) {
  const url = link ? BASE_URL + link : null;
  return `<div style="font-family:Segoe UI,Arial,sans-serif;color:#1a1a2e;line-height:1.5">
  <p style="margin:0 0 4px;font-size:12px;color:#697475">Agri-AIMS — ATI Learning Site for Agriculture</p>
  <h2 style="margin:0 0 12px;font-size:18px">${esc(title)}</h2>
  <p style="margin:0 0 16px">${esc(body)}</p>
  ${url ? `<p style="margin:0 0 16px"><a href="${esc(url)}" style="background:#1c7d45;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;display:inline-block">Open in Agri-AIMS</a></p>` : ''}
  <p style="margin:24px 0 0;font-size:12px;color:#697475">
    You are receiving this because this address is registered on Agri-AIMS.
  </p>
</div>`;
}

/**
 * Sends one notification by email.
 *
 * Never throws. A mail failure is logged and reported as false so the caller —
 * always a notification that has already been written to the database — carries
 * on regardless.
 *
 * @param {string} to
 * @param {{title: string, body?: string, link?: string}} payload
 * @returns {Promise<boolean>} whether it was accepted by the mail server
 */
async function send(to, payload) {
  const tx = getTransport();
  if (!tx || !to) return false;
  try {
    await tx.sendMail({
      from: FROM,
      to,
      subject: payload.title,
      text: `${payload.title}\n\n${payload.body || ''}`
        + (payload.link ? `\n\n${BASE_URL}${payload.link}` : ''),
      html: renderHtml(payload),
    });
    return true;
  } catch (err) {
    logger.error(`mailer: could not send to ${to}`, err);
    return false;
  }
}

/** Proves the SMTP settings work, for `npm run mail:check`. */
async function verify() {
  const tx = getTransport();
  if (!tx) return { ok: false, reason: 'SMTP_HOST and SMTP_USER are not set' };
  try {
    await tx.verify();
    return { ok: true, host: HOST, port: PORT, secure: SECURE, from: FROM };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

module.exports = { isConfigured, send, verify, renderHtml, BASE_URL, FROM };
