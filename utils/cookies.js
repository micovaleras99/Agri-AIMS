/**
 * Read a cookie value from the raw Cookie header (no cookie-parser dependency).
 * @param {import('express').Request} req
 * @param {string} name
 * @returns {string | null}
 */
function getCookie(req, name) {
  const raw = req.headers.cookie;
  if (!raw) return null;
  const parts = raw.split(';');
  for (const part of parts) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    if (k !== name) continue;
    return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return null;
}

const AUTH_COOKIE = 'agri_token';
const AUTH_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

/**
 * Issue the session cookie from the server. HttpOnly keeps it out of reach of
 * page scripts, so an XSS bug cannot read a visitor's token.
 * @param {import('express').Response} res
 * @param {string} token
 */
function setAuthCookie(res, token) {
  const parts = [
    `${AUTH_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${AUTH_MAX_AGE_SECONDS}`,
  ];
  if (process.env.NODE_ENV === 'production') parts.push('Secure');
  res.append('Set-Cookie', parts.join('; '));
}

/**
 * Expire the session cookie. Attributes must match setAuthCookie or the browser
 * keeps the original.
 * @param {import('express').Response} res
 */
function clearAuthCookie(res) {
  const parts = [`${AUTH_COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (process.env.NODE_ENV === 'production') parts.push('Secure');
  res.append('Set-Cookie', parts.join('; '));
}

module.exports = { getCookie, setAuthCookie, clearAuthCookie, AUTH_COOKIE };
