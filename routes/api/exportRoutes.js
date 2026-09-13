/**
 * RSC-07 — API-ready export of the accredited LSA registry.
 *
 * ATI publishes no public API for this. No such endpoint is invented here and
 * nothing is pushed anywhere: this exposes the registry in a stable shape that
 * a future ATI integration can POST as-is, and that staff can download today.
 * When an official endpoint exists, the only new code is the HTTP call — the
 * payload below is already the thing to send.
 */

const express = require('express');
const farmModel = require('../../models/farmModel');
const { ORGANIZATION } = require('../../config/organization');

const router = express.Router();

/** Versioned so a consumer can tell when the record shape changes. */
const SCHEMA = 'agri-aims.lsa-registry.v1';

/** One record per accredited Learning Site, in a shape meant to stay stable. */
function toRecord(f) {
  return {
    lsa_id: f.id,
    name: f.name,
    operator: f.operator,
    region: f.region,
    province: f.province,
    municipality: f.municipality,
    barangay_id: f.barangayId ?? null,
    classification: f.classification,
    lsa_type: f.lsaType,
    farm_area_sqm: f.farmArea,
    accredited_since: f.accreditedSince,
    expiry_date: f.expiryDate,
    status: f.status,
    latitude: f.latitude,
    longitude: f.longitude,
  };
}

/** RFC 4180: quote when needed, and double any embedded quote. */
function csvCell(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(records) {
  if (!records.length) return '';
  const cols = Object.keys(records[0]);
  return [cols.join(','), ...records.map((r) => cols.map((c) => csvCell(r[c])).join(','))].join('\r\n');
}

/**
 * XML escaping. Five characters, and getting them wrong is how a farm called
 * "Santos & Sons" produces a document no parser will read.
 */
function xmlText(v) {
  if (v === null || v === undefined) return '';
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * The same records as the JSON, as XML.
 *
 * The RSC asks for the registry to reach ATI Services "via xml or Json"; this
 * is the other half of that "or", so whichever the eventual endpoint accepts,
 * the payload already exists. Field names are identical across all three
 * formats on purpose — one record shape, three encodings.
 *
 * Hand-written rather than adding an XML dependency: the shape is flat, every
 * value goes through xmlText, and there is nothing here a library would do
 * better.
 */
function toXml(records, meta) {
  const lines = ['<?xml version="1.0" encoding="UTF-8"?>'];
  lines.push(`<lsa-registry schema="${xmlText(meta.schema)}" generated-at="${xmlText(meta.generatedAt)}" count="${records.length}">`);
  lines.push(`  <source>${xmlText(meta.source)}</source>`);
  for (const r of records) {
    lines.push('  <learning-site>');
    for (const [k, v] of Object.entries(r)) {
      // snake_case is not a legal-safe XML name everywhere; hyphens are the
      // usual convention and keep the JSON key recoverable.
      const tag = k.replace(/_/g, '-');
      lines.push(`    <${tag}>${xmlText(v)}</${tag}>`);
    }
    lines.push('  </learning-site>');
  }
  lines.push('</lsa-registry>');
  return lines.join('\n');
}

// GET /api/export/lsa-registry?format=json|csv|xml
router.get('/lsa-registry', async (req, res) => {
  if (!['admin'].includes(res.locals.role)) {
    return res.status(403).json({ success: false, error: 'Staff only.' });
  }

  const records = (await farmModel.findAll()).map(toRecord);

  const meta = {
    schema: SCHEMA,
    generatedAt: new Date().toISOString(),
    source: `${ORGANIZATION.officeShort} Agri-AIMS`,
  };

  if (req.query.format === 'csv') {
    res.type('text/csv').attachment('lsa-registry.csv').send(toCsv(records));
    return;
  }

  if (req.query.format === 'xml') {
    res.type('application/xml').attachment('lsa-registry.xml').send(toXml(records, meta));
    return;
  }

  res.json({
    success: true,
    schema: meta.schema,
    generated_at: meta.generatedAt,
    source: meta.source,
    count: records.length,
    data: records,
  });
});

module.exports = router;
// Reused by the staff-facing Registry Export page so the preview shows the exact
// record shape the download and any future ATI push will carry.
module.exports.toRecord = toRecord;
module.exports.SCHEMA = SCHEMA;
