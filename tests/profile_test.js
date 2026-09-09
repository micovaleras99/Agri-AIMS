/**
 * Profile page + self-service account edit.
 *
 * The page writes through PUT /api/users/:id, so what matters is that the
 * endpoint lets a user change their own name and password while refusing to
 * let them promote themselves — and that a rejected password leaves nothing
 * half-written.
 *
 *   node tests/profile_test.js
 */

require('dotenv').config();

const bcrypt = require('bcrypt');
const fs = require('fs');
const http = require('http');
const app = require('../app');
const { pool } = require('../config/database');
const userModel = require('../models/userModel');
const { signToken } = require('../middleware/auth');
const { resolveStored } = require('../config/upload');

let failures = 0;
function check(label, condition) {
  if (condition) {
    console.log('PASS  ' + label);
  } else {
    console.log('FAIL  ' + label);
    failures += 1;
  }
}

const START_PASSWORD = 'StartPw#2026';
const NEW_PASSWORD = 'ChangedPw#2026';

function request(server, method, path, { token, csrf, body, raw, contentType } = {}) {
  return new Promise((resolve, reject) => {
    const payload = raw || (body ? JSON.stringify(body) : null);
    const headers = {};
    if (payload) {
      headers['Content-Type'] = contentType || 'application/json';
      headers['Content-Length'] = Buffer.byteLength(payload);
    }
    // Cookie auth is what the browser actually uses, and it is the path the
    // CSRF check guards — so the test exercises that, not Bearer.
    const cookies = [];
    if (token) cookies.push('agri_token=' + token);
    if (csrf) {
      cookies.push('agri_csrf=' + csrf);
      headers['x-csrf-token'] = csrf;
    }
    if (cookies.length) headers.Cookie = cookies.join('; ');

    const req = http.request(
      { host: '127.0.0.1', port: server.address().port, method, path, headers },
      (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => {
          let json = null;
          try { json = JSON.parse(data); } catch { /* an HTML page, not JSON */ }
          resolve({ status: res.statusCode, headers: res.headers, json, text: data });
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/** The smallest valid PNG — a 1x1 pixel, so the test needs no fixture file. */
function pngBytes() {
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
  );
}

/** POSTs a multipart body by hand — the browser's form, without a browser. */
function upload(server, { token, csrf, filename, type, bytes }) {
  const boundary = '----agriaims' + Date.now();
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="_csrf"\r\n\r\n${csrf}\r\n`),
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="photo"; filename="${filename}"\r\n`
      + `Content-Type: ${type}\r\n\r\n`
    ),
    bytes,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return request(server, 'POST', '/profile/photo', {
    token, csrf, raw: body, contentType: `multipart/form-data; boundary=${boundary}`,
  });
}

async function main() {
  const email = `profile.test.${Date.now()}@example.com`;
  const id = await userModel.createUser({
    firstName: 'Profile',
    lastName: 'Probe',
    email,
    passwordHash: await bcrypt.hash(START_PASSWORD, 12),
    role: 'applicant',
    position: '',
    office: '',
    region: 'Region V',
    avatar: 'PP',
    phone: '',
  });
  const token = signToken({ id, role: 'applicant', email });
  const csrf = 'a'.repeat(64);

  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));

  try {
    const page = await request(server, 'GET', '/profile', { token });
    check('/profile renders for a signed-in user -> 200', page.status === 200);
    check('it shows the change-password form', page.text.includes('id="passwordForm"'));
    check('it shows the current-password field', page.text.includes('name="currentPassword"'));
    check('a farmer is not offered the ATI position field', !page.text.includes('name="position"'));

    const anon = await request(server, 'GET', '/profile');
    check('a signed-out visitor is redirected to sign in', anon.status === 302);

    // The page's script was written without a nonce and the Content-Security-
    // Policy refused to run it, so the camera button and both forms were dead
    // in a browser while every API check here still passed. This is the check
    // that sees it — across all views, since the mistake is not page-specific.
    const bare = [];
    for (const dir of ['views/pages', 'views/pages/accreditation', 'views/pages/admin', 'views/partials']) {
      for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.ejs'))) {
        const src = fs.readFileSync(dir + '/' + f, 'utf8');
        // <script src="..."> is external and needs no nonce, and a data block
        // (type="application/json") is never executed. An inline JS block does.
        for (const tag of src.match(/<script(?![^>]*\ssrc=)[^>]*>/g) || []) {
          const isData = /type\s*=\s*"(?!text\/javascript|module)/.test(tag);
          if (!isData && !tag.includes('nonce=')) bare.push(dir + '/' + f);
        }
      }
    }
    check('every inline <script> in every view carries the CSP nonce'
      + (bare.length ? ': ' + [...new Set(bare)].join(', ') : ''), bare.length === 0);

    // --- the profile fields ---
    const rename = await request(server, 'PUT', `/api/users/${id}`, {
      token, csrf, body: { firstName: 'Renamed', lastName: 'Probe', email, phone: '09171234567' },
    });
    check('a user can edit their own name and phone', rename.status === 200 && rename.json.success);
    const afterRename = await userModel.findById(id);
    check('the new name is stored: ' + afterRename.firstName, afterRename.firstName === 'Renamed');
    check('the phone is stored', afterRename.phone === '09171234567');

    // --- the role guard: the whole reason this page posts to the API ---
    const escalate = await request(server, 'PUT', `/api/users/${id}`, {
      token, csrf, body: { role: 'admin' },
    });
    check('a user cannot promote themselves -> 403', escalate.status === 403);
    check('and the stored role is unchanged', (await userModel.findById(id)).role === 'applicant');

    // --- the password ---
    const noCurrent = await request(server, 'PUT', `/api/users/${id}`, {
      token, csrf, body: { password: NEW_PASSWORD },
    });
    check('changing your own password without the current one is refused', noCurrent.status === 400);

    const wrongCurrent = await request(server, 'PUT', `/api/users/${id}`, {
      token, csrf, body: { currentPassword: 'NotTheOne#1', password: NEW_PASSWORD },
    });
    check('a wrong current password is refused', wrongCurrent.status === 400);

    // The ordering defect: a weak password used to return 400 with the name
    // already written.
    const weak = await request(server, 'PUT', `/api/users/${id}`, {
      token,
      csrf,
      body: { firstName: 'ShouldNotStick', currentPassword: START_PASSWORD, password: 'weak' },
    });
    check('a weak password is refused -> 400', weak.status === 400);
    check('and the rejected request wrote nothing at all',
      (await userModel.findById(id)).firstName === 'Renamed');

    const ok = await request(server, 'PUT', `/api/users/${id}`, {
      token, csrf, body: { currentPassword: START_PASSWORD, password: NEW_PASSWORD },
    });
    check('the correct current password lets the change through', ok.status === 200);

    const stored = await userModel.findByIdWithHash(id);
    check('the new password verifies', await bcrypt.compare(NEW_PASSWORD, stored.passwordHash));
    check('the old password no longer does', !(await bcrypt.compare(START_PASSWORD, stored.passwordHash)));

    // --- CSRF, since the page relies on it ---
    const noCsrf = await request(server, 'PUT', `/api/users/${id}`, {
      token, body: { firstName: 'ViaForgedForm' },
    });
    check('a cookie-authenticated write without the CSRF token is refused', noCsrf.status === 403);

    // --- the profile picture ---
    check('the page starts on initials, not a photo', !page.text.includes('/profile/photo/' + id));

    const rejected = await upload(server, {
      token, csrf, filename: 'notes.pdf', type: 'application/pdf', bytes: Buffer.from('%PDF-1.4'),
    });
    check('a PDF is refused as a profile picture', rejected.headers.location === '/profile?error=phototype');
    check('and nothing was recorded', (await userModel.findById(id)).photo === null);

    const png = pngBytes();
    const accepted = await upload(server, {
      token, csrf, filename: 'me.png', type: 'image/png', bytes: png,
    });
    check('a PNG is accepted', accepted.headers.location === '/profile?success=photo');

    const withPhoto = await userModel.findById(id);
    check('the stored name is a generated one, never the uploaded filename',
      /^[a-f0-9]{32}\.png$/.test(withPhoto.photo || ''));
    const firstFile = resolveStored(withPhoto.photo);
    check('the file is on disk', Boolean(firstFile) && fs.existsSync(firstFile));

    const served = await request(server, 'GET', `/profile/photo/${id}`, { token });
    check('the picture is served back -> 200', served.status === 200);

    const shown = await request(server, 'GET', '/profile', { token });
    check('the profile page now draws the photo', shown.text.includes('/profile/photo/' + id));
    check('and offers to remove it', shown.text.includes('/profile/photo/remove'));

    // Replacing it must not leave the old file behind in uploads/.
    await upload(server, { token, csrf, filename: 'me2.png', type: 'image/png', bytes: png });
    const replaced = await userModel.findById(id);
    check('replacing the picture stores a new name', replaced.photo !== withPhoto.photo);
    check('and deletes the file it replaced', !fs.existsSync(firstFile));

    const secondFile = resolveStored(replaced.photo);
    const removed = await request(server, 'POST', '/profile/photo/remove', {
      token, csrf, body: {},
    });
    check('the picture can be removed', removed.headers.location === '/profile?success=photoremoved');
    check('the column goes back to NULL', (await userModel.findById(id)).photo === null);
    check('and that file is gone too', !fs.existsSync(secondFile));

    const gone = await request(server, 'GET', `/profile/photo/${id}`, { token });
    check('serving a removed picture is a 404, not a stale file', gone.status === 404);

    // uploads/ holds accreditation documents as well; the photo route must not
    // become a way to read them.
    const notAPhoto = await request(server, 'GET', '/profile/photo/999999', { token });
    check('an unknown user has no picture -> 404', notAPhoto.status === 404);
  } finally {
    await userModel.remove(id);
    await new Promise((r) => server.close(r));
    await pool.end();
  }

  console.log('');
  if (failures) {
    console.log(failures + ' CHECK(S) FAILED');
    process.exitCode = 1;
  } else {
    console.log('ALL PROFILE CHECKS PASSED');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
