/**
 * Generate the completed Farm/Agri-Enterprise Profile (ATI-QF-PAD-48) from the
 * official DOCX. The applicant authors the profile on-screen
 * (models/farmProfileModel.js); this fills a COPY of the prescribed template
 * (farming or agri-processing variant) with the identity fields already on file
 * plus the authored content — inline fields, Sex/Civil-status/Owner/facility
 * checkboxes, and the Membership / Trainings / Topics / Enterprise / Machinery
 * tables — then converts it to PDF (Word) and registers it. The master is never
 * modified.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const documentModel = require('../models/documentModel');
const farmProfileModel = require('../models/farmProfileModel');
const { resolvePrescribed } = require('../config/prescribedForms');
const { UPLOAD_DIR, humanSize } = require('../config/upload');
const {
  readZip, writeZip, fillInlineLabel, fillValueCellScoped, fillBlankAfter,
  markInlineCheckbox, appendTableRows, CHECK_MARK,
} = require('./docxFill');
const docxToPdf = require('./docxToPdf');
const { withAddress } = require('./selfAssessmentDoc');

const DOC_TYPE = 'farm_profile';
const DOC_LABEL = 'Farm/Agri-Enterprise Profile';
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

// Section anchors used to scope labels that repeat between sections.
const A1 = ['A.1 For Individual', 'A.2 For Private'];
const A2 = ['A.2 For Private', 'Membership in Organization'];
const WORKERS = ['No. of Workers', 'FARM ENTERPRISE'];

const OWNER_LABEL = {
  individual: 'Farmer/Farm Family', organization: 'Private Organization', government: 'Government Institution',
};
const CIVIL_LABEL = { Single: 'Single', Married: 'Married', Separated: 'Separated', Widowed: 'Widow', Widow: 'Widow' };

/** facility key -> a distinctive prefix of its checkbox label in the DOCX. */
const FACILITIES = {
  trainingHall: 'Training/Activity Hall', toilet: 'Toilet', washArea: 'Wash Area', storageRoom: 'Storage Room',
  plantNursery: 'Plant nursery', fertilizer: 'Fertilizer and Feeds', vegetables: 'Vegetables, Herbs',
  livestock: 'Livestock production', poultry: 'Poultry production', fishery: 'Fishery production',
  cutFlowers: 'Cut Flowers', postHarvest: 'Post-harvest',
  adminOffice: 'Administrative Office', dormitory: 'Dormitory', materialRecovery: 'Material Recovery', parking: 'Parking Area',
};

function nonEmpty(rows, keys) {
  return (rows || [])
    .filter((r) => keys.some((k) => String(r[k] || '').trim()))
    .map((r) => keys.map((k) => r[k] || ''));
}

