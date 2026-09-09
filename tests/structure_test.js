/**
 * Static sweep for the "renders fine, does nothing" bug class.
 *
 * Every rule here is a generalisation of a defect already found by hand in this
 * project: a form posting to a route that does not exist, an inline script with
 * no CSP nonce, a form with no CSRF field, a column read everywhere and written
 * nowhere, and a view printing an attribute as text.
 *
 *   node tests/structure_test.js   (run from the project root)
 */

const fs = require('fs');
const path = require('path');

const findings = [];
const report = (kind, where, detail) => findings.push({ kind, where, detail });

// ── inventory ──────────────────────────────────────────────────────────────
function walk(dir, ext, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (['node_modules', '.git', 'uploads', 'backups'].includes(e.name)) continue;
      walk(p, ext, out);
    } else if (p.endsWith(ext)) out.push(p);
  }
  return out;
}

const views = walk('views', '.ejs');
const routeFiles = walk('routes', '.js');
const modelFiles = walk('models', '.js');

// ── 1. every route the app actually serves ─────────────────────────────────
const appSrc = fs.readFileSync('app.js', 'utf8');
const mounts = [];
for (const m of appSrc.matchAll(/app\.use\(\s*'([^']+)'[^)]*require\('\.\/(routes\/[^']+)'\)/g)) {
  // require('./routes/api') resolves to routes/api/index.js — a directory
  // router, which the first version of this sweep missed entirely and then
  // reported every /api fetch in the app as pointing at nothing.
  const asFile = m[2] + '.js';
  const asDir = m[2] + '/index.js';
  mounts.push({ prefix: m[1], file: fs.existsSync(asFile) ? asFile : asDir });
}

/** '/farms/:id/edit' -> a regex that matches a concrete URL path. */
function routeToRe(full) {
  const body = full
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/:[A-Za-z0-9_]+/g, '[^/]+');
  return new RegExp('^' + body + '/?$');
}

const routes = { GET: [], POST: [] };
for (const { prefix, file } of mounts) {
  if (!fs.existsSync(file)) { report('missing router', 'app.js', file); continue; }
  const src = fs.readFileSync(file, 'utf8');
  for (const m of src.matchAll(/router\.(get|post|put|patch|delete)\(\s*'([^']*)'/g)) {
    const method = m[1].toUpperCase();
    const full = (prefix === '/' ? '' : prefix) + (m[2] === '/' ? '' : m[2]);
    const url = full || '/';
    (routes[method] || (routes[method] = [])).push({ url, re: routeToRe(url), file });
  }
}
// Sub-routers. routes/api/index.js requires its children into consts first and
// mounts the variable — matching only an inline require() missed every /api
// route and then reported all fifteen /api fetches in the app as broken.
for (const f of routeFiles) {
  const src = fs.readFileSync(f, 'utf8');
  const norm = f.replace(/\\/g, '/');
  const parent = mounts.find((x) => x.file === norm);
  if (!parent) continue;

  const imports = {};
  for (const im of src.matchAll(/(?:const|let)\s+(\w+)\s*=\s*require\('\.\/([^']+)'\)/g)) {
    imports[im[1]] = im[2];
  }

  for (const m of src.matchAll(/router\.use\(\s*'([^']+)'\s*,\s*(?:require\('\.\/([^']+)'\)|(\w+))\s*\)/g)) {
    const rel = m[2] || imports[m[3]];
    if (!rel) continue;
    let child = path.join(path.dirname(f), rel + '.js');
    if (!fs.existsSync(child)) child = path.join(path.dirname(f), rel, 'index.js');
    if (!fs.existsSync(child)) continue;
    const base = parent.prefix === '/' ? '' : parent.prefix;
    const csrc = fs.readFileSync(child, 'utf8');
    for (const r of csrc.matchAll(/router\.(get|post|put|patch|delete)\(\s*'([^']*)'/g)) {
      const method = r[1].toUpperCase();
      const url = base + m[1] + (r[2] === '/' ? '' : r[2]);
      (routes[method] || (routes[method] = [])).push({ url, re: routeToRe(url), file: child });
    }
  }
}

const served = (method, url) => (routes[method] || []).some((r) => r.re.test(url));

// ── 2. forms and fetches that point at nothing ─────────────────────────────
// An EJS expression inside the URL makes it unresolvable here; those are
// reduced to a wildcard segment rather than skipped, so /farms/<%= id %>/edit
// is still checked against /farms/:id/edit.
function concrete(url) {
  const u = url.split('?')[0].replace(/<%[-=]?[\s\S]*?%>/g, 'X');
  return u.startsWith('/') ? u : null;
}

