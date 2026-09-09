-- Optional minimal seed (after schema). Prefer scripts/migrate-json-to-mysql.js for demo data.
-- INSERT INTO users (...) requires bcrypt hashes — use the migration script instead.

SELECT 'Schema ready. Run: node scripts/migrate-json-to-mysql.js' AS message;
