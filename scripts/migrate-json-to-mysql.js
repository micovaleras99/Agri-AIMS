/**
 * One-time migration: imports JSON files from /data into MySQL.
 * Run after schema.sql:  node scripts/migrate-json-to-mysql.js
 *
 * Requires: npm install, .env with DB_*, existing empty tables (or truncates first).
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');
const mysql = require('mysql2/promise');

const DATA_DIR = path.join(__dirname, '..', 'data');

/** JSON exports mix camelCase (e.g. applicationId) with snake_case step fields — read both. */
function pick(obj, ...keys) {
  for (const k of keys) {
    if (obj[k] !== undefined) return obj[k];
  }
  return null;
}

/**
 * This script TRUNCATES applicants, farms, documents, reports and users before importing.
 * It must never run by accident against a database that holds real applications.
 */
function assertSafeToRun() {
  if (process.env.NODE_ENV === 'production') {
    console.error('Refusing to run: NODE_ENV=production. This script deletes all rows in five tables.');
    process.exit(1);
  }
  const confirmed = process.argv.includes('--force') || process.env.MIGRATE_CONFIRM === 'yes';
  if (!confirmed) {
    console.error('');
    console.error('  This will DELETE every row in: documents, reports, users, farms, applicants');
    console.error(`  Target database: ${process.env.DB_NAME || 'agri_aims'} on ${process.env.DB_HOST || '127.0.0.1'}`);
    console.error('');
    console.error('  Re-run with --force if that is what you want:');
    console.error('      npm run migrate -- --force');
    console.error('');
    process.exit(1);
  }
}

