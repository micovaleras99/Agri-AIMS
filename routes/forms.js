/**
 * Prescribed-form downloads, optionally pre-filled for an applicant.
 *
 * GET /forms/:type sends the blank official form. When the form is one we can
 * pre-fill and an applicant is in context — the signed-in applicant, or staff
 * viewing ?applicant=<id> — the applicant's Basic Information is injected into a
 * COPY of the form and that copy is sent. The stored template in
 * forms/prescribed/ is never modified, so an admin can still replace it freely
 * and a form with an unexpected layout simply comes back blank, never broken.
 *
 * Blank templates are not private, but the folder is still not served by
 * express.static: `:type` must resolve through the config allowlist, which is
 * what keeps "../../.env" out.
 *
 * Mounted under requireAuthPage in app.js.
 */

const fs = require('fs');
const path = require('path');
const express = require('express');
const { resolvePrescribed } = require('../config/prescribedForms');
const { fillDocx } = require('../services/docxFill');
const applicantModel = require('../models/applicantModel');
const farmModel = require('../models/farmModel');

const router = express.Router();

const CONTENT_TYPES = {
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

/**
 * Which forms can be pre-filled, and the Basic Information each takes. The label
 * is matched as the start of a cell in the form's table, so it need not be the
 * full label text. A value that is empty is skipped, leaving that blank blank.
 */
const FILLABLE = {
  self_assessment: (a) => [
    { label: 'Name of Farm', value: a.farmName },
    { label: 'Name of Owner', value: `${a.firstName || ''} ${a.lastName || ''}`.trim() },
    { label: 'Address', value: a.farmAddress || [a.municipality, a.province].filter(Boolean).join(', ') },
  ],
};

/** The applicant whose data should fill the form, or null to send it blank. */
async function targetApplicant(req) {
  const { role, currentUser } = req.res.locals;
  if (role === 'applicant' && currentUser.applicationId) {
    return applicantModel.findByApplicationId(currentUser.applicationId);
  }
  if (role === 'operator' && currentUser.farmId) {
    const id = await farmModel.getApplicantIdForFarm(currentUser.farmId);
    return id ? applicantModel.findById(id) : null;
  }
  if (['admin', 'evaluator'].includes(role) && req.query.applicant) {
    return applicantModel.findById(parseInt(req.query.applicant, 10));
  }
  return null;
}

router.get('/:type', async (req, res) => {
  const applicant = await targetApplicant(req).catch(() => null);
  const abs = resolvePrescribed(req.params.type, applicant || res.locals.currentUser || {});
  if (!abs) {
    return res.status(404).render('pages/error', {
      title: 'Not Found', code: 404, message: 'No prescribed form is available for that requirement.',
    });
  }
  const ext = path.extname(abs).toLowerCase();

  const spec = FILLABLE[req.params.type];
  if (spec && applicant && ext === '.docx') {
    const filled = fillDocx(fs.readFileSync(abs), spec(applicant));
    res.type(CONTENT_TYPES['.docx']);
    res.setHeader('Content-Disposition', `attachment; filename="${path.basename(abs)}"`);
    return res.send(filled);
  }

  res.type(CONTENT_TYPES[ext] || 'application/octet-stream');
  return res.download(abs, path.basename(abs));
});

module.exports = router;
