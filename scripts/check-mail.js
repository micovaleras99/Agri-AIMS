/**
 * Proves the SMTP settings in .env actually work, before a demo depends on them.
 *
 *   npm run mail:check                  connects and authenticates only
 *   npm run mail:check -- you@mail.com  also sends one real test message
 *
 * Nothing here touches the database.
 */

require('dotenv').config();

const mailer = require('../config/mailer');
const { checkEmail } = require('../utils/validation');

async function main() {
  if (!mailer.isConfigured()) {
    console.log('Email is NOT configured — notifications stay in the app only.\n');

    // A half-finished setup is the common case: the address is already in .env
    // and only the app password is missing. Printing the whole list then sends
    // someone hunting for settings that are sitting there already.
    if (process.env.SMTP_HOST && process.env.SMTP_USER && !process.env.SMTP_PASS) {
      console.log(`SMTP_HOST and SMTP_USER are set (${process.env.SMTP_USER}).`);
      console.log('The only thing missing is SMTP_PASS.\n');
      console.log('Gmail will not accept your account password. Create an App Password:');
      console.log('  1. Turn on 2-Step Verification at myaccount.google.com/security');
      console.log('  2. Open myaccount.google.com/apppasswords');
      console.log('  3. Name it "Agri-AIMS" and copy the 16 characters');
      console.log('  4. Put them in .env as   SMTP_PASS=those 16 characters');
      console.log(`\nThen:  npm run mail:check -- ${process.env.SMTP_USER}`);
      process.exitCode = 1;
      return;
    }

    console.log('Add these to .env, then run this again:\n');
    console.log('  SMTP_HOST=smtp.gmail.com');
    console.log('  SMTP_PORT=587');
    console.log('  SMTP_USER=your.address@gmail.com');
    console.log('  SMTP_PASS=your 16-character Google App Password');
    console.log('  SMTP_FROM=Agri-AIMS <your.address@gmail.com>');
    console.log('  APP_BASE_URL=http://localhost:3000\n');
    console.log('Gmail will not accept your account password — create an App Password');
    console.log('at myaccount.google.com/apppasswords with 2-Step Verification on.');
    process.exitCode = 1;
    return;
  }

  console.log('Connecting to the mail server...');
  const result = await mailer.verify();
  if (!result.ok) {
    console.log('FAILED: ' + result.reason);
    console.log('\nCommon causes:');
    console.log('  - Using a Google account password instead of an App Password');
    console.log('  - SMTP_PORT 465 needs SMTP_SECURE=true; 587 needs it false or unset');
    console.log('  - A firewall or VPN blocking the outbound SMTP port');
    process.exitCode = 1;
    return;
  }

  console.log(`OK — ${result.host}:${result.port} (secure: ${result.secure})`);
  console.log(`Mail will be sent from: ${result.from}`);

  const to = process.argv[2];
  if (!to) {
    console.log('\nNo address given, so nothing was sent.');
    console.log('To send a real test message:  npm run mail:check -- you@example.com');
    return;
  }

  // The same check a registration goes through, so a typo is caught here rather
  // than becoming a silent bounce.
  const bad = await checkEmail(to);
  if (bad) {
    console.log(`\nNot sending: ${bad}`);
    process.exitCode = 1;
    return;
  }

  console.log(`\nSending a test message to ${to}...`);
  const sent = await mailer.send(to, {
    title: 'Agri-AIMS test message',
    body: 'If you are reading this, notification email is working. '
      + 'Notifications raised by the system will now reach this address as well as the bell in the app.',
    link: '/dashboard',
  });
  console.log(sent ? 'Sent. Check the inbox (and the spam folder).' : 'Not sent — see the error above.');
  if (!sent) process.exitCode = 1;
}

main().catch((err) => { console.error(err); process.exit(1); });
