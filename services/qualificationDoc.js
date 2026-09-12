/**
 * Fill the LSA Qualification Form from the applicant/farm record — identity
 * fields and the "Type of Activity" checkbox matching the applicant's
 * classification. The admin signs and uploads the signed copy. The master
 * template is never modified.
 */

const fs = require('fs');
const path = require('path');
const { readZip, writeZip, fillBlankAfterLabel, markInlineCheckbox } = require('./docxFill');
const { withAddress } = require('./selfAssessmentDoc');

const TEMPLATE = path.join(__dirname, '..', 'forms', 'prescribed', 'qualification-form.docx');
const DOC_TYPE = 'lsa1_qualification_form';

// classification -> the "Type of Activity" checkbox label in the form.
const ACTIVITY_LABEL = {
  gap_crops: 'GAP/GAHP Farm', gahp_animals: 'GAP/GAHP Farm',
  integrated: 'Integrated/Diversified Farm', organic: 'Organic Agriculture',
  halal: 'Halal', cut_flowers: 'Cut Flowers and Ornamentals',
};

function fillXml(xml, a) {
  const owner = `${a.firstName || ''} ${a.lastName || ''}`.trim();
  xml = fillBlankAfterLabel(xml, 'Name of Farmer', owner);
  xml = fillBlankAfterLabel(xml, 'Name of Farm', a.farmName);
  xml = fillBlankAfterLabel(xml, 'Address', a.completeAddress);
  xml = fillBlankAfterLabel(xml, 'Area', a.farmArea ? String(a.farmArea) : '');
  xml = fillBlankAfterLabel(xml, 'Date Established', a.farmEstablishedDate || '');
  const label = ACTIVITY_LABEL[a.classification];
  if (label) xml = markInlineCheckbox(xml, label);
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
  return `Qualification-Form-${name}.docx`;
}

async function fillBuffer(applicant) {
  const a = await withAddress(applicant);
  return { buffer: fillDocxBuffer(fs.readFileSync(TEMPLATE), a), filename: downloadName(a) };
}

module.exports = { fillBuffer, fillXml, DOC_TYPE, TEMPLATE };

// ponytail: self-check — run `node services/qualificationDoc.js`.
if (require.main === module) {
  const assert = require('assert');
  const a = { firstName: 'Juan', lastName: 'Dela Cruz', farmName: 'Sunrise Farm', farmArea: 2, completeAddress: 'Brgy. San Roque', farmEstablishedDate: '2015-01-01', classification: 'organic', applicationId: 'APP-1' };
  const out = readZip(fillDocxBuffer(fs.readFileSync(TEMPLATE), a))
    .find((e) => e.name === 'word/document.xml').data.toString('utf8');
  for (const v of ['Sunrise Farm', 'Juan Dela Cruz', 'Brgy. San Roque', '2015-01-01']) assert.ok(out.includes(v), `filled: ${v}`);
  assert.ok(/<w:t xml:space="preserve">✓/.test(out), 'activity checkbox ticked');
  assert.ok(!fs.readFileSync(TEMPLATE).includes(Buffer.from('Sunrise Farm')), 'template unchanged');
  console.log('qualificationDoc self-check passed');
}
