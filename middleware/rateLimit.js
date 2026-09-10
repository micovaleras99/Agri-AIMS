/**
 * Rate limits for the endpoints worth brute-forcing.
 *
 * Counters are per-process and in memory, which suits a single-instance
 * deployment. Behind more than one instance, move the store to Redis or
 * MySQL — otherwise each process counts separately and the real limit is
 * the configured one multiplied by the number of processes.
 */

const rateLimit = require('express-rate-limit');

const FIFTEEN_MINUTES = 15 * 60 * 1000;

function jsonMessage(error) {
  return { success: false, error, code: 'RATE_LIMITED' };
}

/**
 * Sign-in attempts. Deliberately tight: an ATI account guarded by a password
 * like the seeded demo ones falls to an unthrottled script in seconds.
 */
const loginLimiter = rateLimit({
  windowMs: FIFTEEN_MINUTES,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skipSuccessfulRequests: true, // only failed attempts count toward the limit
  message: jsonMessage('Too many sign-in attempts. Please wait 15 minutes and try again.'),
});

/** Account creation, to stop a script filling the applicants table. */
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: jsonMessage('Too many accounts created from this address. Please try again later.'),
});

/** Everything else under /api — generous, just a backstop against runaway clients. */
const apiLimiter = rateLimit({
  windowMs: FIFTEEN_MINUTES,
  limit: 600,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: jsonMessage('Too many requests. Please slow down.'),
});

/**
 * Chatbot questions. Every one that reaches a configured model spends OpenRouter
 * credits, so this is tighter than the general /api backstop: enough for a real
 * person holding a conversation, not enough for a script to run up a bill. When
 * no model is configured the answers are free, but the limit stays on so the
 * retrieval work itself can't be hammered either.
 */
const chatbotLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 40,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: jsonMessage('Too many questions in a short time. Please wait a minute and ask again.'),
});

module.exports = { loginLimiter, registerLimiter, apiLimiter, chatbotLimiter };
