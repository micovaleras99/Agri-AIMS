/**
 * Generate a completed Self-Assessment DOCX for an applicant.
 *
 * The official form (forms/prescribed/self-assessment.docx) is the master
 * template and is never modified. For each applicant this reads the master,
 * writes the applicant's Basic Information and their on-screen checklist answers
 * into a COPY (services/docxFill.js), stores that copy in the private uploads/
 * area, and registers it in Document Management — so it streams and cleans up
 * through the same role-checked plumbing as any uploaded document. Re-running it
 * regenerates the copy from the latest database values.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const documentModel = require('../models/documentModel');
const assessmentModel = require('../models/assessmentModel');
const locationModel = require('../models/locationModel');
const { UPLOAD_DIR, humanSize } = require('../config/upload');
const { fillSelfAssessment } = require('./docxFill');
const docxToPdf = require('./docxToPdf');
const { BASIC_INFO, REQUIRED, SECTIONS, sectionKeyFor } = require('../config/selfAssessmentFill');

const TEMPLATE = path.join(__dirname, '..', 'forms', 'prescribed', 'self-assessment.docx');
const DOC_TYPE = 'self_assessment';
const DOC_LABEL = 'Self-Assessment Form';
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** One address line from its parts, de-duplicated (mirrors routes/forms.js). */
function composeAddressLine(street, barangayName, municipality, province) {
  const s = String(street || '').trim();
  const sLc = s.toLowerCase();
  const brgy = barangayName ? `Brgy. ${barangayName}` : '';
  const extra = [brgy, municipality, province].filter((p) => {
    if (!p) return false;
    const bare = String(p).replace(/^Brgy\.\s*/i, '');
    return !sLc.includes(bare.toLowerCase());
  });
  return [s, ...extra].filter(Boolean).join(', ');
}

/** The applicant's complete address, derived from barangay_id where present. */
async function completeAddress(a) {
  if (!a) return '';
  const anc = a.barangayId ? await locationModel.findAncestry(a.barangayId).catch(() => null) : null;
  return composeAddressLine(
    a.farmAddress, anc && anc.barangayName,
    (anc && anc.municipalityName) || a.municipality,
    (anc && anc.provinceName) || a.province
  );
}

/** Applicant record augmented with the resolved complete address. */
async function withAddress(applicant) {
  return { ...applicant, completeAddress: await completeAddress(applicant) };
}

/** Required Basic Information that is still missing, by label (pure). */
function missingFields(a) {
  return REQUIRED.filter((r) => {
    const v = a[r.key];
    if (r.key === 'farmArea') return !Number(v);
    return v === undefined || v === null || String(v).trim() === '';
  }).map((r) => r.label);
}

/** The check marks for a section from an answer map (pure). */
function marksFor(sectionKey, answerMap = {}) {
  return SECTIONS[sectionKey].rows.map((r) => ({
    section: sectionKey, locate: r.locate, mark: answerMap[r.code] ? '/' : 'x',
  }));
}

/** The full fill payload for docxFill.fillSelfAssessment. */
async function buildFillData(a) {
  const answers = await assessmentModel.answerMap(a.id, 2);
  return {
    basicInfo: BASIC_INFO.map((f) => ({ label: f.label, value: f.value(a) })),
    marks: marksFor(sectionKeyFor(a), answers),
  };
}

/**
 * The filled Self-Assessment as an editable .docx buffer — best-effort, filling
 * whatever data exists (no required-field block, no PDF, nothing stored). Used
 * by the "Download" action in the Documentary Requirements list, which hands the
 * applicant an editable Word copy of their own answers.
 */
async function fillBuffer(applicant) {
  const a = await withAddress(applicant);
  return {
    buffer: fillSelfAssessment(fs.readFileSync(TEMPLATE), await buildFillData(a)),
    filename: downloadName(a, 'docx'),
  };
}

