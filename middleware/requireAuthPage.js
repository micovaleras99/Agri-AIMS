/**
 * Page-level authentication for the EJS routes.
 *
 * API routes use authenticateJWT (which answers 401 in JSON); this one redirects
 * a human back to the login page and remembers where they were headed.
 */

function requireAuthPage(req, res, next) {
  if (res.locals.currentUser) return next();
  const next_ = encodeURIComponent(req.originalUrl);
  return res.redirect(`/?auth=required&next=${next_}`);
}

module.exports = { requireAuthPage };
