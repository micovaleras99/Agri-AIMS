/**
 * Runs a .sql migration file using the mysql2 driver that is already a project
 * dependency, so no `mysql` command-line client is needed.
 *
 *   npm run migrate:sql -- database/migrations/003_location_hierarchy.sql
 *   node scripts/run-migration.js database/migrations/004_admin_farmer_registration.sql
 *
 * Statements run one at a time. "Already exists" style errors are reported and
 * skipped, so re-running a migration is safe; anything else stops the run.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

/** Errors that mean "this part of the migration was already applied". */
const ALREADY_APPLIED = new Set([
  'ER_DUP_FIELDNAME',   // duplicate column name
  'ER_TABLE_EXISTS_ERROR',
  'ER_DUP_KEYNAME',     // duplicate index/key name
  'ER_FK_DUP_NAME',     // duplicate foreign key constraint name
]);

/**
 * Splits a migration into statements. Line comments are removed first so a
 * semicolon inside a comment cannot split a statement in the wrong place.
 * @param {string} sql
 * @returns {string[]}
 */
function splitStatements(sql) {
  const withoutComments = sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');
  return withoutComments
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** First few words of a statement, for readable progress output. */
function describe(statement) {
  const flat = statement.replace(/\s+/g, ' ').trim();
  return flat.length > 72 ? `${flat.slice(0, 72)}…` : flat;
}

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('Usage: node scripts/run-migration.js <path-to-.sql>');
    process.exit(1);
  }

  const full = path.resolve(process.cwd(), file);
  if (!fs.existsSync(full)) {
    console.error(`Migration not found: ${full}`);
    process.exit(1);
  }

  const statements = splitStatements(fs.readFileSync(full, 'utf8'));
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'agri_aims',
    multipleStatements: false,
  });

  console.log(`Running ${path.basename(full)} against ${process.env.DB_NAME || 'agri_aims'} (${statements.length} statements)\n`);

  let applied = 0;
  let skipped = 0;
  try {
    for (const statement of statements) {
      try {
        await conn.query(statement);
        applied += 1;
        console.log(`  ok      ${describe(statement)}`);
      } catch (err) {
        if (ALREADY_APPLIED.has(err.code)) {
          skipped += 1;
          console.log(`  skip    ${describe(statement)}`);
          console.log(`          (${err.code}: already applied)`);
          continue;
        }
        console.error(`\n  FAILED  ${describe(statement)}`);
        console.error(`          ${err.code || ''} ${err.message}`);
        throw err;
      }
    }
    console.log(`\nDone. ${applied} statement(s) applied, ${skipped} already in place.`);
  } finally {
    await conn.end();
  }
}

main().catch(() => process.exit(1));
