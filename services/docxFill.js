/**
 * Pre-fill a .docx form for an applicant — without changing the stored template.
 *
 * The ATI forms lay their Basic Information out as a two-column table: a label
 * cell ("Name of Farm/ Agri-Processing Enterprise:") followed by an empty value
 * cell. This reads the template, injects the applicant's values into the empty
 * value cells of a COPY, and returns the copy. The file in forms/prescribed/ is
 * never touched, so an admin can still replace it freely, and a form with a
 * different layout simply comes back unfilled rather than corrupted.
 *
 * The zip is read and rewritten by hand (STORE method) so no dependency is
 * needed and every part except word/document.xml is preserved byte-for-byte —
 * Office opens a store-only OOXML package without complaint.
 */

const zlib = require('zlib');
const { crc32 } = require('./zip');

/** Read every entry of a zip into [{ name, data }], inflating as needed. */
function readZip(buf) {
  // Locate the End Of Central Directory record (its signature, scanning back).
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip: no end-of-central-directory');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16); // central directory offset

  const entries = [];
  for (let n = 0; n < count; n += 1) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('bad central directory header');
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);

    // Jump to the local header to find where this entry's data actually starts.
    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const dataStart = localOff + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(dataStart, dataStart + compSize);
    const data = method === 8 ? zlib.inflateRawSync(raw) : Buffer.from(raw);

    entries.push({ name, data });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** Rewrite entries as a STORE-only zip, preserving names exactly. */
function writeZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 8);          // method: store
    local.writeUInt16LE(0x21, 12);      // date
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + data.length;
  }
  const localBuf = Buffer.concat(locals);
  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(localBuf.length, 16);
  return Buffer.concat([localBuf, centralBuf, end]);
}

