/**
 * UI accessibility baseline.
 *
 * Every check here corresponds to something the audit actually found broken —
 * colour that failed WCAG 1.4.3, controls that a keyboard could not reach, and
 * motion that ignored the user's system preference. Run it after any change to
 * the tokens, the navbar, or the click-handling markup.
 *
 *   node tests/accessibility_test.js
 */

require('dotenv').config();

const fs = require('fs');
const http = require('http');
const app = require('../app');
const { pool } = require('../config/database');
const userModel = require('../models/userModel');
const { signToken } = require('../middleware/auth');

let failures = 0;
function check(label, condition) {
  console.log((condition ? 'PASS  ' : 'FAIL  ') + label);
  if (!condition) failures += 1;
}

// ── WCAG contrast ───────────────────────────────────────────────────────────
function luminance(hex) {
  const c = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => {
    const v = parseInt(c.substr(i, 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Reads a custom property out of the :root block of style.css. */
function token(css, name) {
  const m = css.match(new RegExp('--' + name + ':\\s*(#[0-9a-fA-F]{3,8})'));
  return m ? m[1] : null;
}

function get(server, path, token_) {
  return new Promise((resolve, reject) => {
    const headers = token_ ? { Cookie: 'agri_token=' + token_ } : {};
    http.get({ host: '127.0.0.1', port: server.address().port, path, headers }, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => resolve({ status: res.statusCode, text: d }));
    }).on('error', reject);
  });
}

async function main() {
  const css = fs.readFileSync('public/css/style.css', 'utf8');
  const js = fs.readFileSync('public/js/main.js', 'utf8');

  const PAGE = token(css, 'bg-primary');
  const CARD = token(css, 'bg-secondary');

  console.log('--- colour: text must clear 4.5:1 on both grounds ---');
  // Every token below is used somewhere as reading text.
  for (const name of ['text-primary', 'text-secondary', 'primary-color', 'accent-color',
    'success-color', 'warning-text', 'danger-color', 'info-color', 'primary-light']) {
    const hex = token(css, name);
    if (!hex) { check(`--${name} is defined`, false); continue; }
    const onPage = contrast(hex, PAGE);
    const onCard = contrast(hex, CARD);
    check(`--${name} ${hex}: ${onPage.toFixed(2)}:1 page, ${onCard.toFixed(2)}:1 card`,
      onPage >= 4.5 && onCard >= 4.5);
  }

  console.log('\n--- colour: white text on a coloured fill ---');
  for (const name of ['primary-color', 'accent-color', 'success-color', 'danger-color',
    'info-color', 'primary-light']) {
    const hex = token(css, name);
    const r = contrast('#ffffff', hex);
    check(`white on --${name} ${hex}: ${r.toFixed(2)}:1`, r >= 4.5);
  }

  // Amber is the exception and is deliberately not in the list above: it is a
  // fill that must carry dark text, never white.
  const amber = token(css, 'warning-color');
  check(`--warning-color ${amber} takes dark text (${contrast('#2c3e50', amber).toFixed(2)}:1), not white`,
    contrast('#2c3e50', amber) >= 4.5);

  console.log('\n--- keyboard and motion ---');
  // The link and its target must ship together. They were split across two
  // partials, and the login and error pages include the header without a
  // navbar — so there the link pointed at an anchor that never rendered.
  const navbar = fs.readFileSync('views/partials/navbar.ejs', 'utf8');
  check('a skip link exists', navbar.includes('class="skip-link"'));
  check('and it is not duplicated', (navbar.match(/class="skip-link"/g) || []).length === 1);
  check('it lives in the same partial as its target, so it can never be orphaned',
    navbar.includes('id="main-content"'));
  check('and the header no longer ships a link with nothing to point at',
    !fs.readFileSync('views/partials/header.ejs', 'utf8').includes('skip-link'));
  check('the skip link is visible when focused', /\.skip-link:focus\s*\{[^}]*top:\s*0/.test(css));
  check('there is a global focus-visible ring', css.includes('[role="button"]:focus-visible'));
  check('reduced motion is honoured app-wide, not on one control',
    /@media \(prefers-reduced-motion: reduce\) \{\s*\*,/.test(css));
  check('Enter and Space activate elements that act as buttons',
    js.includes("e.key !== 'Enter'") && js.includes('[role="button"], [role="radio"]'));
  check('and real buttons are left alone so they do not fire twice',
    js.includes("el.matches('button, a, input, select, textarea')"));

  console.log('\n--- every click handler is reachable by keyboard ---');
  // The rule, not the instance: a click handler on something that is not
  // natively focusable needs a role and a tabindex, or the control is
  // mouse-only. This is what the audit found in six places.
  const offenders = [];
  for (const dir of ['views/pages', 'views/pages/accreditation', 'views/pages/admin', 'views/partials']) {
    for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.ejs'))) {
      const src = fs.readFileSync(dir + '/' + f, 'utf8');
      // Opening tags carrying an onclick, excluding natively focusable elements.
      for (const tag of src.match(/<(?!button|a |input|select|textarea|option)[a-z][^>]*\bonclick=[^>]*>/gi) || []) {
        if (!/\brole=/.test(tag) || !/\btabindex=/.test(tag)) {
          offenders.push(`${dir}/${f}: ${tag.replace(/\s+/g, ' ').slice(0, 70)}`);
        }
      }
    }
  }
  check('no click handler sits on an element a keyboard cannot reach'
    + (offenders.length ? '\n      ' + offenders.join('\n      ') : ''), offenders.length === 0);

  console.log('\n--- buttons ---');
  // .btn and Bootstrap's .btn-sm have the same specificity and this file loads
  // second, so the app's .btn padding silently won and every small button in
  // the app rendered at full size: the table row actions were 62x48 each,
  // which is why that column claimed 237px for three icons.
  const btnAt = css.indexOf('.btn {');
  const btnSmAt = css.indexOf('.btn-sm {');
  check('the size ladder is restored after the .btn override',
    btnAt !== -1 && btnSmAt > btnAt);
  check('.btn-sm still clears the 24px target minimum',
    /\.btn-sm\s*\{[^}]*padding:\s*(\d+)px/.test(css)
    && Number(css.match(/\.btn-sm\s*\{[^}]*padding:\s*(\d+)px/)[1]) * 2 + 16 >= 24);
  // `.btn { border: none }` also cancelled every outline button's outline.
  check('outline buttons get their border back',
    /\.btn\[class\*="btn-outline-"\]/.test(css));
  check('and their colours come from the tokens, not Bootstrap\'s #0d6efd',
    /\.btn-outline-primary\s*\{[^}]*var\(--primary-color\)/.test(css)
    && /\.btn-outline-danger\s*\{[^}]*var\(--danger-color\)/.test(css));

  console.log('\n--- form controls carry a real label ---');
  // A <label> that is only visually adjacent is decorative: a screen reader
  // reading the field announces "edit text, blank", and clicking the word does
  // not focus it. 40 of them were like that. A label wrapping its own control
  // is associated implicitly and is fine.
  const orphanLabels = [];
  const orphanFor = [];
  for (const dir of ['views/pages', 'views/pages/accreditation', 'views/pages/admin', 'views/partials']) {
    for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.ejs'))) {
      const src = fs.readFileSync(dir + '/' + f, 'utf8');
      for (const m of src.matchAll(/<label\b([^>]*)>([\s\S]*?)<\/label>/g)) {
        const [, attrs, inner] = m;
        if (/\bfor=/.test(attrs)) {
          // Every for= must name an id that exists in the same file.
          const id = attrs.match(/\bfor="([^"]+)"/);
          if (id && !id[1].includes('<%') && !src.includes(`id="${id[1]}"`)) {
            orphanFor.push(`${dir}/${f}: for="${id[1]}"`);
          }
          continue;
        }
        if (/<(input|select|textarea)\b/.test(inner)) continue;  // wraps its control
        orphanLabels.push(`${dir}/${f}: ${inner.replace(/\s+/g, ' ').trim().slice(0, 40)}`);
      }
    }
  }
  check('no label sits beside a control it is not attached to'
    + (orphanLabels.length ? '\n      ' + orphanLabels.join('\n      ') : ''), orphanLabels.length === 0);
  check('and no label points at an id that does not exist'
    + (orphanFor.length ? '\n      ' + orphanFor.join('\n      ') : ''), orphanFor.length === 0);

  console.log('\n--- the pages still render ---');
  const users = await userModel.findAllPublicProfiles();
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const home = await get(server, '/');
    check('/ renders', home.status === 200);
    // The login page has no navigation, so nothing to skip and no link.
    check('a page without a navbar ships neither the link nor a dangling target',
      !home.text.includes('skip-link') && !home.text.includes('id="main-content"'));
    // The role selector only renders when ALLOW_ROLE_SWITCH is on, so the
    // markup is checked at the source rather than in this response.
    const login = fs.readFileSync('views/pages/index.ejs', 'utf8');
    check('the role cards are a radio group, not four loose divs',
      login.includes('role="radiogroup"'));
    check('and each of the four is focusable', (login.match(/role="radio"/g) || []).length === 4);
    check('selecting one un-checks the others for a screen reader',
      login.includes("c.setAttribute('aria-checked', 'false')")
      && login.includes("el.setAttribute('aria-checked', 'true')"));

    const admin = users.find((u) => u.role === 'admin');
    const t = signToken(admin);
    for (const path of ['/dashboard', '/applicants', '/farms', '/community', '/services', '/compliance', '/profile', '/renewal']) {
      const res = await get(server, path, t);
      check(`${path} renders -> ${res.status}`, res.status === 200);
    }

    const dash = await get(server, '/dashboard', t);
    check('a page with a navbar ships both halves',
      dash.text.includes('skip-link') && dash.text.includes('id="main-content"'));
    check('the notification bell is a labelled, focusable control',
      dash.text.includes('aria-label="Notifications"') && dash.text.includes('role="button"'));
    check('the chatbot bubble is too', dash.text.includes('aria-label="Open AgriBot assistant"'));
  } finally {
    await new Promise((r) => server.close(r));
    await pool.end();
  }

  console.log('');
  if (failures) {
    console.log(failures + ' CHECK(S) FAILED');
    process.exitCode = 1;
  } else {
    console.log('ALL ACCESSIBILITY CHECKS PASSED');
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
