/**
 * Removes uploaded files that no database row references any more.
 *
 * Files reach uploads/ from two places and are named the same way — 32 hex
 * characters plus an extension: documentary requirements (documents.stored_name)
 * and profile pictures (users.photo). When a document row is deleted through the
 * app, its file goes with it (documentModel.removeWhere -> removeStored). But a
 * row removed OUTSIDE the app — a database reseed, a manual DELETE — never runs
 * that cleanup, so the file is left behind with nothing pointing at it.
 *
 * This finds those orphans. It is deliberately conservative:
 *
 *   - it considers BOTH tables, so a live avatar is never mistaken for an
 *     orphan just because it is not a document;
 *   - it only ever looks at files that match our own naming scheme, so anything
 *     hand-placed in the folder (README, .gitkeep, a stray export) is ignored;
 *   - it skips very recent files, so a file multer has just written for a
 *     request whose row has not committed yet is not reaped mid-upload.
 *
 *   node scripts/prune-uploads.js            list orphans (changes nothing)
 *   node scripts/prune-uploads.js --apply    delete them
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { pool } = require('../config/database');
const { UPLOAD_DIR, resolveStored, removeStored } = require('../config/upload');

// A file younger than this is left alone — it may belong to an upload still in
// flight. Five minutes is far longer than any request takes.
const MIN_AGE_MS = 5 * 60 * 1000;

function human(bytes) {
  const n = Number(bytes) || 0;
  return n >= 1024 * 1024 ? (n / 1024 / 1024).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
}

async function main() {
  const apply = process.argv.includes('--apply');

  // Everything a row still points at, from both tables.
  const referenced = new Set();
  const [docs] = await pool.query('SELECT stored_name FROM documents WHERE stored_name IS NOT NULL');
  for (const r of docs) referenced.add(r.stored_name);
  const [photos] = await pool.query("SELECT photo FROM users WHERE photo IS NOT NULL AND photo <> ''");
  for (const r of photos) referenced.add(r.photo);

  // Only files that follow our naming scheme are candidates — resolveStored
  // returns null for anything else, so it is skipped.
  const now = Date.now();
  const orphans = [];
  let skippedRecent = 0;
  for (const name of fs.readdirSync(UPLOAD_DIR)) {
    if (!resolveStored(name)) continue;            // not one of ours
    if (referenced.has(name)) continue;            // still in use
    const stat = fs.statSync(path.join(UPLOAD_DIR, name));
    if (now - stat.mtimeMs < MIN_AGE_MS) { skippedRecent += 1; continue; }
    orphans.push({ name, size: stat.size, mtime: stat.mtime.toISOString().slice(0, 10) });
  }

  console.log(`referenced by a row: ${referenced.size}  (${docs.length} documents, ${photos.length} photos)`);
  if (skippedRecent) console.log(`skipped ${skippedRecent} file(s) newer than 5 minutes`);

  if (!orphans.length) {
    console.log('\nNo orphaned files. Nothing to prune.');
    return;
  }

  const total = orphans.reduce((s, o) => s + o.size, 0);
  console.log(`\n${orphans.length} orphaned file(s), ${human(total)} total:`);
  for (const o of orphans) console.log(`  ${o.mtime}  ${human(o.size).padStart(7)}  ${o.name}`);

  if (!apply) {
    console.log('\nDry run. Re-run with --apply to delete these.');
    return;
  }

  for (const o of orphans) removeStored(o.name);
  console.log(`\nDeleted ${orphans.length} file(s), freeing ${human(total)}.`);
}

main()
  .then(() => pool.end())
  .catch(async (err) => {
    console.error(err);
    await pool.end().catch(() => {});
    process.exit(1);
  });
