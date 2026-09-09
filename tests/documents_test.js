/**
 * Per-document accept / reject with remarks.
 *
 * `documents.status` and `documents.remarks` were read by the dashboard, the
 * documents filter, and Step 6's endorsement packet, and written by nothing —
 * a grep for "UPDATE documents" across the project returned no hits, so every
 * upload stayed pending_review for good. Step 4 recorded one verdict for the
 * whole application and never said which document was at fault.
 *
 *   node tests/documents_test.js
 */

require('dotenv').config();

const fs = require('fs');
const http = require('http');
const app = require('../app');
const { pool } = require('../config/database');
const documentModel = require('../models/documentModel');
const userModel = require('../models/userModel');
const { signToken } = require('../middleware/auth');

let failures = 0;
function check(label, condition) {
  console.log((condition ? 'PASS  ' : 'FAIL  ') + label);
  if (!condition) failures += 1;
}

/** A form POST carrying the cookie-and-field CSRF pair the app expects. */
function post(server, path, token, fields) {
  return new Promise((resolve, reject) => {
    // csrfProtection replaces any cookie that is not 64 hex characters,
    // and then nothing the form sends can match it.
    const csrf = "a".repeat(64);
    const body = new URLSearchParams({ ...fields, _csrf: csrf }).toString();
    const req = http.request({
      host: '127.0.0.1', port: server.address().port, path, method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
        Cookie: `agri_token=${token}; agri_csrf=${csrf}`,
      },
    }, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => resolve({ status: res.statusCode, location: res.headers.location, text: d }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

function get(server, path, token) {
  return new Promise((resolve, reject) => {
    http.get({
      host: '127.0.0.1', port: server.address().port, path,
      headers: { Cookie: `agri_token=${token}` },
    }, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => resolve({ status: res.statusCode, text: d }));
    }).on('error', reject);
  });
}

async function main() {
  console.log('--- the model refuses decisions that would be useless ---');
  const users = await userModel.findAllPublicProfiles();
  const admin = users.find((u) => u.role === 'admin');
  // Certifying an application promotes its account to operator, so the database
  // can legitimately hold no applicant at all. The refusal below is about
  // authorisation, not about what happens to be seeded — make the account it
  // needs rather than skipping the check.
  let applicantUser = users.find((u) => u.role === 'applicant');
  let temporaryApplicant = null;
  if (!applicantUser) {
    temporaryApplicant = await userModel.createUser({
      firstName: 'Doc', lastName: 'Refusal',
      email: `doc.refusal.${Date.now()}@example.com`,
      passwordHash: 'not-a-login', role: 'applicant',
    });
    applicantUser = await userModel.findById(temporaryApplicant);
  }

  const [[anyApplicant]] = await pool.query('SELECT id FROM applicants ORDER BY id LIMIT 1');
  if (!anyApplicant) {
    console.log('SKIP  no applicant rows in the database; seed one and re-run');
    await pool.end();
    return;
  }
  const APPLICANT_ID = anyApplicant.id;

  // A document to experiment on, created and removed by this test.
  const docId = await documentModel.create({
    applicantId: APPLICANT_ID,
    applicationId: 'TEST-REVIEW',
    applicantName: 'Review Test',
    name: 'Test Requirement',
    type: 'other',
    filename: 'test.pdf',
    storedName: null,
    mimeType: 'application/pdf',
    sizeBytes: 1024,
    size: '1 KB',
    uploadDate: new Date().toISOString().split('T')[0],
    status: 'pending_review',
    remarks: '',
  });

  try {
    check('a status the app does not use is refused',
      (await documentModel.review(docId, { status: 'approved', remarks: 'x', reviewerId: admin.id })) === null);
    // This is the whole point of the feature: an applicant told to fix a
    // document must be told what is wrong with it.
    check('a rejection with no reason is refused',
      (await documentModel.review(docId, { status: 'incomplete', remarks: '   ', reviewerId: admin.id })) === null);
    check('and the document is untouched by a refused decision',
      (await documentModel.findById(docId)).status === 'pending_review');

    const accepted = await documentModel.review(docId, {
      status: 'verified', remarks: 'Legible and complete.', reviewerId: admin.id,
    });
    check('an acceptance is recorded', accepted && accepted.status === 'verified');
    check('with its remarks', accepted.remarks === 'Legible and complete.');
    check('and who decided it', accepted.reviewedBy === admin.id && !!accepted.reviewedAt);
    check('the reviewer is named, not just numbered', !!accepted.reviewedByName);
    // An acceptance needs no reason — only a rejection does.
    check('an acceptance with no remarks is allowed',
      (await documentModel.review(docId, { status: 'verified', remarks: '', reviewerId: admin.id })) !== null);

    console.log('\n--- through the real route ---');
    const server = http.createServer(app);
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    try {
      const adminToken = signToken(admin);

      const rejected = await post(server, `/documents/${docId}/review`, adminToken,
        { status: 'incomplete', remarks: 'Page 2 is unreadable.' });
      check('an evaluator can reject with a reason -> ' + rejected.status, rejected.status === 302);
      check('and is sent back with a confirmation', /success=rejected/.test(rejected.location || ''));
      const afterReject = await documentModel.findById(docId);
      check('the document now says what is wrong',
        afterReject.status === 'incomplete' && afterReject.remarks === 'Page 2 is unreadable.');

      const noReason = await post(server, `/documents/${docId}/review`, adminToken,
        { status: 'incomplete', remarks: '' });
      check('a rejection with no reason is turned away by the route too',
        /error=review/.test(noReason.location || ''));

      const backToStep4 = await post(server, `/documents/${docId}/review`, adminToken,
        { status: 'verified', remarks: 'Replacement is clear.', back: 'step4' });
      check('deciding from the Step 4 worksheet returns to it',
        new RegExp(`/accreditation/${APPLICANT_ID}/step/4\\?success=accepted`)
          .test(backToStep4.location || ''));

      if (applicantUser) {
        const denied = await post(server, `/documents/${docId}/review`, signToken(applicantUser),
          { status: 'verified', remarks: 'mine is fine' });
        check('an applicant cannot review their own document -> ' + denied.status, denied.status === 403);
        const stillVerified = await documentModel.findById(docId);
        check('and nothing changed when they tried', stillVerified.remarks === 'Replacement is clear.');
      } else {
        console.log('SKIP  no applicant account to test the refusal with');
      }

      const missing = await post(server, '/documents/99999999/review', adminToken,
        { status: 'verified', remarks: '' });
      check('a document that does not exist is a 404, not a crash', missing.status === 404);

      console.log('\n--- Step 4 cannot be passed over undecided documents ---');
      // Passing Step 4 builds the Step 6 endorsement packet from verified rows
      // only, so a pass with documents still pending would endorse an
      // application on paperwork nobody read and quietly drop the rest.
      const { canPassStep4 } = require('../controllers/accreditationHelpers');
      check('an empty application cannot be passed', !canPassStep4([]).ok);
      check('a pending document blocks the pass',
        !canPassStep4([{ status: 'verified' }, { status: 'pending_review' }]).ok);
      check('a rejected document blocks it too',
        !canPassStep4([{ status: 'verified' }, { status: 'incomplete' }]).ok);
      check('and the reason names both counts',
        /1 still awaiting a decision and 1 marked for revision/.test(
          canPassStep4([{ status: 'pending_review' }, { status: 'incomplete' }]).reason));
      check('all verified passes the gate',
        canPassStep4([{ status: 'verified' }, { status: 'verified' }]).ok);

      // The page hides the button, but the page is not the authority: a stale
      // tab or a direct POST reaches the route regardless.
      //
      // This check stages its own blocking condition rather than assuming the
      // applicant has other undecided documents. It did assume that, and on a
      // reseeded database — where this test's document was the only one and had
      // just been accepted — the gate correctly opened and the POST advanced a
      // real application to step 5. A test must not be able to do that.
      const applicantModel = require('../models/applicantModel');
      await documentModel.review(docId, {
        status: 'pending_review', remarks: '', reviewerId: admin.id,
      });
      const before = await applicantModel.findById(APPLICANT_ID);
      const forced = await post(server, `/accreditation/${APPLICANT_ID}/step/4`, adminToken,
        { evalResult: 'passed', evalRemarks: 'this must not go through' });
      check('a direct POST past a stale page is turned back',
        /step\/4\?blocked=1/.test(forced.location || ''));
      const after = await applicantModel.findById(APPLICANT_ID);
      check('and the application did not advance',
        after.accreditationStep === before.accreditationStep
        && Number(after.progress) === Number(before.progress)
        && after.status === before.status);

      console.log('\n--- the pages show it ---');
      const list = await get(server, '/documents', adminToken);
      check('/documents renders', list.status === 200);
      check('staff see the decision controls', list.text.includes('/review'));

      // The stylesheet defines .status-badge.pending_review with an underscore;
      // the view used to hyphenate it, so the commonest status had no colour.
      const css = fs.readFileSync('public/css/ejs-styles.css', 'utf8');
      for (const st of ['verified', 'pending_review', 'incomplete']) {
        check(`.status-badge.${st} exists for the class the view emits`,
          css.includes(`.status-badge.${st}`));
      }
      check('the view no longer hyphenates the status into a class that matches nothing',
        !fs.readFileSync('views/pages/documents.ejs', 'utf8').includes('status.replace(\'_\',\'-\')'));

      const step4 = await get(server, `/accreditation/${APPLICANT_ID}/step/4`, adminToken);
      check('the Step 4 worksheet renders', step4.status === 200);
      // It used to print this as text: the status cell was never closed and
      // the remarks cell had lost its opening tag.
      check('and no longer prints raw markup where the status belongs',
        !step4.text.includes('class="text-muted small">\n'));
      check('the worksheet offers a decision per document',
        step4.text.includes('name="back" value="step4"'));

      if (applicantUser) {
        const asApplicant = await get(server, '/documents', signToken(applicantUser));
        check('an applicant sees the outcome but not the buttons',
          asApplicant.status === 200 && !asApplicant.text.includes('name="status" value="incomplete"'));
      }
    } finally {
      await new Promise((r) => server.close(r));
    }
  } finally {
    await documentModel.removeWhere('id = ?', [docId]);
    if (temporaryApplicant) {
      await pool.query('DELETE FROM users WHERE id = ?', [temporaryApplicant]);
    }
    await pool.query('DELETE FROM notifications WHERE title LIKE ?', ['%Test Requirement%']);
    await pool.end();
  }

  console.log('');
  if (failures) {
    console.log(failures + ' CHECK(S) FAILED');
    process.exitCode = 1;
  } else {
    console.log('ALL DOCUMENT CHECKS PASSED');
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
