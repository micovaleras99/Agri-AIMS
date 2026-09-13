// ============================================================
// Agri-AIMS — Main Server (Express + EJS + MySQL)
// ============================================================

require('dotenv').config();
require('express-async-errors');

const express = require('express');
const morgan = require('morgan');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const crypto = require('crypto');

const { ping } = require('./config/database');
const { roleContext } = require('./middleware/roleContext');
const { requireAuthPage } = require('./middleware/requireAuthPage');
const { csrfProtection } = require('./middleware/csrf');
const { loginLimiter, registerLimiter, apiLimiter, chatbotLimiter } = require('./middleware/rateLimit');
const { requestLogger } = require('./middleware/requestLogger');
const { errorHandler, notFoundApi } = require('./middleware/errorHandler');

const app = express();
const PORT = process.env.PORT || 3000;

// Behind a reverse proxy (nginx, a PaaS router), set TRUST_PROXY so the client
// IP comes from X-Forwarded-For — the rate limiters key on it. Leave it unset
// when the app faces users directly, or every request looks like the proxy.
if (process.env.TRUST_PROXY) {
  app.set('trust proxy', Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY);
}

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Security headers. The Content-Security-Policy lists exactly what the pages
// load: Bootstrap and Chart.js from jsDelivr, Leaflet from unpkg, OpenStreetMap
// tiles, and Google Fonts.
//
// The inline <script> blocks carry a per-request nonce instead of being
// waved through by 'unsafe-inline', so an injected <script> is now refused.
// Inline handler ATTRIBUTES (onclick=, oninput=) have all been rewritten as
// declarative data-call / data-confirm attributes dispatched by
// public/js/actions.js, so script-src-attr is now 'none' — an injected
// onerror=/onclick= no longer executes.
app.use((req, res, next) => {
  res.locals.cspNonce = crypto.randomBytes(16).toString('base64');
  next();
});

// `ic('clipboard-check')` -> Phosphor classes, for icons chosen from data at
// render time (config/route `icon:` fields keep their Bootstrap names).
const { ic } = require('./config/icons');
app.use((req, res, next) => { res.locals.ic = ic; next(); });

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          (req, res) => `'nonce-${res.locals.cspNonce}'`,
          'https://cdn.jsdelivr.net',
          'https://unpkg.com',
        ],
        // No inline handler attributes remain — behaviour is wired through
        // data-call / data-confirm and public/js/actions.js — so this stays at
        // helmet's default 'none': an injected onerror=/onclick= cannot run.
        scriptSrcAttr: ["'none'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net', 'https://unpkg.com', 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'data:', 'https://cdn.jsdelivr.net', 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:', 'blob:', 'https://*.tile.openstreetmap.org', 'https://unpkg.com', 'https://cdn.jsdelivr.net'],
        connectSrc: ["'self'"],
        mediaSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? [] : null,
      },
    },
    // Map tiles and CDN assets are cross-origin; COEP would block them.
    crossOriginEmbedderPolicy: false,
    // helmet defaults this to 'no-referrer'. OpenStreetMap's tile usage policy
    // REQUIRES a Referer and answers a stripped one with a 403 "Access blocked"
    // tile, so no-referrer breaks every map in the app. 'strict-origin-when-cross-origin'
    // is the modern browser default: it sends only the origin to other sites
    // (never the path or query, so applicant and farm ids are not leaked) and
    // sends nothing at all when an HTTPS page links out to HTTP.
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    // HSTS only means something over HTTPS, and would be wrong to send in dev.
    // Explicit in production: one year, subdomains, and preload-eligible.
    hsts: process.env.NODE_ENV === 'production'
      ? { maxAge: 31536000, includeSubDomains: true, preload: true }
      : false,
  })
);

// Permissions-Policy: switch off powerful browser features the app never uses,
// so an injected script (or an embedded resource) cannot ask for them. The
// geo-tag map is server-driven (coordinates are typed/clicked, not read from the
// device), so browser geolocation is left to same-origin only rather than opened.
app.use((req, res, next) => {
  res.setHeader(
    'Permissions-Policy',
    'camera=(), microphone=(), payment=(), usb=(), geolocation=(self), interest-cohort=()'
  );
  next();
});

