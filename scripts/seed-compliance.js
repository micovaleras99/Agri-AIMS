/**
 * Seeds the compliance requirement catalogue (RSC-05).
 *
 *   npm run seed:compliance
 *
 * Every entry is taken from the LSA Guidelines and carries the part of the
 * document it comes from. Nothing here is invented: if a rule is not in the
 * guidelines, it does not belong in this list.
 *
 * Safe to re-run — rows are upserted on `code`.
 */

require('dotenv').config();
const mysql = require('mysql2/promise');

const REQUIREMENTS = [
  // ── Farm facilities (Qualification Requirements — The Farm) ──
  {
    code: 'FAC-TDA',
    title: 'Technology Demonstration Area in place',
    description:
      'A working demonstration area of at least 1,000 sq.m. — no minimum for urban and peri-urban gardens, 1 hectare for coconut-based farms under the CFIDP, 25 heads for livestock.',
    source_reference: 'Qualification Requirements — The Farm, item 3(a)',
    category: 'facilities', applies_to: 'farming', frequency: 'ongoing', sort_order: 10,
  },
  {
    code: 'FAC-HOLDING',
    title: 'Holding area available',
    description: 'A holding area able to take a visiting group for orientation and hands-on sessions.',
    source_reference: 'Qualification Requirements — The Farm, item 3(b)',
    category: 'facilities', applies_to: 'all', frequency: 'ongoing', sort_order: 20,
  },
  {
    code: 'FAC-WASH',
    title: 'Wash area available',
    description: 'A wash area for tools, equipment and produce.',
    source_reference: 'Qualification Requirements — The Farm, item 3(c)',
    category: 'facilities', applies_to: 'all', frequency: 'ongoing', sort_order: 30,
  },
  {
    code: 'FAC-TOILET',
    title: 'Toilet facilities available',
    description: 'Toilet facilities for visitors and training participants.',
    source_reference: 'Qualification Requirements — The Farm, item 3(d)',
    category: 'facilities', applies_to: 'all', frequency: 'ongoing', sort_order: 40,
  },
  {
    code: 'FAC-ACCESS',
    title: 'Accessible by land transport',
    description: 'The site is reachable by land and other transportation facilities.',
    source_reference: 'Qualification Requirements — The Farm, item 4',
    category: 'facilities', applies_to: 'all', frequency: 'ongoing', sort_order: 50,
  },

  // ── Operations (Responsibilities of the LSA Operator) ──
  {
    code: 'OPS-FARMING-SYSTEM',
    title: 'Diversified or specialised farming system implemented',
    description:
      'The farm runs a diversified and integrated farming system, a specialised system, or demonstrates agriculture and fisheries technologies.',
    source_reference: 'Responsibilities of LSA Operator — farming LSA',
    category: 'operations', applies_to: 'farming', frequency: 'ongoing', sort_order: 60,
  },
  {
    code: 'OPS-PROCESSING-VALUE-CHAIN',
    title: 'Agri-processing promoted through the value chain',
    description: 'The enterprise implements and promotes agri-processing activities across the value chain.',
    source_reference: 'Responsibilities of LSA Operator — agri-processing enterprise',
    category: 'operations', applies_to: 'agri_processing', frequency: 'ongoing', sort_order: 70,
  },
  {
    code: 'OPS-DEMO-AREA',
    title: 'Site made available as a demonstration area',
    description: 'The farm or enterprise is open as a demonstration area for hands-on learning.',
    source_reference: 'Responsibilities of LSA Operator',
    category: 'operations', applies_to: 'all', frequency: 'ongoing', sort_order: 80,
  },
  {
    code: 'OPS-LECTURES',
    title: 'Lectures and orientations provided',
    description:
      'Lectures and orientations are given to on-site training participants, visiting groups, ATI scholarship grantees, 4-H youth trainees and other groups arranged by the ATI.',
    source_reference: 'Responsibilities of LSA Operator',
    category: 'operations', applies_to: 'all', frequency: 'ongoing', sort_order: 90,
  },
  {
    code: 'OPS-SHARE-TECH',
    title: 'Technologies shared with fellow farmers',
    description: 'Technologies applied on the site are shared with fellow farmers and agri-processors.',
    source_reference: 'Responsibilities of LSA Operator',
    category: 'operations', applies_to: 'all', frequency: 'ongoing', sort_order: 100,
  },

  // ── Records and reporting ──
  {
    code: 'REC-OPERATION-RECORDS',
    title: 'Operation records maintained',
    description:
      'Records of production and sales data, technologies developed or shared, activities undertaken, and visitors and trainees served are kept up to date.',
    source_reference: 'Responsibilities of LSA Operator',
    category: 'records_reporting', applies_to: 'all', frequency: 'ongoing', sort_order: 110,
  },
  {
    code: 'REC-SEMESTRAL-REPORT',
    title: 'Semestral accomplishment report submitted',
    description: 'A semestral accomplishment report containing the maintained operation records is submitted to the ATI.',
    source_reference: 'Responsibilities of LSA Operator',
    category: 'records_reporting', applies_to: 'all', frequency: 'semestral', sort_order: 120,
  },
  {
    code: 'REC-MONITORING-ACCESS',
    title: 'ATI field monitoring allowed',
    description: 'ATI personnel are able to conduct field monitoring and visits, and are given honest answers to questions raised.',
    source_reference: 'Responsibilities of LSA Operator',
    category: 'records_reporting', applies_to: 'all', frequency: 'ongoing', sort_order: 130,
  },
  {
    code: 'REC-FIVE-YEAR',
    title: 'Operation sustained for five years',
    description: 'The operator sustains operation as an LSA for five (5) years.',
    source_reference: 'Responsibilities of LSA Operator',
    category: 'records_reporting', applies_to: 'all', frequency: 'five_year', sort_order: 140,
  },

  // ── Capability building ──
  {
    code: 'CAP-ATTEND-TRAINING',
    title: 'ATI monitoring and capability-building activities attended',
    description: 'The operator attends the monitoring and capability-building interventions the ATI requires.',
    source_reference: 'Responsibilities of LSA Operator',
    category: 'capability', applies_to: 'all', frequency: 'annual', sort_order: 150,
  },
  {
    code: 'CAP-RSBSA',
    title: 'RSBSA / NCFRS registration current',
    description:
      'The farmer is registered in the RSBSA maintained by the DA; coconut-based farmers are registered in the NCFRS maintained by the PCA.',
    source_reference: 'Qualification Requirements — The Farmer/Farm Family, item 8',
    category: 'capability', applies_to: 'farming', frequency: 'annual', sort_order: 160,
  },

  // ── Assistance (only where fund support was granted) ──
  {
    code: 'ASSIST-DEV-PLAN',
    title: 'Development plan implemented as approved',
    description:
      'Where fund support was given: the development plan is implemented as approved and completed within the agreed timeframe, with the operator providing a counterpart.',
    source_reference: 'Responsibilities of LSA Operator — with fund support',
    category: 'assistance', applies_to: 'all', frequency: 'once', sort_order: 170,
  },
  {
    code: 'ASSIST-COMPLETION-REPORT',
    title: 'LSA Project Completion Report submitted',
    description:
      'Where fund support was given: the ATI is notified on completion of the development plan through an LSA Project Completion Report, submitted quarterly as required by the COA.',
    source_reference: 'Provision of Assistance / Responsibilities of LSA Operator',
    category: 'assistance', applies_to: 'all', frequency: 'once', sort_order: 180,
  },
];

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'agri_aims',
  });

  try {
    let inserted = 0;
    let updated = 0;
    for (const r of REQUIREMENTS) {
      const [res] = await conn.execute(
        `INSERT INTO compliance_requirements
           (code, title, description, source_reference, category, applies_to, frequency, sort_order)
         VALUES (?,?,?,?,?,?,?,?)
         ON DUPLICATE KEY UPDATE
           title = VALUES(title), description = VALUES(description),
           source_reference = VALUES(source_reference), category = VALUES(category),
           applies_to = VALUES(applies_to), frequency = VALUES(frequency),
           sort_order = VALUES(sort_order), is_active = 1`,
        [r.code, r.title, r.description, r.source_reference, r.category, r.applies_to, r.frequency, r.sort_order]
      );
      // affectedRows is 1 for an insert and 2 for an update of a changed row.
      if (res.affectedRows === 1) inserted += 1; else updated += 1;
    }

    const [[total]] = await conn.query('SELECT COUNT(*) AS c FROM compliance_requirements WHERE is_active = 1');
    console.log(`Compliance requirements: ${inserted} added, ${updated} refreshed, ${total.c} active.`);
    console.log('Each one cites the part of the LSA Guidelines it comes from.');
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error('Seeding failed:', err.message);
  process.exit(1);
});
