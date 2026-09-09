/**
 * MySQL connection pool (mysql2/promise).
 * Credentials come from environment variables — never hard-code secrets.
 */

require('dotenv').config();
const mysql = require('mysql2/promise');
const logger = require('../utils/logger');

const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'agri_aims',
  waitForConnections: true,
  connectionLimit: Number(process.env.DB_POOL_LIMIT) || 10,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
  namedPlaceholders: true,
  // Return DATE columns as 'YYYY-MM-DD' strings rather than Date objects.
  //
  // A DATE has no time and no timezone, but the driver turns it into a Date at
  // local midnight; calling .toISOString() on that in UTC+8 yields the previous
  // day, so every date the app displayed was one day early. Keeping DATE as a
  // string removes the conversion entirely. DATETIME and TIMESTAMP columns,
  // which do represent an instant, are left as Date objects.
  dateStrings: ['DATE'],
});

/**
 * Run a prepared statement. Logs SQL (without secrets) when DB_LOG_QUERIES=true.
 * @param {string} sql
 * @param {import('mysql2').RowDataPacket[] | Record<string, unknown>[]} [params]
 */
async function query(sql, params = []) {
  const logQueries = process.env.DB_LOG_QUERIES === 'true';
  const start = Date.now();
  try {
    const [rows] = await pool.execute(sql, params);
    if (logQueries) {
      logger.dbQuery(sql, params, Date.now() - start);
    }
    return rows;
  } catch (err) {
    logger.dbError(sql, err);
    throw err;
  }
}

/** @returns {import('mysql2/promise').Pool} */
function getPool() {
  return pool;
}

async function ping() {
  const conn = await pool.getConnection();
  try {
    await conn.ping();
  } finally {
    conn.release();
  }
}

module.exports = { pool, getPool, query, ping };