/** Apply the whole profile to the document xml. */
function fillProfileXml(xml, a, p) {
  const owner = `${a.firstName || ''} ${a.lastName || ''}`.trim();
  const org = p.organization || {};
  const farm = p.farm || {};
  const fac = p.facilities || {};

  // Owner type (top of form)
  if (OWNER_LABEL[p.ownerType]) xml = markInlineCheckbox(xml, OWNER_LABEL[p.ownerType]);

  // A.1 — Individual (scoped so its labels don't hit the A.2 block)
  xml = fillInlineLabel(xml, 'Name of Applicant', owner, ...A1);
  xml = fillInlineLabel(xml, 'Date of Birth', a.dateOfBirth, ...A1);
  xml = fillInlineLabel(xml, 'Ethnic Origin/Tribe', a.ethnicOrigin, ...A1);
  xml = fillValueCellScoped(xml, 'Home Address', a.homeAddress, ...A1);
  xml = fillInlineLabel(xml, 'Cellphone No.', a.phone, ...A1);
  xml = fillInlineLabel(xml, 'e-mail Address', a.email, ...A1);
  xml = fillInlineLabel(xml, 'Educational Attainment', a.educationalAttainment, ...A1);
  xml = fillInlineLabel(xml, 'RSBSA/NCFRS Registration No.', a.rsbsaNumber, ...A1);
  if (p.sex) xml = markInlineCheckbox(xml, p.sex, CHECK_MARK, ...A1);
  if (CIVIL_LABEL[a.civilStatus]) xml = markInlineCheckbox(xml, CIVIL_LABEL[a.civilStatus], CHECK_MARK, ...A1);

  // A.2 — Organization / Government (scoped)
  xml = fillInlineLabel(xml, 'Name of Organization', org.name, ...A2);
  xml = fillInlineLabel(xml, 'Registered Address', org.registeredAddress, ...A2);
  xml = fillInlineLabel(xml, 'Name of Farm Manager/In-Charge', org.managerName, ...A2);
  xml = fillInlineLabel(xml, 'Position/Designation', org.managerPosition, ...A2);
  xml = fillInlineLabel(xml, 'Educational Attainment of Farm Manager/In-Charge', org.managerEducation, ...A2);
  xml = fillInlineLabel(xml, 'Cellphone No', org.managerCellphone, ...A2);
  xml = fillInlineLabel(xml, 'Landline', org.managerLandline, ...A2);
  xml = fillInlineLabel(xml, 'e-mail Address', org.managerEmail, ...A2);

  // Tables (each located by a header cell unique to it)
  xml = appendTableRows(xml, 'Date Joined', nonEmpty(p.membership, ['organization', 'dateJoined', 'position']));
  xml = appendTableRows(xml, 'Title of Training', nonEmpty(p.trainings, ['title', 'dateAttended', 'sponsor']));
  xml = appendTableRows(xml, 'No. of times delivered', nonEmpty(p.topics, ['topic', 'timesDelivered', 'audience']));
  xml = appendTableRows(xml, 'Ave. Annual Production', nonEmpty(p.enterprise, ['component', 'areaDevoted', 'aveProduction', 'aveIncome']));
  xml = appendTableRows(xml, 'Farm machinery/tools', nonEmpty(p.machinery, ['item', 'quantity']));

  // THE FARM
  xml = fillInlineLabel(xml, 'Location/Address of Farm', a.completeAddress);
  xml = fillInlineLabel(xml, 'Total Farm Area', a.farmArea ? String(a.farmArea) : '');
  xml = fillBlankAfter(xml, 'Year started Farming:', farm.yearStartedFarming);
  xml = fillBlankAfter(xml, 'No. of Years in Farming:', farm.yearsFarming);
  xml = fillBlankAfter(xml, 'Business Permit:', farm.businessPermit);
  xml = fillBlankAfter(xml, 'Area devoted to Organic Farming:', farm.organicArea);
  xml = fillBlankAfter(xml, 'Year started Organic Farming:', farm.organicYearStarted);
  xml = fillBlankAfter(xml, 'No. of Years in Organic Farming:', farm.organicYears);
  xml = fillBlankAfter(xml, 'Male', farm.workersMale, ...WORKERS);
  xml = fillBlankAfter(xml, 'Female', farm.workersFemale, ...WORKERS);
  xml = fillBlankAfter(xml, 'Total', farm.workersTotal, ...WORKERS);

  // Facilities (D)
  for (const [key, label] of Object.entries(FACILITIES)) {
    if (fac[key]) xml = markInlineCheckbox(xml, label);
  }

  // Prepared by (signature line)
  xml = fillBlankAfter(xml, 'Prepared by:', owner);
  return xml;
}

function fillDocxBuffer(templateBuf, a, p) {
  const entries = readZip(templateBuf);
  const doc = entries.find((e) => e.name === 'word/document.xml');
  if (!doc) return templateBuf;
  doc.data = Buffer.from(fillProfileXml(doc.data.toString('utf8'), a, p), 'utf8');
  return writeZip(entries);
}

function downloadName(a, ext = 'pdf') {
  const name = `${a.firstName || ''} ${a.lastName || ''}`
    .trim().replace(/[^\w\- ]+/g, '').replace(/\s+/g, '-') || a.applicationId;
  return `Farm-Profile-${name}.${ext}`;
}

function missingFor(a, profile) {
  const miss = [];
  if (!a.farmName || !String(a.farmName).trim()) miss.push('Farm Name');
  if (!profile) miss.push('Farm Profile content (fill in the profile first)');
  return miss;
}

/** The filled profile as an editable .docx buffer (best-effort, nothing stored). */
async function fillBuffer(applicant) {
  const a = await withAddress(applicant);
  const profile = (await farmProfileModel.get(applicant.id)) || {};
  const template = resolvePrescribed('farm_profile', applicant);
  return { buffer: fillDocxBuffer(fs.readFileSync(template), a, profile), filename: downloadName(a, 'docx') };
}

