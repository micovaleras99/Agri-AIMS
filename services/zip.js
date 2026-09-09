/**
 * A minimal ZIP writer — STORE method (no compression).
 *
 * The central-office package bundles the validated documents into one .zip
 * (client §14). Those documents are already PDFs, JPGs and PNGs, which are
 * themselves compressed, so DEFLATE would buy nothing — STORE is correct and
 * lets this stay a few lines of the standard format instead of a dependency.
 *
 * buildZip([{ name, data }]) -> Buffer. Names are sanitised to a flat, safe
 * filename; duplicates get a numeric suffix so nothing is silently dropped.
 */

/** Standard CRC-32 (same polynomial ZIP uses). */
let CRC_TABLE = null;
function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = [];
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Keep a member name to a single safe path segment. */
function safeName(name) {
  return String(name).replace(/[\\/]+/g, '_').replace(/[^\w .()\-]+/g, '_').slice(0, 180) || 'file';
}

const DOS_DATE = 0x21; // 1980-01-01; a real date is not worth carrying here.

/**
 * @param {{name:string, data:Buffer}[]} entries
 * @returns {Buffer}
 */
function buildZip(entries) {
  const seen = new Map();
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const entry of entries) {
    let name = safeName(entry.name);
    if (seen.has(name)) {
      const n = seen.get(name) + 1;
      seen.set(name, n);
      const dot = name.lastIndexOf('.');
      name = dot > 0 ? `${name.slice(0, dot)} (${n})${name.slice(dot)}` : `${name} (${n})`;
    } else {
      seen.set(name, 0);
    }

    const nameBuf = Buffer.from(name, 'utf8');
    const data = entry.data;
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);      // version needed
    local.writeUInt16LE(0, 6);       // flags
    local.writeUInt16LE(0, 8);       // method: store
    local.writeUInt16LE(0, 10);      // mod time
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);      // extra len
    locals.push(local, nameBuf, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);    // version made by
    central.writeUInt16LE(20, 6);    // version needed
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);    // extra
    central.writeUInt16LE(0, 32);    // comment
    central.writeUInt16LE(0, 34);    // disk
    central.writeUInt16LE(0, 36);    // internal attrs
    central.writeUInt32LE(0, 38);    // external attrs
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);

    offset += local.length + nameBuf.length + data.length;
  }

  const centralBuf = Buffer.concat(centrals);
  const localBuf = Buffer.concat(locals);

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(localBuf.length, 16);   // central dir offset = end of local section
  end.writeUInt16LE(0, 20);

  return Buffer.concat([localBuf, centralBuf, end]);
}

module.exports = { buildZip, crc32, safeName };

// A store-only zip must round-trip through a real unzipper. Node's zlib cannot
// read the container, so this self-check verifies the structural invariants a
// decoder relies on: signatures, the entry count, and that the central-directory
// offset recorded in the EOCD actually lands on a central-directory signature.
if (require.main === module) {
  const assert = require('assert');
  const a = Buffer.from('hello world', 'utf8');
  const b = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 5]);
  const zip = buildZip([{ name: 'a/b?.txt', data: a }, { name: 'x.png', data: b }, { name: 'x.png', data: b }]);
  assert.strictEqual(zip.readUInt32LE(0), 0x04034b50, 'starts with a local header');
  const count = zip.readUInt16LE(zip.length - 12);
  assert.strictEqual(count, 3, 'three entries in the EOCD');
  const cdOffset = zip.readUInt32LE(zip.length - 6);
  assert.strictEqual(zip.readUInt32LE(cdOffset), 0x02014b50, 'EOCD offset points at the central directory');
  // The first stored file's bytes are present, uncompressed, right after its header+name.
  assert.ok(zip.includes(a), 'stored data is present verbatim');
  console.log('zip self-check passed');
}
