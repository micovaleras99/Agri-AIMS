/**
 * Which registered addresses can actually receive mail.
 *
 * `utils/validation.checkEmail` guards all four places an address is set — self
 * registration, admin farmer creation, admin user creation and the profile
 * email change — but only at the moment it is typed. Accounts that existed
 * before the check was added were never re-examined, and a domain can lapse
 * afterwards. Both ATI staff accounts in this database are on
 * `ati-bicol.da.gov.ph`, a domain that does not resolve at all, so every
 * staff-directed notification email — a document filed, a report submitted, a
 * renewal or assistance request — is written to the bell and then fails to send.
 *
 * Read-only: it reports, it never edits an address. Fixing one is a decision
 * about a real person's mailbox.
 *
 *   node scripts/check-account-emails.js
 */

require('dotenv').config();

const { pool } = require('../config/database');
const { checkEmail } = require('../utils/validation');
const mailer = require('../config/mailer');

async function main() {
  console.log(mailer.isConfigured()
    ? `Mail is configured; notifications are sent as ${mailer.FROM}.`
    : 'Mail is NOT configured — notifications appear in the bell only. '
      + 'Set SMTP_HOST/SMTP_USER/SMTP_PASS in .env to send them.');

  const [users] = await pool.query('SELECT id, first_name, last_name, email, role FROM users ORDER BY id');
  const [applicants] = await pool.query(
    'SELECT id, application_id, email FROM applicants WHERE email <> "" ORDER BY id'
  );

  const bad = [];

  console.log(`\nAccounts (${users.length})`);
  for (const u of users) {
    const err = await checkEmail(u.email);
    console.log(`  ${(err ? 'UNDELIVERABLE' : 'ok').padEnd(14)} ${u.role.padEnd(10)} ${u.email}`);
    if (err) bad.push({ what: `user #${u.id} ${u.first_name} ${u.last_name} (${u.role})`, email: u.email, err });
  }

  console.log(`\nApplication contact addresses (${applicants.length})`);
  for (const a of applicants) {
    const err = await checkEmail(a.email);
    console.log(`  ${(err ? 'UNDELIVERABLE' : 'ok').padEnd(14)} ${a.application_id.padEnd(16)} ${a.email}`);
    if (err) bad.push({ what: `application ${a.application_id}`, email: a.email, err });
  }

  if (!bad.length) {
    console.log('\nEvery registered address has somewhere to deliver mail.');
    return;
  }

  console.log(`\n${bad.length} address(es) cannot receive mail:`);
  for (const b of bad) console.log(`  ${b.what}\n    ${b.email} — ${b.err}`);
  console.log('\nNotifications for these still appear in the bell inside the app;'
    + '\nonly the email copy is lost. Correct the address on the account to restore it.');
}

main()
  .then(() => pool.end())
  .catch(async (err) => {
    console.error(err);
    await pool.end().catch(() => {});
    process.exit(1);
  });
