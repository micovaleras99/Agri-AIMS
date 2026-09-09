/**
 * Notification email.
 *
 * `services/notify.js` wrote rows to the `notifications` table and nothing left
 * the machine, so an applicant learned their documents had been returned only
 * if they happened to sign in. Every sender now also emails the address the user
 * registered with.
 *
 * This runs a throwaway SMTP server on localhost and points the mailer at it, so
 * the checks prove real delivery without needing anyone's real credentials and
 * without sending mail to a real inbox.
 *
 *   node tests/mail_test.js
 */

require('dotenv').config();

const fs = require('fs');
const net = require('net');

let failures = 0;
function check(label, condition) {
  console.log((condition ? 'PASS  ' : 'FAIL  ') + label);
  if (!condition) failures += 1;
}

/**
 * The smallest SMTP server that nodemailer will talk to: greet, accept every
 * command, and collect the DATA block. Enough to prove a message was composed,
 * addressed and handed over.
 */
function smtpSink() {
  const received = [];
  const server = net.createServer((sock) => {
    let inData = false;
    let buf = '';
    sock.write('220 localhost test\r\n');
    sock.on('data', (chunk) => {
      const text = chunk.toString('utf8');
      if (inData) {
        buf += text;
        if (buf.includes('\r\n.\r\n')) {
          received.push(buf.slice(0, buf.indexOf('\r\n.\r\n')));
          inData = false;
          buf = '';
          sock.write('250 OK queued\r\n');
        }
        return;
      }
      for (const line of text.split('\r\n').filter(Boolean)) {
        const verb = line.slice(0, 4).toUpperCase();
        if (verb === 'EHLO' || verb === 'HELO') {
          sock.write('250-localhost\r\n250 AUTH PLAIN LOGIN\r\n');
        } else if (verb === 'AUTH') {
          sock.write('235 accepted\r\n');
        } else if (verb === 'DATA') {
          inData = true;
          sock.write('354 send it\r\n');
        } else if (verb === 'QUIT') {
          sock.write('221 bye\r\n');
          sock.end();
        } else {
          sock.write('250 OK\r\n');
        }
      }
    });
    sock.on('error', () => { /* client hung up */ });
  });
  return { server, received };
}

async function main() {
  console.log('--- unconfigured, the system still works ---');
  // The machine running this may well have real SMTP settings in .env — it did,
  // and this section failed for that reason rather than for a defect. A test
  // must set up the state it is checking instead of assuming the environment
  // happens to be in it, so the variables are cleared and restored here.
  const savedEnv = {};
  for (const k of ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_SECURE', 'SMTP_FROM']) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
  delete require.cache[require.resolve('../config/mailer')];
  const bare = require('../config/mailer');
  check('email is off when SMTP_HOST and SMTP_USER are unset', !bare.isConfigured());
  check('and sending is a no-op rather than a crash',
    (await bare.send('someone@example.com', { title: 'x', body: 'y' })) === false);
  const v = await bare.verify();
  check('verify() explains why rather than throwing', v.ok === false && !!v.reason);

  console.log('\n--- configured against a real SMTP conversation ---');
  const { server, received } = smtpSink();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  process.env.SMTP_HOST = '127.0.0.1';
  process.env.SMTP_PORT = String(port);
  process.env.SMTP_USER = 'agri-aims@example.com';
  process.env.SMTP_PASS = 'test-password';
  process.env.SMTP_SECURE = 'false';
  process.env.SMTP_FROM = 'Agri-AIMS <agri-aims@example.com>';
  process.env.APP_BASE_URL = 'http://localhost:3000';
  delete require.cache[require.resolve('../config/mailer')];
  const mailer = require('../config/mailer');

  try {
    check('email is on once SMTP_HOST and SMTP_USER are set', mailer.isConfigured());
    const ok = await mailer.verify();
    check('it can reach and authenticate with the server' + (ok.ok ? '' : ` — ${ok.reason}`), ok.ok);

    const sent = await mailer.send('mico@example.com', {
      title: 'Document needs revision: Medical Certificate',
      body: 'Page 2 is unreadable. Please re-upload a clearer scan.',
      link: '/documents',
    });
    check('a notification is accepted by the server', sent === true);
    check('and the server received exactly one message', received.length === 1);

    const msg = received[0] || '';
    check('addressed to the right person', /To:.*mico@example\.com/i.test(msg));
    check('from the configured sender', /From:.*agri-aims@example\.com/i.test(msg));
    // The subject is the notification title, so the inbox says what happened
    // without the message having to be opened.
    check('the subject is the notification title',
      /Subject:.*Document needs revision/i.test(msg.replace(/=\r\n/g, '')));
    const body = msg.replace(/=\r\n/g, '').replace(/=3D/g, '=');
    check('the body carries the remarks', /Page 2 is unreadable/.test(body));
    check('and a link back into the system',
      /http:\/\/localhost:3000\/documents/.test(body));
    check('a plain-text part is included for clients that do not render HTML',
      /text\/plain/i.test(msg));

    // A user with no address must not produce a half-formed message.
    check('nothing is sent to an empty address',
      (await mailer.send('', { title: 'x' })) === false);
    check('and still only one message reached the server', received.length === 1);

    console.log('\n--- the notification senders route through it ---');
    // The point of the wrappers: a sender cannot be in-app only by accident.
    const src = fs.readFileSync('services/notify.js', 'utf8');
    check('no sender writes a notification straight to the model any more',
      !/(?:await |return )notificationModel\.create(ForUsers)?\(/.test(
        src.replace(/async function create(One|Many)[\s\S]*?\n}/g, '')));
    check('the wrappers exist and are the only model callers',
      /async function createOne/.test(src) && /async function createMany/.test(src));
    // Email must never hold up the web request that triggered the notification.
    check('delivery is not awaited by the senders',
      /function emailInBackground/.test(src) && !/await emailInBackground/.test(src));

    const notify = require('../services/notify');
    check('every sender is still exported', typeof notify.documentReviewed === 'function'
      && typeof notify.accreditationAdvanced === 'function'
      && typeof notify.renewalDue === 'function');
  } finally {
    await new Promise((r) => server.close(r));
    // Put the real environment back, so nothing after this sees the fake server.
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }

  console.log('');
  if (failures) {
    console.log(failures + ' CHECK(S) FAILED');
    process.exitCode = 1;
  } else {
    console.log('ALL MAIL CHECKS PASSED');
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