/** Generate the completed Profile as a PDF and register it, replacing any previous copy. */
async function generate(applicant) {
  const a = await withAddress(applicant);
  const profile = await farmProfileModel.get(applicant.id);
  const missing = missingFor(a, profile);
  if (missing.length) return { ok: false, missing };

  const template = resolvePrescribed('farm_profile', applicant);
  const filled = fillDocxBuffer(fs.readFileSync(template), a, profile);
  const base = crypto.randomBytes(16).toString('hex');
  const docxPath = path.join(UPLOAD_DIR, `${base}.docx`);
  fs.writeFileSync(docxPath, filled);

  let storedName; let mimeType; let filename; let sizeBytes;
  try {
    const pdfPath = path.join(UPLOAD_DIR, `${base}.pdf`);
    docxToPdf.convert(docxPath, pdfPath);
    fs.unlinkSync(docxPath);
    storedName = `${base}.pdf`; mimeType = 'application/pdf'; filename = downloadName(a, 'pdf');
    sizeBytes = fs.statSync(pdfPath).size;
  } catch (err) {
    console.error('farmProfileDoc: PDF conversion failed, serving DOCX —', err.message);
    storedName = `${base}.docx`; mimeType = DOCX_MIME; filename = downloadName(a, 'docx'); sizeBytes = filled.length;
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

module.exports = { generate, fillBuffer, missingFor, fillProfileXml, FACILITIES, DOC_TYPE };

// ponytail: self-check fills the real template with a sample profile — run
// `node services/farmProfileDoc.js`.
if (require.main === module) {
  const assert = require('assert');
  const template = path.join(__dirname, '..', 'forms', 'prescribed', 'farm-profile-farming.docx');
  const a = {
    firstName: 'Juan', lastName: 'Dela Cruz', dateOfBirth: '1985-03-12', ethnicOrigin: 'Bicolano',
    civilStatus: 'Married', homeAddress: '12 Rizal St', phone: '0917', email: 'j@x.ph',
    educationalAttainment: 'College Graduate', rsbsaNumber: 'RSBSA-1', completeAddress: 'Brgy. San Roque, Iriga',
    farmArea: 2500, applicationId: 'APP-1',
  };
  const p = {
    ownerType: 'individual', sex: 'Male',
    farm: { yearStartedFarming: '2010', yearsFarming: '15', businessPermit: 'BP-123', workersMale: '3', workersFemale: '2', workersTotal: '5' },
    membership: [{ organization: 'Iriga Coop', dateJoined: '2015', position: 'Member' }],
    trainings: [{ title: 'Organic Farming', dateAttended: '2018', sponsor: 'ATI' }],
    enterprise: [{ component: 'Rice', areaDevoted: '1ha', aveProduction: '5T', aveIncome: '100000' }],
    facilities: { toilet: true, washArea: true, plantNursery: true },
    machinery: [{ item: 'Hand tractor', quantity: '1' }],
  };
  const out = readZip(fillDocxBuffer(fs.readFileSync(template), a, p))
    .find((e) => e.name === 'word/document.xml').data.toString('utf8');
  for (const v of ['Name of Applicant: Juan Dela Cruz', 'Date of Birth: 1985-03-12',
    'Iriga Coop', 'Organic Farming', 'Rice', 'Hand tractor', 'BP-123']) {
    assert.ok(out.includes(v), `filled: ${v}`);
  }
  // Owner type + Sex + Civil status + 3 facilities = 6 ticked boxes, each an
  // underlined check-mark run.
  assert.strictEqual((out.match(/<w:t xml:space="preserve">✓/g) || []).length, 6, 'six boxes ticked');
  assert.ok(/<w:u w:val="single"\/><\/w:rPr><w:t xml:space="preserve">✓/.test(out), 'ticks sit in underlined runs');
  assert.ok(/Male\s*3/.test(out) || out.includes('Male 3'), 'workers male filled');
  assert.ok(!fs.readFileSync(template).includes(Buffer.from('Iriga Coop')), 'template unchanged');
  console.log('farmProfileDoc self-check passed');
}
