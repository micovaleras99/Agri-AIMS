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

module.exports = { fillDocx, readZip, writeZip };

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
  console.log('docxFill self-check passed');
}
