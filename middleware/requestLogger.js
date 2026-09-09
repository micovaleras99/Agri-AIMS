/**
 * Logs each HTTP request after the response is finished.
 */

const logger = require('../utils/logger');

function requestLogger(req, res, next) {
  const start = Date.now();
  res.on('finish', () => {
    logger.request(req.method, req.originalUrl, res.statusCode, Date.now() - start);
  });
  next();
}

module.exports = { requestLogger };
