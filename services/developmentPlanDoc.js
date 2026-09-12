/**
 * Generate the completed LSA Development Plan from the official DOCX template.
 *
 * The applicant authors the plan on-screen (models/developmentPlanModel.js); this
 * fills a COPY of forms/prescribed/lsa-development-plan.docx with the Basic
 * Information already on file plus that authored content — inline labels for the
 * identity fields, a paragraph each for the Rationale and Objectives, and rows in
 * the Work Plan and Budget tables — then converts it to PDF (Word) and registers
 * it in Document Management. The master template is never modified.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const documentModel = require('../models/documentModel');
const developmentPlanModel = require('../models/developmentPlanModel');
const { UPLOAD_DIR, humanSize } = require('../config/upload');
const {
  readZip, writeZip, fillInlineLabel, insertParagraphAfter, appendTableRows,
} = require('./docxFill');
const docxToPdf = require('./docxToPdf');
const { withAddress } = require('./selfAssessmentDoc');

const TEMPLATE = path.join(__dirname, '..', 'forms', 'prescribed', 'lsa-development-plan.docx');
const DOC_TYPE = 'development_plan';
const DOC_LABEL = 'Development Plan';
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** Keep only rows that have at least one non-empty cell. */
function nonEmpty(rows, keys) {
  return (rows || [])
    .filter((r) => keys.some((k) => String(r[k] || '').trim()))
    .map((r) => keys.map((k) => r[k] || ''));
}

/** Apply the whole plan to the document xml. */
function fillPlanXml(xml, a, plan) {
  const owner = `${a.firstName || ''} ${a.lastName || ''}`.trim();
  xml = fillInlineLabel(xml, 'Name of LSA', a.farmName);
  xml = fillInlineLabel(xml, 'Name of Owner/Contact Person', owner);
  xml = fillInlineLabel(xml, 'Address', a.completeAddress);
  xml = fillInlineLabel(xml, 'Contact Number', a.phone);
  xml = fillInlineLabel(xml, 'e-Mail Address', a.email);
  xml = fillInlineLabel(xml, 'Date of Implementation', plan.dateOfImplementation);
  xml = insertParagraphAfter(xml, 'Rationale/Background', plan.rationale);
  xml = insertParagraphAfter(xml, 'Objective/s', plan.objectives);
  const wp = nonEmpty(plan.workPlan, ['component', 'timeFrame', 'targetOutput', 'agency', 'budget']);
  if (wp.length) xml = appendTableRows(xml, 'Development Plan Component', wp);
  const br = nonEmpty(plan.budgetRows, ['description', 'quantity', 'unitCost', 'totalCost']);
  if (br.length) xml = appendTableRows(xml, 'Description/Specifications', br);
  return xml;
}

/** Fill a copy of the template and return the .docx buffer. */
function fillDocxBuffer(templateBuf, a, plan) {
  const entries = readZip(templateBuf);
  const doc = entries.find((e) => e.name === 'word/document.xml');
  if (!doc) return templateBuf;
  doc.data = Buffer.from(fillPlanXml(doc.data.toString('utf8'), a, plan), 'utf8');
  return writeZip(entries);
}

/** "Development-Plan-Juan-Dela-Cruz.pdf" — the download name. */
function downloadName(a, ext = 'pdf') {
  const name = `${a.firstName || ''} ${a.lastName || ''}`
    .trim().replace(/[^\w\- ]+/g, '').replace(/\s+/g, '-') || a.applicationId;
  return `Development-Plan-${name}.${ext}`;
}

/** Required inputs that are still missing, by label. */
function missingFor(a, plan) {
  const miss = [];
  if (!a.farmName || !String(a.farmName).trim()) miss.push('Farm Name');
  if (!a.completeAddress || !String(a.completeAddress).trim()) miss.push('Complete Address');
  if (!plan) miss.push('Development Plan content (fill in the plan first)');
  return miss;
}

/** The filled plan as an editable .docx buffer (best-effort, nothing stored). */
async function fillBuffer(applicant) {
  const a = await withAddress(applicant);
  const plan = (await developmentPlanModel.get(applicant.id)) || {};
  return { buffer: fillDocxBuffer(fs.readFileSync(TEMPLATE), a, plan), filename: downloadName(a, 'docx') };
}

