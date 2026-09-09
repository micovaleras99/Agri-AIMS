/**
 * RSC-07 — staff-facing LSA Registry Export page.
 *
 * The export itself lives at GET /api/export/lsa-registry (JSON/CSV/XML). This
 * page is the human front door to it: preview the exact records, download any
 * format, and copy the endpoint + schema an ATI integration would consume. No
 * data is pushed anywhere — that waits on an official ATI endpoint.
 */

const express = require('express');
const farmModel = require('../models/farmModel');
const { ORGANIZATION } = require('../config/organization');
const { toRecord, SCHEMA } = require('./api/exportRoutes');

const router = express.Router();

const STAFF = ['admin', 'evaluator'];

router.get('/', async (req, res) => {
  if (!STAFF.includes(res.locals.role)) {
    return res.status(403).render('pages/error', {
      title: 'Access Denied', code: 403,
      message: 'The LSA registry export is available to ATI staff.',
    });
  }

  const records = (await farmModel.findAll()).map(toRecord);
  const endpoint = `${req.protocol}://${req.get('host')}/api/export/lsa-registry`;

  res.render('pages/registry', {
    title: 'LSA Registry Export — Agri-AIMS',
    page: 'registry',
    records,
    fields: records.length ? Object.keys(records[0]) : Object.keys(toRecord({})),
    schema: SCHEMA,
    source: `${ORGANIZATION.officeShort} Agri-AIMS`,
    endpoint,
    generatedAt: new Date().toISOString(),
  });
});

module.exports = router;
