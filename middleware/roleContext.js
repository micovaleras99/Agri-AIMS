/**
 * Resolves the signed-in user for EJS views.
 * Priority: valid JWT (Bearer header or agri_token cookie) → dev-only ?role= switcher.
 *
 * Guests get currentUser = null and role = 'guest'. Page access is enforced by
 * requireAuthPage — this middleware only identifies the caller, it never grants access.
 */

const jwt = require('jsonwebtoken');
const { navFor } = require('../config/navigation');
const classifications = require('../config/classifications');
const userModel = require('../models/userModel');
const logger = require('../utils/logger');
const { getTokenFromRequest } = require('./auth');
const { safeJson } = require('../utils/safeJson');

/**
 * The ?role= demo switcher signs a visitor in as any role without a password.
 * It stays off unless explicitly enabled outside production.
 */
function roleSwitchAllowed() {
  return process.env.NODE_ENV !== 'production' && process.env.ALLOW_ROLE_SWITCH === 'true';
}

async function roleContext(req, res, next) {
  try {
    let currentUser = null;

    const token = getTokenFromRequest(req);
    if (token && process.env.JWT_SECRET) {
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const found = await userModel.findById(Number(decoded.sub));
        // A still-valid token from an account deactivated mid-session must not
        // keep it signed in — treat a non-active account as a guest so the
        // lockout takes effect immediately, not only when the token expires.
        currentUser = found && found.isActive !== false && (!found.status || found.status === 'active')
          ? found
          : null;
      } catch {
        /* invalid or expired token — the caller stays a guest */
      }
    }

    if (!currentUser && req.query.role && roleSwitchAllowed()) {
      const users = await userModel.findAllPublicProfiles();
      currentUser = users.find((u) => u.role === req.query.role) || null;
    }

    res.locals.currentUser = currentUser;
    res.locals.role = currentUser ? currentUser.role : 'guest';
    // The navbar renders from this rather than repeating a block of markup per
    // role. A guest gets an empty list and the bar shows only the Log in button.
    res.locals.navItems = navFor(res.locals.role);
    // Views show success and error banners from the query string. Some routes
    // passed `query: req.query` and older ones did not, so guards written as
    // `typeof query !== 'undefined'` silently never fired — the geo-tag success
    // and failure alerts on the application page had never once appeared.
    res.locals.query = req.query;
    // Serializer for data embedded in a <script> tag — escapes `</script>` so a
    // user-controlled value cannot break out. Views must use this, never a bare
    // JSON.stringify, wherever they inline data into a script.
    res.locals.safeJson = safeJson;
    // Classification is stored as a key; the views show the Guidelines'
    // wording for it. Exposing the lookup here keeps every page saying the
    // same thing without each one importing the config.
    res.locals.classificationLabel = classifications.labelFor;
    // The applicant form renders its options from these, grouped the way the
    // Guidelines group them: farming activities, then agri-processing.
    res.locals.classificationOptions = {
      farming: classifications.farming(),
      processing: classifications.processing(),
    };
    next();
  } catch (err) {
    logger.error('roleContext failed', err);
    next(err);
  }
}

module.exports = { roleContext, roleSwitchAllowed };
