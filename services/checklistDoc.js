/**
 * Fill the Applicant's Checklist of Requirements from the application: the
 * applicant's identity, category, and a "Complied" tick for every requirement
 * already submitted and verified. The admin signs and uploads the signed copy.
 * The master template is never modified.
 */

const fs = require('fs');
const path = require('path');
const documentModel = require('../models/documentModel');
const {
  readZip, writeZip, fillBlankAfterLabel, markCheckCell, markInlineCheckbox,
} = require('./docxFill');
const { withAddress } = require('./selfAssessmentDoc');

const TEMPLATE = path.join(__dirname, '..', 'forms', 'prescribed', 'applicants-checklist.docx');
const DOC_TYPE = 'lsa1_checklist';

const REQUIREMENTS = [
  { locate: 'Signed Briefer', types: ['signed_briefer'] },
  { locate: 'Assessment Form', types: ['self_assessment'] },
  { locate: 'Letter of Intent', types: ['letter_of_intent'] },
  { locate: 'Endorsement by LGU/PLGU', types: ['endorsement'] },
  { locate: 'Enterprise Profile Form', types: ['farm_profile'] },
];

function fillXml(xml, a, verifiedTypes) {
  const owner = `${a.firstName || ''} ${a.lastName || ''}`.trim();
  xml = fillBlankAfterLabel(xml, 'Name of Farm Owner', owner);
  xml = fillBlankAfterLabel(xml, 'Name of Farm', a.farmName);
  xml = fillBlankAfterLabel(xml, 'Land area', a.farmArea ? String(a.farmArea) : '');
  xml = fillBlankAfterLabel(xml, 'Address', a.completeAddress);
  xml = fillBlankAfterLabel(xml, 'Contact No', a.phone);
  xml = fillBlankAfterLabel(xml, 'Email Address', a.email);

  const isAgri = String(a.classification || '').toLowerCase().includes('agri_process');
  xml = markInlineCheckbox(xml, isAgri ? 'Agri-Processing Enterprise' : 'Farming LSA');

  for (const req of REQUIREMENTS) {
    if (req.types.some((t) => verifiedTypes.has(t))) {
      xml = markCheckCell(xml, 0, xml.length, req.locate, '✓', 2);
    }
  }
  return xml;
}

function fillDocxBuffer(templateBuf, a, verifiedTypes) {
  const entries = readZip(templateBuf);
  const doc = entries.find((e) => e.name === 'word/document.xml');
  if (!doc) return templateBuf;
  doc.data = Buffer.from(fillXml(doc.data.toString('utf8'), a, verifiedTypes), 'utf8');
  return writeZip(entries);
}

function downloadName(a) {
  const name = `${a.firstName || ''} ${a.lastName || ''}`
    .trim().replace(/[^\w\- ]+/g, '').replace(/\s+/g, '-') || a.applicationId;
  return `Applicants-Checklist-${name}.docx`;
}

async function fillBuffer(applicant) {
  const a = await withAddress(applicant);
  const docs = await documentModel.findByApplicant(applicant.id);
  const verifiedTypes = new Set(docs.filter((d) => d.status === 'verified').map((d) => d.type));
  return { buffer: fillDocxBuffer(fs.readFileSync(TEMPLATE), a, verifiedTypes), filename: downloadName(a) };
}

module.exports = { fillBuffer, fillXml, REQUIREMENTS, DOC_TYPE, TEMPLATE };

// ponytail: self-check — run `node services/checklistDoc.js`.
if (require.main === module) {
  const assert = require('assert');
  const a = { firstName: 'Juan', lastName: 'Dela Cruz', farmName: 'Sunrise Farm', farmArea: 2, completeAddress: 'Brgy. San Roque', phone: '0917', email: 'j@x.ph', classification: 'organic', applicationId: 'APP-1' };
  const verified = new Set(['signed_briefer', 'self_assessment', 'farm_profile']);
  const out = readZip(fillDocxBuffer(fs.readFileSync(TEMPLATE), a, verified))
    .find((e) => e.name === 'word/document.xml').data.toString('utf8');
  for (const v of ['Sunrise Farm', 'Juan Dela Cruz', 'Brgy. San Roque']) assert.ok(out.includes(v), `filled: ${v}`);
  assert.strictEqual((out.match(/<w:t xml:space="preserve">✓<\/w:t>/g) || []).length, 3, 'three Complied ticks');
  assert.ok(!fs.readFileSync(TEMPLATE).includes(Buffer.from('Sunrise Farm')), 'template unchanged');
  console.log('checklistDoc self-check passed');
}