// SEC-09 — cross-origin access is off unless an allowlist is configured.
// This was `origin: process.env.CORS_ORIGIN || true`, and `true` reflects
// whatever Origin the caller sends. Combined with credentials: true that let
// any website on the internet make authenticated requests carrying a visitor's
// session cookie. The app's own pages are same-origin and need no CORS headers,
// and non-browser API clients (Postman, a future mobile app) authenticate with
// a Bearer token, which CORS does not govern. Set CORS_ORIGIN to a comma-
// separated list of origins only when a browser on another origin must call
// this API.
const corsAllowlist = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: corsAllowlist.length > 0 ? corsAllowlist : false,
    credentials: true,
  })
);
app.use(requestLogger);
app.use(morgan('dev'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

function requireRole(allowed) {
  return (req, res, next) => {
    if (allowed.includes(res.locals.role)) return next();
    return res.status(403).render('pages/error', {
      title: 'Access Denied',
      code: 403,
      message: `Your role (${res.locals.role}) does not have permission to view this page.`,
    });
  };
}

app.locals.requireRole = requireRole;

// Issues the CSRF cookie, exposes res.locals.csrfToken to the views, and
// rejects cookie-authenticated writes that do not echo it back.
app.use(csrfProtection);

app.use(roleContext);

// Public: landing/login page and the LSA directory (a public service under the guidelines).
app.use('/', require('./routes/index'));
app.use('/directory', require('./routes/directory'));

// Everything below requires a signed-in user before any role check runs.
app.use('/dashboard', requireAuthPage, require('./routes/dashboard'));
app.use('/applicants', requireAuthPage, require('./routes/applicants'));
app.use('/accreditation', requireAuthPage, require('./routes/accreditation'));
app.use('/documents', requireAuthPage, require('./routes/documents'));
app.use('/forms', requireAuthPage, require('./routes/forms'));
app.use('/farms', requireAuthPage, require('./routes/farms'));
app.use('/reports', requireAuthPage, require('./routes/reports'));
app.use('/community', requireAuthPage, require('./routes/community'));
app.use('/services', requireAuthPage, require('./routes/services'));
app.use('/compliance', requireAuthPage, require('./routes/compliance'));
app.use('/lsa2', requireAuthPage, require('./routes/lsa2'));
app.use('/renewal', requireAuthPage, require('./routes/renewal'));
app.use('/registry', requireAuthPage, require('./routes/registry'));
app.use('/messages', requireAuthPage, require('./routes/messages'));
app.use('/admin', requireAuthPage, require('./routes/admin'));
app.use('/profile', requireAuthPage, require('./routes/profile'));
app.use('/development-plan', requireAuthPage, require('./routes/developmentPlan'));
app.use('/farm-profile', requireAuthPage, require('./routes/farmProfile'));

app.use('/api/auth/login', loginLimiter);
app.use('/api/auth/register', registerLimiter);
app.use('/api/chatbot', chatbotLimiter);
app.use('/api', apiLimiter);
app.use('/api', require('./routes/api'));

app.use((req, res) => {
  if (req.originalUrl.startsWith('/api')) {
    return notFoundApi(req, res);
  }
  return res.status(404).render('pages/error', {
    title: 'Page Not Found',
    code: 404,
    message: `The page "${req.originalUrl}" does not exist.`,
  });
});

app.use(errorHandler);

/**
 * Turns a listen failure into an explanation.
 *
 * An occupied port arrives as an unhandled 'error' event on the server, which
 * Node reports by throwing: nine lines of stack with EADDRINUSE buried in the
 * middle. The commonest cause by far is the server already running in another
 * terminal, and that is worth saying in one line — the same courtesy the MySQL
 * check below already gets.
 */
function explainListenError(err) {
  if (err.code === 'EADDRINUSE') {
    console.error(`\nPort ${PORT} is already in use — Agri-AIMS is probably running already.\n`);
    console.error('  - Find another terminal running "node app.js" and stop it with Ctrl+C, or');
    console.error(`  - find it:  netstat -ano | findstr :${PORT}`);
    console.error('    stop it:  taskkill /PID <the last number on that line> /F');
    console.error(`  - or use another port:  set PORT=3001 && node app.js\n`);
  } else if (err.code === 'EACCES') {
    console.error(`\nNot allowed to listen on port ${PORT}. Ports below 1024 need administrator rights.\n`);
  } else {
    console.error('\nCould not start the server:', err.message, '\n');
  }
  process.exit(1);
}

async function start() {
  try {
    await ping();
    console.log('MySQL: connection pool ready.');
  } catch (err) {
    console.error('MySQL: unable to connect. Check .env and that the server is running.\n', err.message);
    process.exit(1);
  }

  const server = app.listen(PORT, () => {
    console.log(`\nAgri-AIMS → http://localhost:${PORT}`);
    console.log(`API base → http://localhost:${PORT}/api`);
    if (process.env.NODE_ENV !== 'production' && process.env.ALLOW_ROLE_SWITCH === 'true') {
      console.log('Role switcher: ENABLED (development only) - ?role=admin|operator|applicant');
    } else {
      console.log('Role switcher: disabled. Sign in at / to use the app.');
    }

    // Posts new ATI / e-learning articles to community chat on a timer.
    // Silent unless SYNC_INTERVAL_MINUTES is set.
    const scheduler = require('./services/syncScheduler');
    const sched = scheduler.start();
    if (sched.started) {
      console.log(`Article sync: every ${sched.minutes} min, first run in ${sched.firstRunInSeconds}s`
        + `${sched.reason ? ' (' + sched.reason + ')' : ''}`);
    }

    // Internal and costs nothing, so unlike the article sync this is on by
    // default: an accreditation must not lapse because a demo setting was
    // left unset. RENEWAL_REMINDER_HOURS=0 turns it off.
    const rem = scheduler.startReminders();
    console.log(rem.started
      ? `Renewal reminders: every ${rem.hours}h, first run in ${rem.firstRunInSeconds}s`
      : `Renewal reminders: disabled (${rem.reason})`);
  });

  server.on('error', explainListenError);
}

// Listening is what `node app.js` does; requiring this file should only build
// the app, so a test can mount it on an ephemeral port without racing the
// development server for :3000.
if (require.main === module) start();

module.exports = app;