/**
 * Generate the completed Development Plan as a PDF and register it, replacing any
 * previous copy. Returns { ok:false, missing } when required inputs are absent.
 */
async function generate(applicant) {
  const a = await withAddress(applicant);
  const plan = await developmentPlanModel.get(applicant.id);
  const missing = missingFor(a, plan);
  if (missing.length) return { ok: false, missing };

  const filled = fillDocxBuffer(fs.readFileSync(TEMPLATE), a, plan);
  const base = crypto.randomBytes(16).toString('hex');
  const docxPath = path.join(UPLOAD_DIR, `${base}.docx`);
  fs.writeFileSync(docxPath, filled);

  let storedName; let mimeType; let filename; let sizeBytes;
  try {
    const pdfPath = path.join(UPLOAD_DIR, `${base}.pdf`);
    docxToPdf.convert(docxPath, pdfPath);
    fs.unlinkSync(docxPath);
    storedName = `${base}.pdf`;
    mimeType = 'application/pdf';
    filename = downloadName(a, 'pdf');
    sizeBytes = fs.statSync(pdfPath).size;
  } catch (err) {
    console.error('developmentPlanDoc: PDF conversion failed, serving DOCX —', err.message);
    storedName = `${base}.docx`;
    mimeType = DOCX_MIME;
    filename = downloadName(a, 'docx');
    sizeBytes = filled.length;
  }

  await documentModel.removeSameType(a.id, DOC_TYPE);
  const docId = await documentModel.create({
    applicantId: a.id,
    applicationId: a.applicationId,
    applicantName: `${a.firstName} ${a.lastName}`,
    name: DOC_LABEL,
    type: DOC_TYPE,
    filename,
    storedName,
    mimeType,
    sizeBytes,
    size: humanSize(sizeBytes),
    uploadDate: new Date().toISOString().split('T')[0],
    status: 'pending_review',
    remarks: '',
  });
  await documentModel.syncCount(a.id);
  return { ok: true, docId, storedName, filename };
}

module.exports = { generate, fillBuffer, missingFor, fillPlanXml, TEMPLATE, DOC_TYPE };

// ponytail: self-check fills the real template with a sample plan — run
// `node services/developmentPlanDoc.js`.
if (require.main === module) {
  const assert = require('assert');
  const a = { firstName: 'Juan', lastName: 'Dela Cruz', farmName: 'Sunrise Farm', completeAddress: 'Brgy. San Roque, Iriga City', phone: '0917', email: 'j@x.ph' };
  const plan = {
    dateOfImplementation: '2027-01',
    rationale: 'A model integrated farm.\nSecond line.',
    objectives: 'Demonstrate technologies.',
    workPlan: [
      { component: 'Expand TDA', timeFrame: 'Q1 2027', targetOutput: 'Bigger demo', agency: 'ATI', budget: '50000' },
      { component: '', timeFrame: '', targetOutput: '', agency: '', budget: '' }, // empty -> dropped
    ],
    budgetRows: [{ description: 'Hand tractor', quantity: '1', unitCost: '80000', totalCost: '80000' }],
  };
  const out = readZip(fillDocxBuffer(fs.readFileSync(TEMPLATE), a, plan))
    .find((e) => e.name === 'word/document.xml').data.toString('utf8');
  for (const v of ['Name of LSA: Sunrise Farm', 'Name of Owner/Contact Person: Juan Dela Cruz',
    'A model integrated farm.', 'Second line.', 'Demonstrate technologies.',
    'Expand TDA', 'Bigger demo', 'Hand tractor', '80000']) {
    assert.ok(out.includes(v), `filled: ${v}`);
  }
  assert.deepStrictEqual(missingFor({ farmName: '', completeAddress: '' }, null),
    ['Farm Name', 'Complete Address', 'Development Plan content (fill in the plan first)'], 'missing list');
  assert.ok(!fs.readFileSync(TEMPLATE).includes(Buffer.from('Sunrise Farm')), 'template unchanged');
  console.log('developmentPlanDoc self-check passed');
}
