/**
 * Email validation: shape, domain, and what a duplicate is called.
 *
 * Both halves here were real defects. The domain was never checked at all, so
 * a typo'd address registered an account nobody could ever recover; and a
 * duplicate email losing the race with the INSERT was reported to the user as
 * "could not allocate a unique application id", which names something they
 * never saw.
 *
 * The DNS checks need a working resolver and say so rather than failing when
 * there is none — the point of the domain check is to fail open offline.
 *
 *   node tests/email_test.js
 */

const { Resolver } = require('dns').promises;
const {
  checkEmail,
  emailDomainAcceptsMail,
  EMAIL_FORMAT_ERROR,
  EMAIL_DOMAIN_ERROR,
} = require('../utils/validation');
const { duplicateMessage } = require('../middleware/errorHandler');

let failures = 0;
function check(label, condition) {
  console.log((condition ? 'PASS  ' : 'FAIL  ') + label);
  if (!condition) failures += 1;
}

/** Is there a resolver to talk to at all? */
async function online() {
  try {
    await new Resolver({ timeout: 3000, tries: 1 }).resolveMx('gmail.com');
    return true;
  } catch {
    return false;
  }
}

async function main() {
  console.log('--- shape ---');
  for (const bad of ['', 'nope', 'a@b', 'a b@c.com', 'a@@b.com', null, 42]) {
    check(`${JSON.stringify(bad)} is rejected on shape`,
      (await checkEmail(bad)) === EMAIL_FORMAT_ERROR);
  }

  console.log('\n--- domain ---');
  if (!(await online())) {
    console.log('SKIP  no DNS resolver reachable — the domain checks need one');
    // The offline case is itself a requirement: registration must still work.
    check('offline, an address is let through rather than blocked',
      (await checkEmail('juan@gmail.com')) === null);
  } else {
    check('a domain that does not exist is refused',
      (await checkEmail('juan@not-a-real-domain-9x7q.invalid')) === EMAIL_DOMAIN_ERROR);
    check('a real mail domain passes', (await checkEmail('juan@gmail.com')) === null);
    // Mail is delivered by MX, but RFC 5321 falls back to the address record,
    // and a domain that only has one still takes mail.
    check('a domain with an address record but no MX is not refused',
      await emailDomainAcceptsMail('someone@example.com'));
    // What this check is NOT: proof the mailbox exists. Only a confirmation
    // email proves that, and this must never be described as more than it is.
    check('an unused mailbox at a real domain still passes — this is a domain check',
      (await checkEmail('no-such-person-9x7q@gmail.com')) === null);
  }

  console.log('\n--- the same domain is not looked up twice ---');
  // A DNS round trip on a normal connection costs about two seconds; a form
  // full of gmail addresses must not pay that once per submission.
  await emailDomainAcceptsMail('a@gmail.com');
  const started = Date.now();
  await emailDomainAcceptsMail('b@gmail.com');
  const second = Date.now() - started;
  check('a repeat domain answers from cache (' + second + 'ms)', second < 50);

  console.log('\n--- what a duplicate is called ---');
  const dup = (msg) => duplicateMessage({ code: 'ER_DUP_ENTRY', message: msg });
  check('a duplicate email says the email is taken',
    dup("Duplicate entry 'juan@x.com' for key 'users.uq_users_email'") === 'Email is already registered');
  check('and MariaDB\'s unqualified key name is recognised too',
    dup("Duplicate entry 'juan@x.com' for key 'uq_users_email'") === 'Email is already registered');
  check('a duplicate application id still says so',
    /application id/.test(dup("Duplicate entry 'LSA-2026-0009' for key 'uq_applicants_application_id'")));
  check('an unknown unique key gets a generic message, not MySQL\'s',
    dup("Duplicate entry 'x' for key 'uq_something_else'") === 'That record already exists.');
  check('the value the user typed is never echoed back',
    !dup("Duplicate entry 'juan@x.com' for key 'users.uq_users_email'").includes('juan@x.com'));
  check('a non-duplicate error is left alone',
    duplicateMessage({ code: 'ER_NO_SUCH_TABLE', message: 'x' }) === null
    && duplicateMessage(null) === null);

  console.log('');
  if (failures) {
    console.log(failures + ' CHECK(S) FAILED');
    process.exitCode = 1;
  } else {
    console.log('ALL EMAIL CHECKS PASSED');
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
