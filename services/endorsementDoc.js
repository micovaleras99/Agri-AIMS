/**
 * Fill the RTWG Endorsement Checklist of Requirements from the application: the
 * applicant's identity, the assigned evaluator's name, and a "Complied" tick for
 * every requirement the applicant has already submitted and had verified. The
 * admin then signs the generated checklist and uploads the signed copy. The
 * master template is never modified.
 */

const fs = require('fs');
const path = require('path');
const documentModel = require('../models/documentModel');
const {
  readZip, writeZip, fillBlankAfterLabel, markCheckCell, markInlineCheckbox, xmlEscape,
} = require('./docxFill');
const { withAddress } = require('./selfAssessmentDoc');

const TEMPLATE = path.join(__dirname, '..', 'forms', 'prescribed', 'endorsement-checklist.docx');
const DOC_TYPE = 'lsa1_rtwg_endorsement';

// Requirement row (located by a substring unique to that row) -> the document
// type(s) that satisfy it. A row is ticked "Complied" when a mapped document is
// verified; otherwise it is left blank for the admin.
const REQUIREMENTS = [
  { locate: 'Checklist of Requirements', types: ['lsa1_checklist', 'lsa2_checklist'] },
  { locate: 'Letter of Intent', types: ['letter_of_intent'] },
  { locate: 'Agri-Processing Enterprise Profile', types: ['farm_profile', 'lsa2_updated_profile'] },
  { locate: 'Qualification Form', types: ['lsa1_qualification_form', 'lsa2_qualification_form'] },
  { locate: 'Field Validation Report', types: ['lsa1_field_validation_report', 'lsa2_field_validation_report'] },
  { locate: 'Acceptance to Become LSA', types: ['lsa1_acceptance_form', 'lsa2_acceptance_form'] },
  { locate: 'Endorsement of the RTWG', types: ['lsa1_rtwg_endorsement', 'lsa2_rtwg_endorsement'] },
  { locate: 'Certificate of Good Standing', types: ['cert_good_standing'] },
  { locate: 'Development Plan', types: ['development_plan'] },
];

/** Fill the owner-name value cell, skipping the header occurrence in the first table. */
function fillOwnerName(xml, owner) {
  if (!owner) return xml;
  let i = xml.indexOf('Name of Owner');
  i = xml.indexOf('Name of Owner', i + 1); // second occurrence = the labelled data row
  if (i < 0) return xml;
  const m = /_{3,}/.exec(xml.slice(i));
  if (!m) return xml;
  const at = i + m.index;
  return xml.slice(0, at) + xmlEscape(owner) + xml.slice(at + m[0].length);
}

function fillXml(xml, a, verifiedTypes, evaluator) {
  const owner = `${a.firstName || ''} ${a.lastName || ''}`.trim();
  xml = fillOwnerName(xml, owner);
  xml = fillBlankAfterLabel(xml, 'Land area', a.farmArea ? String(a.farmArea) : '');
  xml = fillBlankAfterLabel(xml, 'Address', a.completeAddress);
  xml = fillBlankAfterLabel(xml, 'Contact No', a.phone);
  xml = fillBlankAfterLabel(xml, 'Email Address', a.email);

  // Category checkboxes.
  const isAgri = String(a.classification || '').toLowerCase().includes('agri_process');
  xml = markInlineCheckbox(xml, isAgri ? 'Agri-Processing Enterprise' : 'Farming LSA');
  const assist = String(a.assistanceType || '').toLowerCase();
  xml = markInlineCheckbox(xml, assist.includes('financ') ? 'With Financial Assistance' : 'Technical Assistance Only');

  // Requirements: tick "Complied" (2nd cell) for each verified requirement.
  for (const req of REQUIREMENTS) {
    if (req.types.some((t) => verifiedTypes.has(t))) {
      xml = markCheckCell(xml, 0, xml.length, req.locate, '✓', 2);
    }
  }

  // Evaluated by — the assigned admin/evaluator.
  xml = fillBlankAfterLabel(xml, 'Evaluated by', evaluator);
  return xml;
}

function fillDocxBuffer(templateBuf, a, verifiedTypes, evaluator) {
  const entries = readZip(templateBuf);
  const doc = entries.find((e) => e.name === 'word/document.xml');
  if (!doc) return templateBuf;
  doc.data = Buffer.from(fillXml(doc.data.toString('utf8'), a, verifiedTypes, evaluator), 'utf8');
  return writeZip(entries);
}

function downloadName(a) {
  const name = `${a.firstName || ''} ${a.lastName || ''}`
    .trim().replace(/[^\w\- ]+/g, '').replace(/\s+/g, '-') || a.applicationId;
  return `Endorsement-Checklist-${name}.docx`;
}

/**
 * The filled checklist as an editable .docx buffer (admin signs + uploads).
 * @param {object} applicant
 * @param {{evaluator?:string}} [opts]  the assigned evaluator's name
 */
async function fillBuffer(applicant, opts = {}) {
  const a = await withAddress(applicant);
  const docs = await documentModel.findByApplicant(applicant.id);
  const verifiedTypes = new Set(docs.filter((d) => d.status === 'verified').map((d) => d.type));
  return {
    buffer: fillDocxBuffer(fs.readFileSync(TEMPLATE), a, verifiedTypes, opts.evaluator || ''),
    filename: downloadName(a),
  };
}

module.exports = { fillBuffer, fillXml, REQUIREMENTS, DOC_TYPE, TEMPLATE };

// ponytail: self-check fills the real template — run `node services/endorsementDoc.js`.
if (require.main === module) {
  const assert = require('assert');
  const a = {
    firstName: 'Juan', lastName: 'Dela Cruz', farmArea: 3, completeAddress: 'Brgy. San Roque, Iriga',
    phone: '0917', email: 'j@x.ph', classification: 'organic', assistanceType: 'technical', applicationId: 'APP-1',
  };
  const verified = new Set(['farm_profile', 'lsa1_field_validation_report', 'development_plan']);
  const out = readZip(fillDocxBuffer(fs.readFileSync(TEMPLATE), a, verified, 'Maria Santos'))
    .find((e) => e.name === 'word/document.xml').data.toString('utf8');
  for (const v of ['Juan Dela Cruz', 'Brgy. San Roque, Iriga', 'j@x.ph', 'Maria Santos']) {
    assert.ok(out.includes(v), `filled: ${v}`);
  }
  // 3 verified requirements ticked (Profile, Field Validation Report, Development Plan).
  assert.strictEqual((out.match(/<w:t xml:space="preserve">✓<\/w:t>/g) || []).length, 3, 'three Complied ticks');
  assert.ok(!fs.readFileSync(TEMPLATE).includes(Buffer.from('Maria Santos')), 'template unchanged');
  console.log('endorsementDoc self-check passed');
}
