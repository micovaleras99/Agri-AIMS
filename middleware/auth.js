/**
 * JWT authentication for REST API routes.
 */

const jwt = require('jsonwebtoken');
const userModel = require('../models/userModel');
const { asyncHandler } = require('../utils/asyncHandler');
const { getCookie } = require('../utils/cookies');

/**
 * JWT from `Authorization: Bearer` or `agri_token` cookie (for EJS + fetch with credentials).
 */
function getTokenFromRequest(req) {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) return auth.slice(7);
  return getCookie(req, 'agri_token');
}

function signToken(user) {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is not set in environment');
  return jwt.sign(
    { sub: user.id, role: user.role, email: user.email },
    secret,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
}

/** Express middleware — sets req.authUser if a valid JWT is present (Bearer or cookie). */
const authenticateJWT = asyncHandler(async (req, res, next) => {
  const token = getTokenFromRequest(req);
  if (!token) {
    return res.status(401).json({ success: false, error: 'Authentication required', code: 'NO_TOKEN' });
  }
  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return res.status(401).json({ success: false, error: 'Invalid or expired token', code: 'INVALID_TOKEN' });
  }
  const user = await userModel.findById(Number(payload.sub));
  if (!user) {
    return res.status(401).json({ success: false, error: 'User no longer exists', code: 'USER_GONE' });
  }
  // A deactivated or email-unverified account keeps its data but loses access,
  // even with a token that has not expired yet.
  if (user.isActive === false || (user.status && user.status !== 'active') || user.emailVerified === false) {
    return res.status(403).json({ success: false, error: 'Account is not active', code: 'ACCOUNT_INACTIVE' });
  }
  req.authUser = user;
  next();
});

/** Sets req.authUser when token is valid; continues without error if missing/invalid. */
const tryAuthenticate = asyncHandler(async (req, res, next) => {
  const token = getTokenFromRequest(req);
  if (token && process.env.JWT_SECRET) {
    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      const user = await userModel.findById(Number(payload.sub));
      if (user && user.isActive !== false && (!user.status || user.status === 'active') && user.emailVerified !== false) {
        req.authUser = user;
      }
    } catch {
      /* ignore */
    }
  }
  next();
});

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.authUser) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }
    if (!roles.includes(req.authUser.role)) {
      return res.status(403).json({ success: false, error: 'Insufficient permissions' });
    }
    next();
  };
}

module.exports = { signToken, authenticateJWT, tryAuthenticate, requireRole, getTokenFromRequest };