for (const v of views) {
  const src = fs.readFileSync(v, 'utf8');

  for (const m of src.matchAll(/<form\b([^>]*)>/gi)) {
    const attrs = m[1];
    const action = (attrs.match(/action="([^"]*)"/) || [])[1];
    const method = ((attrs.match(/method="([^"]*)"/) || [])[1] || 'GET').toUpperCase();
    if (!action) continue;
    const u = concrete(action);
    if (!u) continue;
    if (!served(method, u) && !served(method === 'GET' ? 'POST' : 'GET', u)) {
      report('form posts to a route that does not exist', v, `${method} ${u}`);
    }
  }

  for (const m of src.matchAll(/fetch\(\s*[`'"]([^`'"]+)[`'"]/g)) {
    const u = concrete(m[1]);
    if (!u || u.startsWith('//')) continue;
    if (!served('GET', u) && !served('POST', u) && !served('PUT', u)
      && !served('PATCH', u) && !served('DELETE', u)) {
      report('fetch() calls a route that does not exist', v, u);
    }
  }
}

// public/js too — the same call, just not inline.
for (const f of walk('public/js', '.js')) {
  const src = fs.readFileSync(f, 'utf8');
  for (const m of src.matchAll(/fetch\(\s*[`'"](\/[^`'"$]+)[`'"]/g)) {
    const u = concrete(m[1]);
    if (!u) continue;
    if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].some((mm) => served(mm, u))) {
      report('fetch() calls a route that does not exist', f, u);
    }
  }
}

// ── 3. CSP nonce on inline scripts ─────────────────────────────────────────
// An inline <script> without the nonce is refused by the browser and the whole
// block silently does nothing — this cost a working profile page once already.
for (const v of views) {
  const src = fs.readFileSync(v, 'utf8');
  for (const m of src.matchAll(/<script\b([^>]*)>/gi)) {
    const attrs = m[1];
    if (/\bsrc=/.test(attrs)) continue;
    if (/type="application\/(ld\+)?json"/.test(attrs)) continue;
    if (!/nonce=/.test(attrs)) report('inline <script> with no CSP nonce', v, attrs.trim().slice(0, 50) || '<script>');
  }
}

// ── 4. state-changing forms without a CSRF field ───────────────────────────
for (const v of views) {
  const src = fs.readFileSync(v, 'utf8');
  for (const m of src.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)) {
    const method = ((m[1].match(/method="([^"]*)"/) || [])[1] || 'GET').toUpperCase();
    if (method === 'GET') continue;
    if (!/_csrf/.test(m[2])) {
      report('POST form with no _csrf field', v, (m[1].match(/action="([^"]*)"/) || [])[1] || '?');
    }
  }
}

// ── 5. columns read everywhere and written nowhere ─────────────────────────
// This is the documents.status bug stated as a rule: a column that appears in
// SELECT/WHERE but in no INSERT or UPDATE is a value the system can display and
// filter on but never change.
const schema = fs.readFileSync('database/schema.sql', 'utf8');
// scripts/ and services/ write too: the PSGC reference tables are loaded once
// by scripts/seed-locations.js, and leaving it out reported four correct
// columns as read-but-never-written.
const allSql = [...modelFiles, ...routeFiles, ...walk('scripts', '.js'), ...walk('services', '.js')]
  .map((f) => fs.readFileSync(f, 'utf8')).join('\n');
const migrations = walk('database/migrations', '.sql').map((f) => fs.readFileSync(f, 'utf8')).join('\n');

for (const t of schema.matchAll(/CREATE TABLE `(\w+)` \(([\s\S]*?)\n\) ENGINE/g)) {
  const table = t[1];
  const cols = [...t[2].matchAll(/^\s*`(\w+)`\s+[A-Z]/gm)].map((c) => c[1]);
  for (const col of cols) {
    if (['id', 'created_at', 'updated_at'].includes(col)) continue;
    const read = new RegExp(`\\b${col}\\b`).test(allSql);
    if (!read) continue;
    // Written by an INSERT column list, a SET clause, or a camelCase model field.
    const camel = col.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    const written = new RegExp(
      `SET[\\s\\S]{0,400}\\b${col}\\b\\s*=|` +
      `INSERT[\\s\\S]{0,600}\\b${col}\\b|` +
      `\\b${camel}\\b\\s*[:,]`, 'i'
    ).test(allSql) || new RegExp(`\\b${col}\\b`).test(migrations) === false;
    if (!written) report('column is read but never written', table, col);
  }
}

// ── 6. markup that cannot be right ─────────────────────────────────────────
for (const v of views) {
  const src = fs.readFileSync(v, 'utf8');
  // An attribute list appearing as text content, which is what a lost opening
  // tag looks like — exactly the Step 4 status cell.
  for (const m of src.matchAll(/>\s*\n?\s*(class|style|id|name|href|value)="[^"]*">/g)) {
    report('attribute printed as text — a tag lost its opening', v, m[0].replace(/\s+/g, ' ').slice(0, 60));
  }
  // colspan wider than its OWN table's header row. Checked per <table> — a
  // view can hold several tables of different widths (the dashboard has six),
  // so comparing every colspan against the file's first thead is wrong.
  for (const tbl of src.matchAll(/<table\b[\s\S]*?<\/table>/g)) {
    const block = tbl[0];
    const head = block.match(/<thead>([\s\S]*?)<\/thead>/);
    if (!head) continue;
    const ths = (head[1].match(/<th\b/g) || []).length;
    for (const m of block.matchAll(/colspan="(\d+)"/g)) {
      if (ths && Number(m[1]) > ths) {
        report('colspan is wider than the table', v, `colspan=${m[1]} but ${ths} columns`);
      }
    }
  }
}

// ── report ─────────────────────────────────────────────────────────────────
const byKind = {};
for (const f of findings) (byKind[f.kind] || (byKind[f.kind] = [])).push(f);
for (const [kind, list] of Object.entries(byKind)) {
  console.log(`\n## ${kind} (${list.length})`);
  for (const f of list.slice(0, 25)) console.log(`   ${f.where}: ${f.detail}`);
  if (list.length > 25) console.log(`   ... and ${list.length - 25} more`);
}
console.log(`\n${findings.length} finding(s) across ${views.length} views and ${routeFiles.length} route files`);
if (findings.length) process.exitCode = 1;
console.log(`routes served: ${Object.entries(routes).map(([m, r]) => m + '=' + r.length).join(' ')}`);
