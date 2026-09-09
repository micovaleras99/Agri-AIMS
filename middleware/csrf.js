/**
 * CSRF protection using the double-submit cookie pattern.
 *
 * The session lives in a cookie, so a form on another site could make the
 * browser send an authenticated POST here. This issues a random token in a
 * readable cookie and requires the same value back in the request — something
 * only a page served from this origin can read and echo.
 *
 * (The widely cited `csurf` package has been unmaintained since 2022; this is
 * the same pattern, small enough to audit.)
 *
 * Every EJS form includes it as a hidden `_csrf` field via res.locals.csrfToken.
 * Browser fetch() calls send it as the `x-csrf-token` header.
 */

const crypto = require('crypto');
const fs = require('fs');
const { getCookie } = require('../utils/cookies');

const CSRF_COOKIE = 'agri_csrf';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Requests carrying `Authorization: Bearer` are not vulnerable: a browser will
 * not attach that header on a cross-site request, so the attacker would need
 * the token itself. Only cookie-authenticated requests need the check.
 */
function usesBearerToken(req) {
  const auth = req.headers.authorization;
  return typeof auth === 'string' && auth.startsWith('Bearer ');
}

/**
 * Endpoints that establish a session rather than act on one. There is no
 * session to protect yet, and they are documented as plain REST endpoints in
 * SETUP.md — they are covered by rate limiting instead.
 */
const EXEMPT_PATHS = new Set(['/api/auth/login', '/api/auth/register', '/api/auth/logout']);

function newToken() {
  return crypto.randomBytes(32).toString('hex');
}

/** Constant-time compare that tolerates differing lengths. */
function tokensMatch(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length || a.length === 0) {
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function issueCookie(res, token) {
  const parts = [
    `${CSRF_COOKIE}=${token}`,
    'Path=/',
    'SameSite=Lax',
    'Max-Age=86400',
  ];
  // Deliberately not HttpOnly: the page has to read it to echo it back.
  if (process.env.NODE_ENV === 'production') parts.push('Secure');
  res.append('Set-Cookie', parts.join('; '));
}

function csrfProtection(req, res, next) {
  let token = getCookie(req, CSRF_COOKIE);
  if (!token || !/^[a-f0-9]{64}$/.test(token)) {
    token = newToken();
    issueCookie(res, token);
  }
  res.locals.csrfToken = token;

  if (SAFE_METHODS.has(req.method)) return next();
  if (usesBearerToken(req)) return next();
  if (EXEMPT_PATHS.has(req.path)) return next();

  // A multipart body has not been parsed yet at this point — express.urlencoded
  // skips it, and the file parser runs later, inside the route. The token is in
  // that body, so there is nothing to compare here. Routes accepting uploads
  // must call verifyCsrf() after their parser; requireCsrfAfterUpload does that.
  if ((req.headers['content-type'] || '').startsWith('multipart/form-data')) return next();

  const supplied =
    (req.body && typeof req.body._csrf === 'string' && req.body._csrf) ||
    req.headers['x-csrf-token'] ||
    req.headers['x-xsrf-token'];

  if (tokensMatch(token, Array.isArray(supplied) ? supplied[0] : supplied)) {
    return next();
  }

  const message = 'Your session security token was missing or out of date. Go back, reload the page, and try again.';
  if (req.originalUrl.startsWith('/api')) {
    return res.status(403).json({ success: false, error: message, code: 'CSRF_TOKEN_INVALID' });
  }
  return res.status(403).render('pages/error', {
    title: 'Security Check Failed',
    code: 403,
    message,
  });
}

/**
 * Re-runs the token check once a multipart body is available.
 * Use directly after multer on any route that accepts a file.
 */
function requireCsrfAfterUpload(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();
  if (usesBearerToken(req)) return next();

  const supplied =
    (req.body && typeof req.body._csrf === 'string' && req.body._csrf) ||
    req.headers['x-csrf-token'] ||
    req.headers['x-xsrf-token'];

  if (tokensMatch(res.locals.csrfToken, Array.isArray(supplied) ? supplied[0] : supplied)) {
    return next();
  }
  // The parser already wrote the file to disk; do not leave it there.
  if (req.file && req.file.path) fs.unlink(req.file.path, () => {});

  return res.status(403).render('pages/error', {
    title: 'Security Check Failed',
    code: 403,
    message: 'Your session security token was missing or out of date. Go back, reload the page, and try again.',
  });
}

module.exports = { csrfProtection, requireCsrfAfterUpload, CSRF_COOKIE };
