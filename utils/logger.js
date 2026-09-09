/**
 * Lightweight logger: console + optional append to logs/*.log
 * Set LOG_TO_FILE=true to write request.log and error.log under ./logs
 */

const fs = require('fs');
const path = require('path');

const logsDir = path.join(__dirname, '..', 'logs');
const logToFile = process.env.LOG_TO_FILE === 'true';

function ensureLogsDir() {
  if (logToFile && !fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }
}

function stamp() {
  return new Date().toISOString();
}

function appendFile(name, line) {
  if (!logToFile) return;
  ensureLogsDir();
  fs.appendFileSync(path.join(logsDir, name), line + '\n');
}

function request(method, url, status, ms) {
  const line = `[${stamp()}] ${method} ${url} ${status} ${ms}ms`;
  console.log(line);
  appendFile('request.log', line);
}

function error(message, err) {
  const stack = err && err.stack ? err.stack : String(err);
  const line = `[${stamp()}] ERROR: ${message}\n${stack}`;
  console.error(line);
  appendFile('error.log', line);
}

function dbQuery(sql, params, durationMs) {
  const shortSql = sql.replace(/\s+/g, ' ').trim().slice(0, 500);
  const line = `[${stamp()}] DB ${durationMs}ms | ${shortSql} | params: ${JSON.stringify(params)}`;
  console.debug(line);
  appendFile('query.log', line);
}

function dbError(sql, err) {
  const line = `[${stamp()}] DB ERROR | ${sql.slice(0, 300)} | ${err.message}`;
  console.error(line);
  appendFile('error.log', line);
}

module.exports = { request, error, dbQuery, dbError };
