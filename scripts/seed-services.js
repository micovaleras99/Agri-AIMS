/**
 * Seeds the LSA service catalogue (RSC-04).
 *
 *   npm run seed:services
 *
 * The five service types are the LSA II components named in the Guidelines
 * (p.8): Training, Demonstration Services, Information Support, Technical
 * Assistance, Complementary Projects.
 *
 * The training courses are the ones the Guidelines list by name under Technical
 * Assistance (p.30), and the three complementary projects are the items it says
 * are given priority to LSA II (p.31). Nothing here is invented — if a course is
 * not named in the document, it is not in this list.
 *
 * Dates are left open. A catalogue entry describes what ATI offers; the
 * scheduling of a particular run is data staff enter, not something a seed
 * should pretend to know.
 *
 * Safe to re-run — rows are matched on `name`, so re-running updates rather
 * than duplicates, and any participants already recorded are untouched.
 */

require('dotenv').config();
const mysql = require('mysql2/promise');

const PROVIDER = 'ATI-RTC V (Bicol)';

const SERVICES = [
  // ── Training: the courses named in the Guidelines, p.30 ──────────
  {
    service_type: 'training',
    name: 'Training of Trainers',
    description:
      'Prepares LSA cooperators to deliver farmer-level training on behalf of the Institute.',
    target_beneficiaries: 'LSA cooperators and farmer-leaders',
    eligibility: 'Accredited LSA I and LSA II operators',
  },
  {
    service_type: 'training',
    name: 'Farm Entrepreneurship and Farm Business Planning',
    description: 'Running the farm as a business: costing, markets and a written business plan.',
    target_beneficiaries: 'LSA operators and farm families',
    eligibility: 'Accredited LSA operators',
  },
  {
    service_type: 'training',
    name: 'Farm Planning and Development',
    description: 'Laying out and developing the farm, including the technology demonstration area.',
    target_beneficiaries: 'LSA operators',
    eligibility: 'Accredited LSA operators',
  },
  {
    service_type: 'training',
    name: 'Financial Literacy including Farm Record Keeping',
    description:
      'Managing farm finances and keeping the production and sales records an LSA is required to maintain.',
    target_beneficiaries: 'LSA operators and farm families',
    eligibility: 'Accredited LSA operators',
  },
  {
    service_type: 'training',
    name: 'Good Agriculture Practices, HALAL and Food Safety',
    description: 'GAP, HALAL and food safety standards for farm and agri-processing operations.',
    target_beneficiaries: 'LSA operators, agri-processing enterprises',
    eligibility: 'Accredited LSA operators',
  },
  {
    service_type: 'training',
    name: 'Climate Resilient Agriculture',
    description: 'Practices that keep the farm productive through drought, flooding and typhoons.',
    target_beneficiaries: 'LSA operators and Agricultural Extension Workers',
    eligibility: 'Accredited LSA operators',
  },
  {
    service_type: 'training',
    name: 'New and Emerging Technologies in Agriculture and Fishery',
    description: 'Technologies newly released for extension in agriculture and fishery.',
    target_beneficiaries: 'LSA operators, AEWs',
    eligibility: 'Accredited LSA operators',
  },
  {
    service_type: 'training',
    name: 'Values Formation',
    description: 'Values formation for farmer-leaders and cooperators.',
    target_beneficiaries: 'LSA operators and farmer-leaders',
    eligibility: 'Accredited LSA operators',
  },
  {
    service_type: 'training',
    name: 'Digital Agriculture',
    description: 'Digital tools and internet-based information resources for farm operations.',
    target_beneficiaries: 'LSA operators, AEWs, 4-H youth',
    eligibility: 'Accredited LSA operators',
  },

  // ── The other four components (p.8) ──────────────────────────────
  {
    service_type: 'demonstration',
    name: 'Technology Demonstration Hosting',
    description:
      'The farm serves as a demonstration area for hands-on learning by training participants, '
      + 'visiting groups, ATI scholarship grantees and 4-H youth trainees.',
    target_beneficiaries: 'Training participants, visiting groups, students',
    eligibility: 'Accredited LSA with a technology demonstration area',
  },
  {
    service_type: 'information_support',
    name: 'IEC Materials and Information Support',
    description:
      'Information, education and communication materials and internet-based information '
      + 'resources provided to the farm’s clientele.',
    target_beneficiaries: 'Farmers and fisherfolk in the service area',
    eligibility: 'Open to all LSA clientele',
  },
  {
    service_type: 'technical_assistance',
    name: 'On-site Technical Assistance and Farm Advisory',
    description:
      'Farm business advisory and technical guidance provided to cooperators, including '
      + 'monitoring visits by ATI personnel.',
    target_beneficiaries: 'LSA operators',
    eligibility: 'Accredited LSA operators',
  },

  // ── Given priority to LSA II (p.31) ──────────────────────────────
  {
    service_type: 'complementary_project',
    name: 'PAF-ESP Accreditation Support',
    description:
      'Support for certified LSAs organising into associations or networks and applying for '
      + 'accreditation as Private Agriculture and Fisheries – Extension Service Providers. '
      + 'Promising proposals may receive financial grants, subject to available ATI funding.',
    target_beneficiaries: 'LSA II operators, LSA networks and associations',
    eligibility: 'Priority to LSA II',
  },
  {
    service_type: 'complementary_project',
    name: 'FITS Kiosk (Satellite FITS Center)',
    description:
      'The farm becomes a Farmers’ Information and Technology Services kiosk, serving as a '
      + 'satellite FITS Center providing IEC materials and internet-based information resources.',
    target_beneficiaries: 'LSA II operators and their clientele',
    eligibility: 'Priority to LSA II',
  },
  {
    service_type: 'complementary_project',
    name: 'Artificial Insemination (AI) sa Barangay',
    description:
      'Recipient of the AI sa Barangay Project under the National Livestock Program.',
    target_beneficiaries: 'LSA II operators engaged in livestock',
    eligibility: 'Priority to LSA II, livestock operations',
  },
];

async function main() {
  const db = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'agri_aims',
    multipleStatements: false,
  });

  let added = 0;
  let updated = 0;

  for (const s of SERVICES) {
    const [rows] = await db.execute('SELECT id FROM services WHERE name = ? LIMIT 1', [s.name]);
    if (rows.length) {
      await db.execute(
        `UPDATE services
            SET service_type = ?, description = ?, provider = ?,
                target_beneficiaries = ?, eligibility = ?
          WHERE id = ?`,
        [s.service_type, s.description, PROVIDER, s.target_beneficiaries, s.eligibility, rows[0].id]
      );
      updated += 1;
    } else {
      await db.execute(
        `INSERT INTO services
           (service_type, name, description, provider, target_beneficiaries, eligibility, status)
         VALUES (?,?,?,?,?,?, 'open')`,
        [s.service_type, s.name, s.description, PROVIDER, s.target_beneficiaries, s.eligibility]
      );
      added += 1;
    }
  }

  const [[{ n }]] = await db.query('SELECT COUNT(*) AS n FROM services');
  const [byType] = await db.query(
    'SELECT service_type, COUNT(*) AS n FROM services GROUP BY service_type ORDER BY service_type'
  );

  console.log(`Services seeded: ${added} added, ${updated} updated, ${n} total`);
  for (const t of byType) console.log(`  ${String(t.service_type).padEnd(24)}${t.n}`);

  await db.end();
}

main().catch((err) => {
  console.error('Seeding services failed:', err.message);
  process.exit(1);
});