/** "Self-Assessment-Juan-Dela-Cruz.pdf" — the download name. */
function downloadName(a, ext = 'pdf') {
  const name = `${a.firstName || ''} ${a.lastName || ''}`
    .trim().replace(/[^\w\- ]+/g, '').replace(/\s+/g, '-') || a.applicationId;
  return `Self-Assessment-${name}.${ext}`;
}

/**
 * Generate (or regenerate) the completed DOCX and register it. Replaces any
 * previous Self-Assessment document for the applicant, so it stays a single,
 * current copy. Returns { ok:false, missing } when required info is absent.
 *
 * @param {object} applicant  an applicantModel record (barangay etc. included)
 * @returns {Promise<{ok:true, docId:number, storedName:string, filename:string}
 *                   | {ok:false, missing:string[]}>}
 */
async function generate(applicant) {
  const a = await withAddress(applicant);
  const missing = missingFields(a);
  if (missing.length) return { ok: false, missing };

  const filled = fillSelfAssessment(fs.readFileSync(TEMPLATE), await buildFillData(a));

  // Fill a .docx copy, then convert it to PDF with Word so the final document is
  // a portable PDF that preserves the official layout. If Word conversion fails
  // (e.g. Word not present at runtime), fall back to serving the .docx.
  const base = crypto.randomBytes(16).toString('hex');
  const docxPath = path.join(UPLOAD_DIR, `${base}.docx`);
  fs.writeFileSync(docxPath, filled);

  let storedName; let mimeType; let filename; let sizeBytes;
  try {
    const pdfPath = path.join(UPLOAD_DIR, `${base}.pdf`);
    docxToPdf.convert(docxPath, pdfPath);
    fs.unlinkSync(docxPath); // keep only the PDF
    storedName = `${base}.pdf`;
    mimeType = 'application/pdf';
    filename = downloadName(a, 'pdf');
    sizeBytes = fs.statSync(pdfPath).size;
  } catch (err) {
    console.error('selfAssessmentDoc: PDF conversion failed, serving DOCX —', err.message);
    storedName = `${base}.docx`;
    mimeType = DOCX_MIME;
    filename = downloadName(a, 'docx');
    sizeBytes = filled.length;
  }

  // Replace any previous copy (deletes its row and file) so one current remains.
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

module.exports = { generate, fillBuffer, missingFields, marksFor, buildFillData, withAddress, TEMPLATE, DOC_TYPE };

// ponytail: self-check for the pure helpers — run `node services/selfAssessmentDoc.js`.
if (require.main === module) {
  const assert = require('assert');

  assert.deepStrictEqual(
    missingFields({ farmName: 'F', completeAddress: 'A', farmArea: 1000, farmEstablishedDate: '2020-01-01' }), [],
    'complete record has nothing missing');
  assert.deepStrictEqual(
    missingFields({ farmName: '', completeAddress: 'A', farmArea: 0, farmEstablishedDate: '' }),
    ['Farm Name', 'Farm Area', 'Date Established'], 'blank name, zero area and no date are missing');

  const m = marksFor('farming', { f4: true, f5: false });
  const holding = m.find((x) => x.locate === 'Holding Area');
  const wash = m.find((x) => x.locate === 'Wash Area');
  assert.strictEqual(holding.mark, '/', 'ticked -> slash');
  assert.strictEqual(wash.mark, 'x', 'unticked -> x');
  assert.ok(m.every((x) => x.section === 'farming'), 'all marks scoped to the section');
  assert.ok(marksFor('agri', {}).every((x) => x.mark === 'x'), 'no answers -> all x');
  assert.strictEqual(downloadName({ firstName: 'Juan', lastName: 'Dela Cruz' }), 'Self-Assessment-Juan-Dela-Cruz.pdf',
    'download name is slugged, PDF by default');
  assert.strictEqual(downloadName({ firstName: 'Juan', lastName: 'Dela Cruz' }, 'docx'), 'Self-Assessment-Juan-Dela-Cruz.docx',
    'docx fallback name');

  console.log('selfAssessmentDoc self-check passed');
}
