/**
 * Document uploads.
 *
 * Files go to uploads/ under a random name. The name the farmer's file had is
 * kept only as a label in the database — it never touches the filesystem path,
 * so "../../.env" or a 300-character name cannot reach the disk.
 *
 * uploads/ is deliberately NOT served by express.static: accreditation
 * documents are private, so they go out through GET /documents/:id/file, which
 * applies the same role checks as the rest of the module.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const multer = require('multer');

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const MAX_BYTES = 10 * 1024 * 1024;

/** What ATI actually receives: scans and photos of documents. */
const ALLOWED = new Map([
  ['application/pdf', '.pdf'],
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
]);

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) =>
      cb(null, crypto.randomBytes(16).toString('hex') + (ALLOWED.get(file.mimetype) || '')),
  }),
  limits: { fileSize: MAX_BYTES, files: 1 },
  fileFilter: (req, file, cb) => {
    if (ALLOWED.has(file.mimetype)) return cb(null, true);
    // Rejected as a message, not a crash: the route turns this into a redirect.
    req.uploadRejected = 'type';
    cb(null, false);
  },
});

/**
 * Profile pictures. Same storage and the same random naming as documents — the
 * difference is what is accepted: a PDF is a fine accreditation document and a
 * useless avatar, and 10 MB of it would be loaded on every page that draws the
 * navbar. Images only, and a tenth of the size.
 */
const AVATAR_MAX_BYTES = 1024 * 1024;
const AVATAR_ALLOWED = new Map([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
]);

const avatarUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) =>
      cb(null, crypto.randomBytes(16).toString('hex') + (AVATAR_ALLOWED.get(file.mimetype) || '')),
  }),
  limits: { fileSize: AVATAR_MAX_BYTES, files: 1 },
  fileFilter: (req, file, cb) => {
    if (AVATAR_ALLOWED.has(file.mimetype)) return cb(null, true);
    req.uploadRejected = 'type';
    cb(null, false);
  },
});

/** "1.4 MB" / "812 KB" — the `size` column is a display string. */
function humanSize(bytes) {
  const n = Number(bytes) || 0;
  return n >= 1024 * 1024 ? (n / 1024 / 1024).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
}

/**
 * Absolute path for a stored file, or null if the name is not one of ours.
 * `.docx` is allowed for system-generated documents (services/selfAssessmentDoc.js),
 * which are written here under the same random-hex naming as uploads.
 */
function resolveStored(storedName) {
  if (!storedName || !/^[a-f0-9]{32}\.(pdf|jpg|png|webp|docx)$/.test(storedName)) return null;
  return path.join(UPLOAD_DIR, storedName);
}

/**
 * Deletes a stored file. Silent when it is already gone: callers are removing
 * database rows, and a missing file must not abort that.
 * @param {string|null|undefined} storedName
 */
function removeStored(storedName) {
  const abs = resolveStored(storedName);
  if (!abs) return;
  try { fs.unlinkSync(abs); } catch (err) { if (err.code !== 'ENOENT') throw err; }
}

module.exports = {
  upload, avatarUpload, humanSize, resolveStored, removeStored,
  UPLOAD_DIR, MAX_BYTES, ALLOWED, AVATAR_MAX_BYTES, AVATAR_ALLOWED,
};
