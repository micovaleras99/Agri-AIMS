/**
 * Fill the LSA Field Validation Report (ATI-QF-PAD-165) from the applicant/farm
 * record and the Step-5 validation the admin recorded on-screen. The admin then
 * signs the generated report and uploads the signed copy — the system does the
 * filling, not the admin. The master template is never modified.
 */

const fs = require('fs');
const path = require('path');
const { readZip, writeZip, fillBlankAfterLabel, markInlineCheckbox, insertParagraphAfter } = require('./docxFill');
const { withAddress } = require('./selfAssessmentDoc');

const TEMPLATE = path.join(__dirname, '..', 'forms', 'prescribed', 'field-validation-report.docx');
const DOC_TYPE = 'lsa1_field_validation_report';

const CATEGORY_LABEL = {
  private: 'Individual-Owned', organization: 'Private Organization-Owned', government: 'Government Institution',
};

function fillXml(xml, a) {
  const owner = `${a.firstName || ''} ${a.lastName || ''}`.trim();
  xml = fillBlankAfterLabel(xml, 'Name of Farm/Enterprise', a.farmName);
  xml = fillBlankAfterLabel(xml, 'Name of Owner', owner);
  xml = fillBlankAfterLabel(xml, 'Address', a.completeAddress);
  xml = fillBlankAfterLabel(xml, 'Contact Number', a.phone);
  xml = fillBlankAfterLabel(xml, 'e-Mail Address', a.email);
  xml = fillBlankAfterLabel(xml, 'Date of Validation', a.step5ValidationDate || new Date().toISOString().split('T')[0]);

  const isAgri = String(a.classification || '').toLowerCase().includes('agri_process');
  xml = markInlineCheckbox(xml, isAgri ? 'Agri-Processing Enterprise' : 'Farming LSA');
  xml = markInlineCheckbox(xml, CATEGORY_LABEL[a.category] || 'Individual-Owned');

  if (a.step5TwgRemarks) xml = insertParagraphAfter(xml, 'Action/Recommendation:', a.step5TwgRemarks);
  return xml;
}

function fillDocxBuffer(templateBuf, a) {
  const entries = readZip(templateBuf);
  const doc = entries.find((e) => e.name === 'word/document.xml');
  if (!doc) return templateBuf;
  doc.data = Buffer.from(fillXml(doc.data.toString('utf8'), a), 'utf8');
  return writeZip(entries);
}

function downloadName(a) {
  const name = `${a.firstName || ''} ${a.lastName || ''}`
    .trim().replace(/[^\w\- ]+/g, '').replace(/\s+/g, '-') || a.applicationId;
  return `Field-Validation-Report-${name}.docx`;
}

/** The filled report as an editable .docx buffer (admin signs + uploads the signed copy). */
async function fillBuffer(applicant) {
  const a = await withAddress(applicant);
  return { buffer: fillDocxBuffer(fs.readFileSync(TEMPLATE), a), filename: downloadName(a) };
}

module.exports = { fillBuffer, fillXml, DOC_TYPE, TEMPLATE };

// ponytail: self-check fills the real template — run `node services/fieldValidationDoc.js`.
if (require.main === module) {
  const assert = require('assert');
  const a = {
    firstName: 'Juan', lastName: 'Dela Cruz', farmName: 'Sunrise Farm', completeAddress: 'Brgy. San Roque, Iriga',
    phone: '0917', email: 'j@x.ph', classification: 'organic', category: 'private',
    step5ValidationDate: '2026-09-12', step5TwgRemarks: 'Farm meets all facility requirements.', applicationId: 'APP-1',
  };
  const out = readZip(fillDocxBuffer(fs.readFileSync(TEMPLATE), a))
    .find((e) => e.name === 'word/document.xml').data.toString('utf8');
  for (const v of ['Sunrise Farm', 'Juan Dela Cruz', 'Brgy. San Roque, Iriga', '2026-09-12', 'Farm meets all facility requirements.']) {
    assert.ok(out.includes(v), `filled: ${v}`);
  }
  assert.ok(/<w:t xml:space="preserve">✓/.test(out), 'category checkbox ticked');
  assert.ok(!fs.readFileSync(TEMPLATE).includes(Buffer.from('Sunrise Farm')), 'template unchanged');
  console.log('fieldValidationDoc self-check passed');
}