async function main() {
  assertSafeToRun();
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'agri_aims',
    multipleStatements: true,
  });

  console.log('Truncating tables (order respects FKs)...');
  await conn.query('SET FOREIGN_KEY_CHECKS = 0');
  await conn.query('TRUNCATE TABLE documents');
  await conn.query('TRUNCATE TABLE reports');
  await conn.query('TRUNCATE TABLE users');
  await conn.query('TRUNCATE TABLE farms');
  await conn.query('TRUNCATE TABLE applicants');
  await conn.query('SET FOREIGN_KEY_CHECKS = 1');

  const applicants = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'applicants.json'), 'utf8'));
  const farms = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'farms.json'), 'utf8'));
  const documents = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'documents.json'), 'utf8'));
  const reports = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'reports.json'), 'utf8'));
  const users = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'users.json'), 'utf8'));

  console.log(`Inserting ${applicants.length} applicants...`);
  for (const a of applicants) {
    const placeholders = Array(57).fill('?').join(',');
    await conn.execute(
      `INSERT INTO applicants (
        id, application_id, first_name, last_name, email, phone, farm_name, farm_area, farm_address,
        region, province, municipality, lsa_type, category, classification, status, progress, submission_date,
        accreditation_step, documents, total_docs, latitude, longitude, geo_tagged_by, geo_tagged_date, geo_tag_status,
        step1_briefer_signed, step1_briefer_date, step1_acknowledged_by,
        step2_self_assessment_score, step2_qualified, step2_completed_date, step2_remarks,
        step3_submitted_date, step3_docs_submitted, step3_docs_required, step3_received_by,
        step4_eval_date, step4_eval_result, step4_eval_remarks, step4_eval_by,
        step5_validation_date, step5_validation_type, step5_validation_result, step5_checked_items, step5_twg_remarks, step5_inspected_by,
        step6_endorsed_date, step6_endorsed_by, step6_endorsement_no, step6_endorse_remarks,
        step7_certificate_no, step7_issue_date, step7_valid_until, step7_moa_date, step7_issued_by, step7_moa_remarks
      ) VALUES (${placeholders})`,
      [
        a.id,
        pick(a, 'applicationId'),
        pick(a, 'firstName'),
        pick(a, 'lastName'),
        pick(a, 'email'),
        pick(a, 'phone'),
        pick(a, 'farmName'),
        pick(a, 'farmArea'),
        pick(a, 'farmAddress'),
        pick(a, 'region'),
        pick(a, 'province'),
        pick(a, 'municipality'),
        pick(a, 'lsaType'),
        pick(a, 'category'),
        pick(a, 'classification'),
        pick(a, 'status'),
        pick(a, 'progress'),
        pick(a, 'submissionDate'),
        pick(a, 'accreditationStep'),
        pick(a, 'documents'),
        pick(a, 'totalDocs'),
        pick(a, 'latitude'),
        pick(a, 'longitude'),
        pick(a, 'geoTaggedBy'),
        pick(a, 'geoTaggedDate'),
        pick(a, 'geoTagStatus'),
        pick(a, 'step1_brieferSigned', 'step1BrieferSigned') ? 1 : 0,
        pick(a, 'step1_brieferDate', 'step1BrieferDate'),
        pick(a, 'step1_acknowledgedBy', 'step1AcknowledgedBy'),
        pick(a, 'step2_selfAssessmentScore', 'step2SelfAssessmentScore'),
        pick(a, 'step2_qualified', 'step2Qualified') == null ? null : pick(a, 'step2_qualified', 'step2Qualified') ? 1 : 0,
        pick(a, 'step2_completedDate', 'step2CompletedDate'),
        pick(a, 'step2_remarks', 'step2Remarks'),
        pick(a, 'step3_submittedDate', 'step3SubmittedDate'),
        pick(a, 'step3_docsSubmitted', 'step3DocsSubmitted'),
        pick(a, 'step3_docsRequired', 'step3DocsRequired'),
        pick(a, 'step3_receivedBy', 'step3ReceivedBy'),
        pick(a, 'step4_evalDate', 'step4EvalDate'),
        pick(a, 'step4_evalResult', 'step4EvalResult'),
        pick(a, 'step4_evalRemarks', 'step4EvalRemarks'),
        pick(a, 'step4_evalBy', 'step4EvalBy'),
        pick(a, 'step5_validationDate', 'step5ValidationDate'),
        pick(a, 'step5_validationType', 'step5ValidationType'),
        pick(a, 'step5_validationResult', 'step5ValidationResult'),
        pick(a, 'step5_checkedItems', 'step5CheckedItems'),
        pick(a, 'step5_twgRemarks', 'step5TwgRemarks'),
        pick(a, 'step5_inspectedBy', 'step5InspectedBy'),
        pick(a, 'step6_endorsedDate', 'step6EndorsedDate'),
        pick(a, 'step6_endorsedBy', 'step6EndorsedBy'),
        pick(a, 'step6_endorsementNo', 'step6EndorsementNo'),
        pick(a, 'step6_endorseRemarks', 'step6EndorseRemarks'),
        pick(a, 'step7_certificateNo', 'step7CertificateNo'),
        pick(a, 'step7_issueDate', 'step7IssueDate'),
        pick(a, 'step7_validUntil', 'step7ValidUntil'),
        pick(a, 'step7_moaDate', 'step7MoaDate'),
        pick(a, 'step7_issuedBy', 'step7IssuedBy'),
        pick(a, 'step7_moaRemarks', 'step7MoaRemarks'),
      ]
    );
  }

  console.log(`Inserting ${farms.length} farms...`);
  for (const f of farms) {
    await conn.execute(
      `INSERT INTO farms (
        id, applicant_id, name, operator, region, province, municipality, address, classification, lsa_type,
        accreditation_level, accredited_since, expiry_date, farm_area, compliance_score, visitors_this_year,
        training_sessions, main_crops, latitude, longitude, status
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        f.id,
        pick(f, 'applicantId'),
        pick(f, 'name'),
        pick(f, 'operator'),
        pick(f, 'region'),
        pick(f, 'province'),
        pick(f, 'municipality'),
        pick(f, 'address'),
        pick(f, 'classification'),
        pick(f, 'lsaType'),
        pick(f, 'accreditationLevel'),
        pick(f, 'accreditedSince'),
        pick(f, 'expiryDate'),
        pick(f, 'farmArea'),
        pick(f, 'complianceScore'),
        pick(f, 'visitorsThisYear'),
        pick(f, 'trainingSessions'),
        pick(f, 'mainCrops'),
        pick(f, 'latitude'),
        pick(f, 'longitude'),
        pick(f, 'status'),
      ]
    );
  }

  console.log(`Inserting ${documents.length} documents...`);
  for (const d of documents) {
    await conn.execute(
      `INSERT INTO documents (
        id, applicant_id, application_id, applicant_name, name, type, filename, size, upload_date, status, remarks
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [
        d.id,
        pick(d, 'applicantId'),
        pick(d, 'applicationId'),
        pick(d, 'applicantName'),
        pick(d, 'name'),
        pick(d, 'type'),
        pick(d, 'filename'),
        pick(d, 'size'),
        pick(d, 'uploadDate'),
        pick(d, 'status'),
        pick(d, 'remarks') || '',
      ]
    );
  }

  console.log(`Inserting ${reports.length} reports...`);
  for (const r of reports) {
    await conn.execute(
      `INSERT INTO reports (
        id, farm_id, farm_name, operator, period, submission_date, visitors, training_sessions, tech_demos, status, reviewed_by
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [
        r.id,
        pick(r, 'farmId'),
        pick(r, 'farmName'),
        pick(r, 'operator'),
        pick(r, 'period'),
        pick(r, 'submissionDate'),
        pick(r, 'visitors'),
        pick(r, 'trainingSessions'),
        pick(r, 'techDemos'),
        pick(r, 'status'),
        pick(r, 'reviewedBy'),
      ]
    );
  }

  console.log(`Inserting ${users.length} users (bcrypt hashing)...`);
  for (const u of users) {
    const hash = await bcrypt.hash(u.password, 12);
    await conn.execute(
      `INSERT INTO users (
        id, first_name, last_name, email, password_hash, role, position, office, region, avatar, phone, farm_id, application_id
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        u.id,
        pick(u, 'firstName'),
        pick(u, 'lastName'),
        pick(u, 'email'),
        hash,
        pick(u, 'role'),
        pick(u, 'position'),
        pick(u, 'office'),
        pick(u, 'region'),
        pick(u, 'avatar'),
        pick(u, 'phone'),
        pick(u, 'farmId'),
        pick(u, 'applicationId'),
      ]
    );
  }

  const [[aMax]] = await conn.query('SELECT MAX(id) AS m FROM applicants');
  const [[fMax]] = await conn.query('SELECT MAX(id) AS m FROM farms');
  const [[dMax]] = await conn.query('SELECT MAX(id) AS m FROM documents');
  const [[rMax]] = await conn.query('SELECT MAX(id) AS m FROM reports');
  const [[uMax]] = await conn.query('SELECT MAX(id) AS m FROM users');
  await conn.query(`ALTER TABLE applicants AUTO_INCREMENT = ${(aMax.m || 0) + 1}`);
  await conn.query(`ALTER TABLE farms AUTO_INCREMENT = ${(fMax.m || 0) + 1}`);
  await conn.query(`ALTER TABLE documents AUTO_INCREMENT = ${(dMax.m || 0) + 1}`);
  await conn.query(`ALTER TABLE reports AUTO_INCREMENT = ${(rMax.m || 0) + 1}`);
  await conn.query(`ALTER TABLE users AUTO_INCREMENT = ${(uMax.m || 0) + 1}`);

  await conn.end();
  console.log('Migration finished successfully.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