function xmlEscape(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Put `value` into the empty value cell that follows the first label matching
 * `labelStartsWith`. Returns the edited xml, or the xml unchanged if the label
 * or a following value cell/paragraph is not found (so an unexpected layout is
 * a no-op, never a corruption).
 */
function fillValueCell(xml, labelStartsWith, value) {
  // Find the label inside a <w:t> run.
  const re = new RegExp(`<w:t[^>]*>${escapeRe(labelStartsWith)}`);
  const m = re.exec(xml);
  if (!m) return xml;
  // The label lives in one table cell; its value is the next cell. Move past
  // the label cell, then inject a run just before that value paragraph closes.
  const afterLabelCell = xml.indexOf('</w:tc>', m.index);
  if (afterLabelCell < 0) return xml;
  const pEnd = xml.indexOf('</w:p>', afterLabelCell);
  if (pEnd < 0) return xml;
  const run = `<w:r><w:t xml:space="preserve">${xmlEscape(value)}</w:t></w:r>`;
  return xml.slice(0, pEnd) + run + xml.slice(pEnd);
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * @param {Buffer} templateBuf  the raw .docx
 * @param {{label:string, value:string}[]} fields  label prefix -> value
 * @returns {Buffer} a filled copy
 */
function fillDocx(templateBuf, fields) {
  const entries = readZip(templateBuf);
  const doc = entries.find((e) => e.name === 'word/document.xml');
  if (!doc) return templateBuf; // not a Word doc we understand; hand back as-is
  let xml = doc.data.toString('utf8');
  for (const { label, value } of fields) {
    if (value) xml = fillValueCell(xml, label, value);
  }
  doc.data = Buffer.from(xml, 'utf8');
  return writeZip(entries);
}

/**
 * Anchor that separates the Farming section from the Agri-Processing one. The
 * "For Agri-Processing LSA" heading itself is split across runs and not
 * searchable, but this phrase from the Agri section's first group heading ("The
 * agri-processing enterprise can be any of the following:") is contiguous,
 * unique, and sits before any Agri checklist row — so everything before it is
 * Farming, everything after is Agri-Processing.
 */
const AGRI_HEADING = 'enterprise can be any';

/**
 * Write `mark` into the "Write (/) or (x)" cell (the 4th of the row's five cells)
 * of the checklist row whose Qualifications text starts with `locate`, searching
 * only within [start, end). Returns the xml unchanged if the row, or a 4th cell
 * in it, is not found — so an unexpected layout is a no-op, never a corruption.
 */
function markCheckCell(xml, start, end, locate, mark) {
  const idx = xml.indexOf(locate, start);
  if (idx < 0 || idx >= end) return xml;
  const trStart = xml.lastIndexOf('<w:tr', idx);
  const trEnd = xml.indexOf('</w:tr>', idx);
  if (trStart < 0 || trEnd < 0) return xml;
  // Walk to the 4th <w:tc> in this row — the check column.
  let pos = trStart;
  for (let n = 0; n < 4; n += 1) {
    pos = xml.indexOf('<w:tc>', pos + 1);
    if (pos < 0 || pos > trEnd) return xml; // fewer than four cells: not a checklist row
  }
  const cellEnd = xml.indexOf('</w:tc>', pos);
  if (cellEnd < 0 || cellEnd > trEnd) return xml;
  // Inject the mark just before the cell's last paragraph closes.
  const pEnd = xml.lastIndexOf('</w:p>', cellEnd);
  if (pEnd < 0 || pEnd < pos) return xml;
  const run = `<w:r><w:t xml:space="preserve">${xmlEscape(mark)}</w:t></w:r>`;
  return xml.slice(0, pEnd) + run + xml.slice(pEnd);
}

/**
 * Populate the Self-Assessment DOCX: Basic Information label/value cells, plus a
 * "/" or "x" in each checklist row's check column, scoped to the correct section.
 * The master is never modified — a filled STORE-zip copy is returned.
 *
 * @param {Buffer} templateBuf  the raw master .docx
 * @param {{ basicInfo: {label:string,value:string}[],
 *           marks: {section:'farming'|'agri', locate:string, mark:string}[] }} data
 * @returns {Buffer} a filled copy
 */
function fillSelfAssessment(templateBuf, { basicInfo = [], marks = [] }) {
  const entries = readZip(templateBuf);
  const doc = entries.find((e) => e.name === 'word/document.xml');
  if (!doc) return templateBuf;
  let xml = doc.data.toString('utf8');

  for (const { label, value } of basicInfo) {
    if (value) xml = fillValueCell(xml, label, value);
  }
  for (const { section, locate, mark } of marks) {
    if (!mark) continue;
    // Recompute the split each time: earlier injections shift later offsets.
    const split = xml.indexOf(AGRI_HEADING);
    const start = section === 'agri' ? (split >= 0 ? split : 0) : 0;
    const end = section === 'agri' ? xml.length : (split >= 0 ? split : xml.length);
    xml = markCheckCell(xml, start, end, locate, mark);
  }

  doc.data = Buffer.from(xml, 'utf8');
  return writeZip(entries);
}

/** [start, end) of the region between fromText and toText (whole doc if empty). */
function rangeOf(xml, fromText, toText) {
  const start = fromText ? xml.indexOf(fromText) : 0;
  if (start < 0) return null;
  let end = toText ? xml.indexOf(toText, start) : xml.length;
  if (end < 0) end = xml.length;
  return [start, end];
}

/**
 * Fill an inline "Label: ______" run (the Development Plan and the Farm Profile
 * lay many fields out this way, not as label/value cells). Rewrites the first
 * <w:t> run that starts with `label` to "label: value". Optionally scoped to the
 * region between fromText and toText so a label repeated in another section is
 * left alone.
 */
function fillInlineLabel(xml, label, value, fromText = '', toText = '') {
  if (!value) return xml;
  const r = rangeOf(xml, fromText, toText);
  if (!r) return xml;
  const [start, end] = r;
  const region = xml.slice(start, end);
  const re = new RegExp(`(<w:t[^>]*>)${escapeRe(label)}[^<]*(</w:t>)`);
  const replaced = region.replace(re, (m, open, close) => `${open}${xmlEscape(label)}: ${xmlEscape(value)}${close}`);
  if (replaced === region) return xml;
  return xml.slice(0, start) + replaced + xml.slice(end);
}

/**
 * Insert a new paragraph carrying `value` right after the paragraph that
 * contains `afterText` — used to drop the applicant's Rationale / Objectives
 * narrative under its heading. Newlines become line breaks.
 */
function insertParagraphAfter(xml, afterText, value) {
  if (!value) return xml;
  const i = xml.indexOf(afterText);
  if (i < 0) return xml;
  const pEnd = xml.indexOf('</w:p>', i);
  if (pEnd < 0) return xml;
  const at = pEnd + '</w:p>'.length;
  const runs = String(value).split(/\r?\n/)
    .map((line, idx) => `${idx ? '<w:br/>' : ''}<w:t xml:space="preserve">${xmlEscape(line)}</w:t>`)
    .join('');
  const para = `<w:p><w:r>${runs}</w:r></w:p>`;
  return xml.slice(0, at) + para + xml.slice(at);
}

/**
 * Remove the whole paragraph that contains `matchText` — used to drop a form's
 * placeholder/instruction line (e.g. the red "*Short description of the Farm…")
 * once the applicant has supplied real content. No-op if not found.
 */
function removeParagraphContaining(xml, matchText) {
  const i = xml.indexOf(matchText);
  if (i < 0) return xml;
  const pStart = Math.max(xml.lastIndexOf('<w:p>', i), xml.lastIndexOf('<w:p ', i));
  const pEnd = xml.indexOf('</w:p>', i);
  if (pStart < 0 || pEnd < 0) return xml;
  return xml.slice(0, pStart) + xml.slice(pEnd + '</w:p>'.length);
}

/** Inject a value into each cell of a table row, in order (skips empty values). */
function fillRowCells(rowXml, values) {
  let idx = 0;
  return rowXml.replace(/<w:tc>[\s\S]*?<\/w:tc>/g, (cell) => {
    const v = values[idx];
    idx += 1;
    if (v === undefined || v === null || v === '') return cell;
    const pEnd = cell.lastIndexOf('</w:p>');
    if (pEnd < 0) return cell;
    const run = `<w:r><w:t xml:space="preserve">${xmlEscape(String(v))}</w:t></w:r>`;
    return cell.slice(0, pEnd) + run + cell.slice(pEnd);
  });
}

/**
 * Replace the empty data rows of the table containing `anchor` (a header-cell
 * text) with one filled row per entry in `rows`. The header row is kept, its
 * first empty data row is used as the cell template, and any spare empty rows are
 * dropped. Returns the xml unchanged if the table or a data row is not found.
 *
 * @param {string} xml
 * @param {string} anchor  text in the table's header row
 * @param {Array<Array<string>>} rows  values per column, per row
 */
function appendTableRows(xml, anchor, rows) {
  if (!rows || !rows.length) return xml;
  const i = xml.indexOf(anchor);
  if (i < 0) return xml;
  const tblStart = xml.lastIndexOf('<w:tbl>', i);
  const tblEnd = xml.indexOf('</w:tbl>', i);
  if (tblStart < 0 || tblEnd < 0) return xml;
  const tbl = xml.slice(tblStart, tblEnd);
  const trs = tbl.match(/<w:tr[\s\S]*?<\/w:tr>/g) || [];
  if (trs.length < 2) return xml;
  const header = trs[0];
  const template = trs[1]; // first empty data row = cell template
  const filled = rows.map((r) => fillRowCells(template, r)).join('');
  const afterHeader = tbl.indexOf(header) + header.length;
  const lastTrEnd = tbl.lastIndexOf('</w:tr>') + '</w:tr>'.length;
  const newTbl = tbl.slice(0, afterHeader) + filled + tbl.slice(lastTrEnd);
  return xml.slice(0, tblStart) + newTbl + xml.slice(tblEnd);
}

/**
 * Tick an inline checkbox written as "____ Label" (the Farm Profile's Sex, Civil
 * Status, Owner type and facility lists are laid out this way). Replaces the
 * blank immediately before the first matching `label` with `mark`. Optionally
 * scoped to [start, end) so the same label in another section is left alone.
 */
// Plain check mark; the line it sits on comes from a Word underline run built in
// markInlineCheckbox, not from the character itself.
const CHECK_MARK = '✓';

/**
 * Tick an inline checkbox written as "____ Label" by turning the box's blank into
 * three runs: the run text before the blank, an UNDERLINED run holding the check
 * mark plus spaces spanning the blank's width (Word draws the underline as the
 * form's line, with the tick sitting on it), then the label in the original run's
 * formatting. Optionally scoped to the region between fromText and toText.
 */
function markInlineCheckbox(xml, label, mark = CHECK_MARK, fromText = '', toText = '') {
  const r = rangeOf(xml, fromText, toText);
  if (!r) return xml;
  const [start, end] = r;
  const region = xml.slice(start, end);

  // Find the <w:t> run text that holds "____ Label" (bounded to one <w:t> by the
  // [^<] classes, so it never spans runs).
  const tRe = new RegExp(`<w:t\\b[^>]*>([^<]*?)(_+)(\\s*${escapeRe(label)}[^<]*)</w:t>`);
  const m = tRe.exec(region);
  if (!m) return xml;
  const [prefix, blank, rest] = [m[1], m[2], m[3]];
  const tStart = m.index;
  const tEnd = tStart + m[0].length;

  // Its enclosing run: the nearest <w:r> before the <w:t>, and </w:r> after it.
  const rOpen = Math.max(region.lastIndexOf('<w:r>', tStart), region.lastIndexOf('<w:r ', tStart));
  const rClose = region.indexOf('</w:r>', tEnd);
  if (rOpen < 0 || rClose < 0) return xml;
  const runOpenTag = region.slice(rOpen, region.indexOf('>', rOpen) + 1);
  const between = region.slice(rOpen + runOpenTag.length, tStart);
  const rprMatch = between.match(/<w:rPr>[\s\S]*?<\/w:rPr>/);
  const baseRpr = rprMatch ? rprMatch[0] : '';
  const uRpr = baseRpr
    ? baseRpr.replace('</w:rPr>', '<w:u w:val="single"/></w:rPr>')
    : '<w:rPr><w:u w:val="single"/></w:rPr>';

  // Rebuild the one run as: prefix (same formatting) · underlined check+blank · label.
  const spanned = xmlEscape(mark) + ' '.repeat(Math.max(2, blank.length - 1));
  const prefixRun = prefix ? `${runOpenTag}${baseRpr}<w:t xml:space="preserve">${prefix}</w:t></w:r>` : '';
  const checkRun = `<w:r>${uRpr}<w:t xml:space="preserve">${spanned}</w:t></w:r>`;
  const restRun = `${runOpenTag}${baseRpr}<w:t xml:space="preserve">${rest}</w:t></w:r>`;
  const rebuilt = prefixRun + checkRun + restRun;

  const newRegion = region.slice(0, rOpen) + rebuilt + region.slice(rClose + '</w:r>'.length);
  return xml.slice(0, start) + newRegion + xml.slice(end);
}

/**
 * Fill the blank ("____") that comes immediately AFTER `label` with `value`,
 * within [start, end). Used for the Farm Profile's inline fields that share a
 * cell ("Year started Farming: ____ No. of Years in Farming: ____") and its
 * worker counts ("Male ____ Female ____"), where replacing the whole run would
 * wipe the neighbouring fields.
 */
function fillBlankAfter(xml, label, value, fromText = '', toText = '') {
  if (!value) return xml;
  const r = rangeOf(xml, fromText, toText);
  if (!r) return xml;
  const [start, end] = r;
  const region = xml.slice(start, end);
  const re = new RegExp(`(${escapeRe(label)}\\s*)_+`);
  const replaced = region.replace(re, (m, pre) => pre + xmlEscape(value));
  if (replaced === region) return xml;
  return xml.slice(0, start) + replaced + xml.slice(end);
}

/**
 * fillValueCell, but restricted to the document region between `fromText` and
 * `toText`. Lets a label that appears in more than one section (e.g. "Cellphone
 * No." in both the individual and the organization blocks) be filled in the
 * right one.
 */
function fillValueCellScoped(xml, label, value, fromText, toText) {
  if (!value) return xml;
  const start = fromText ? xml.indexOf(fromText) : 0;
  if (start < 0) return xml;
  let end = toText ? xml.indexOf(toText, start) : xml.length;
  if (end < 0) end = xml.length;
  return xml.slice(0, start) + fillValueCell(xml.slice(start, end), label, value) + xml.slice(end);
}

module.exports = {
  fillDocx, fillSelfAssessment, markCheckCell,
  fillInlineLabel, insertParagraphAfter, appendTableRows,
  markInlineCheckbox, fillValueCellScoped, fillValueCell, fillBlankAfter,
  removeParagraphContaining, CHECK_MARK, readZip, writeZip,
};

// Round-trip check: a real .docx read, filled, rewritten, and re-read must keep
// every part and carry the injected value in document.xml.
if (require.main === module) {
  const assert = require('assert');
  const fs = require('fs');
  const path = require('path');
  const src = path.join(__dirname, '..', 'forms', 'prescribed', 'self-assessment.docx');
  const buf = fs.readFileSync(src);
  const before = readZip(buf);
  const filled = fillDocx(buf, [
    { label: 'Name of Farm', value: 'Round Trip Test Farm' },
    { label: 'Name of Owner', value: 'Iñigo Muñoz' },
  ]);
  const after = readZip(filled);
  assert.strictEqual(after.length, before.length, 'no part is lost');
  assert.ok(after.find((e) => e.name === 'word/document.xml'), 'document.xml survives');
  assert.ok(after.find((e) => e.name === '[Content_Types].xml'), 'content types survive with exact name');
  const xml = after.find((e) => e.name === 'word/document.xml').data.toString('utf8');
  assert.ok(xml.includes('Round Trip Test Farm'), 'the farm name was injected');
  assert.ok(xml.includes('Iñigo Muñoz'), 'the owner name was injected, unicode intact');
  // The stored template on disk is untouched.
  assert.ok(!fs.readFileSync(src).includes(Buffer.from('Round Trip Test Farm')), 'template unchanged');

  // fillSelfAssessment: basic info + section-scoped check marks.
  const sa = fillSelfAssessment(buf, {
    basicInfo: [{ label: 'Name of Farm', value: 'Section Test Farm' }],
    marks: [
      { section: 'farming', locate: 'Holding Area', mark: '/' },
      { section: 'agri', locate: 'Toilet', mark: 'x' },
    ],
  });
  const saXml = readZip(sa).find((e) => e.name === 'word/document.xml').data.toString('utf8');
  const split = saXml.indexOf('enterprise can be any');
  assert.ok(split > 0, 'the two sections are present');
  // Exactly one "/" mark and one "x" mark were injected (as our run shape).
  const slash = saXml.indexOf('<w:t xml:space="preserve">/</w:t>');
  const ex = saXml.indexOf('<w:t xml:space="preserve">x</w:t>');
  assert.ok(slash > 0 && saXml.indexOf('<w:t xml:space="preserve">/</w:t>', slash + 1) < 0, 'one slash mark');
  assert.ok(ex > 0 && saXml.indexOf('<w:t xml:space="preserve">x</w:t>', ex + 1) < 0, 'one x mark');
  // Scoping: farming mark is before the Agri heading, agri mark is after it.
  assert.ok(slash < split, 'farming Holding Area mark landed in the Farming section');
  assert.ok(ex > split, 'agri Toilet mark landed in the Agri-Processing section');
  assert.strictEqual(readZip(sa).length, before.length, 'no part lost in fillSelfAssessment');
  assert.ok(!fs.readFileSync(src).includes(Buffer.from('Section Test Farm')), 'template still unchanged');

  // Development Plan techniques: inline label, table rows, narrative paragraph.
  const dpSrc = path.join(__dirname, '..', 'forms', 'prescribed', 'lsa-development-plan.docx');
  let dp = readZip(fs.readFileSync(dpSrc)).find((e) => e.name === 'word/document.xml').data.toString('utf8');
  dp = fillInlineLabel(dp, 'Name of LSA', 'Sunrise LSA');
  assert.ok(dp.includes('Name of LSA: Sunrise LSA'), 'inline label filled');
  dp = insertParagraphAfter(dp, 'Rationale/Background', 'A model integrated farm.');
  assert.ok(dp.includes('A model integrated farm.'), 'rationale paragraph inserted');
  dp = appendTableRows(dp, 'Development Plan Component', [
    ['Expand TDA', 'Q1 2027', 'Bigger demo area', 'ATI', '50,000'],
    ['Buy tools', 'Q2 2027', 'Farm tools', 'DA', '20,000'],
  ]);
  for (const v of ['Expand TDA', 'Bigger demo area', 'Buy tools', 'Farm tools', '50,000']) {
    assert.ok(dp.includes(v), `work plan row value present: ${v}`);
  }
  dp = appendTableRows(dp, 'Description/Specifications', [['Hand tractor', '1', '80,000', '80,000']]);
  assert.ok(dp.includes('Hand tractor'), 'budget row value present');
  assert.ok(!fs.readFileSync(dpSrc).includes(Buffer.from('Sunrise LSA')), 'dev-plan template unchanged');

  // Farm Profile techniques: inline checkbox + section-scoped value cell.
  const fpSrc = path.join(__dirname, '..', 'forms', 'prescribed', 'farm-profile-farming.docx');
  let fp = readZip(fs.readFileSync(fpSrc)).find((e) => e.name === 'word/document.xml').data.toString('utf8');
  fp = markInlineCheckbox(fp, 'Male');
  fp = markInlineCheckbox(fp, 'Married');
  fp = markInlineCheckbox(fp, 'Toilet');
  assert.strictEqual((fp.match(/<w:t xml:space="preserve">✓/g) || []).length, 3, 'three boxes ticked');
  assert.ok(/<w:u w:val="single"\/><\/w:rPr><w:t xml:space="preserve">✓/.test(fp), 'the tick sits in an underlined run');
  // Scoped fill: fill "Cellphone No" only in the organization block (A.2).
  fp = fillValueCellScoped(fp, 'Name of Organization', 'Iriga Farmers Coop',
    'A.2 For Private Organization', 'Membership in Organization');
  assert.ok(fp.includes('Iriga Farmers Coop'), 'scoped org field filled');
  assert.ok(!fs.readFileSync(fpSrc).includes(Buffer.from('Iriga Farmers Coop')), 'farm-profile template unchanged');

  console.log('docxFill self-check passed');
}
