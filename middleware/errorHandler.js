/**
 * JSON error responses for /api/* and centralized HTML error passthrough.
 */

const logger = require('../utils/logger');

/**
 * A unique-key violation, turned into something a person can act on.
 *
 * MySQL's own text ("Duplicate entry 'juan@x.com' for key 'uq_users_email'")
 * must never be shown: it echoes the value back and names the schema. The key
 * name is the only part worth reading, and it says which field clashed.
 *
 * @param {{ code?: string, message?: string }} err
 * @returns {string|null} the message to show, or null if this is not a
 *          duplicate-key error
 */
function duplicateMessage(err) {
  if (!err || err.code !== 'ER_DUP_ENTRY') return null;
  const key = String(err.message || '');
  if (/uq_users_email/i.test(key)) return 'Email is already registered';
  if (/application_id/i.test(key)) return 'Could not allocate a unique application id. Please try again.';
  return 'That record already exists.';
}

function notFoundApi(req, res) {
  res.status(404).json({ success: false, error: 'Resource not found', path: req.originalUrl });
}

function errorHandler(err, req, res, next) {
  if (res.headersSent) {
    return next(err);
  }

  logger.error('Request failed', err);

  // Two registration paths can lose the race between "is this email taken?"
  // and the INSERT, and only the database can arbitrate it. Mapping the
  // violation here rather than in each route means the paths with no catch of
  // their own — the operator branch of /api/auth/register was one — answer 409
  // with the right field named instead of a 500.
  const duplicate = duplicateMessage(err);
  if (duplicate && req.originalUrl.startsWith('/api')) {
    return res.status(409).json({ success: false, error: duplicate });
  }

  if (req.originalUrl.startsWith('/api')) {
    const status = err.statusCode || err.status || 500;
    const body = {
      success: false,
      error: status === 500 ? 'Internal server error' : err.message || 'Request error',
    };
    // SEC-10 — opt in, never opt out. This tested `NODE_ENV !== 'production'`,
    // so an unset NODE_ENV — the normal state on a server nobody configured —
    // shipped full stack traces, file paths and query fragments to callers.
    // Only an explicit 'development' reveals them; the trace is always logged
    // above regardless, so nothing is lost in diagnosis.
    if (process.env.NODE_ENV === 'development' && err.stack) {
      body.stack = err.stack;
    }
    return res.status(status).json(body);
  }

  return res.status(500).render('pages/error', {
    title: 'Server Error',
    code: 500,
    message: 'Something went wrong on our end. Please try again later.',
  });
}

module.exports = { notFoundApi, errorHandler, duplicateMessage };
