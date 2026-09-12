/**
 * The signed-in user's own account page.
 *
 * The account fields and the password are written through PUT /api/users/:id,
 * which already carries the permission rules (a non-admin cannot change their
 * own role or farm linkage) and the password rules. A second copy of that
 * logic behind a form POST would be a second place for the two to drift apart.
 *
 * The profile picture is handled here rather than there, because it arrives as
 * multipart/form-data and needs the file written and the old one deleted —
 * neither of which belongs in a JSON endpoint.
 */

const express = require('express');
const userModel = require('../models/userModel');
const applicantModel = require('../models/applicantModel');
const farmModel = require('../models/farmModel');
const { avatarUpload, resolveStored, removeStored, AVATAR_MAX_BYTES } = require('../config/upload');
const { requireCsrfAfterUpload } = require('../middleware/csrf');

const router = express.Router();

/**
 * The applicant record behind the signed-in user, if any. An applicant is linked
 * by application id; an operator (already accredited) by their farm. Admin/staff
 * have no applicant record and so no personal-details section.
 */
async function applicantForUser(user) {
  if (!user) return null;
  if (user.applicationId) return applicantModel.findByApplicationId(user.applicationId);
  if (user.farmId) {
    const id = await farmModel.getApplicantIdForFarm(user.farmId);
    return id ? applicantModel.findById(id) : null;
  }
  return null;
}

router.get('/', async (req, res) => {
  const applicant = await applicantForUser(res.locals.currentUser).catch(() => null);
  res.render('pages/profile', {
    title: 'My Profile — Agri-AIMS',
    page: 'profile',
    maxPhotoMb: Math.round(AVATAR_MAX_BYTES / 1024 / 1024),
    applicant,
    personalSaved: req.query.success === 'personal',
  });
});

/**
 * Save the personal details used by the Farm/Agri-Enterprise Profile form.
 * These live on the applicant record, so a user with no applicant record cannot
 * reach this (the form is not shown to them).
 */
router.post('/personal', async (req, res) => {
  const applicant = await applicantForUser(res.locals.currentUser).catch(() => null);
  if (!applicant) return res.redirect('/profile');
  await applicantModel.patch(applicant.id, {
    dateOfBirth: req.body.dateOfBirth || null,
    civilStatus: (req.body.civilStatus || '').trim(),
    ethnicOrigin: (req.body.ethnicOrigin || '').trim(),
    educationalAttainment: (req.body.educationalAttainment || '').trim(),
    homeAddress: (req.body.homeAddress || '').trim(),
  });
  res.redirect('/profile?success=personal');
});

/**
 * Uploads a new profile picture.
 *
 * Multer has already written the file under a random name by the time this
 * runs, so a rejected upload is a matter of not recording it — there is
 * nothing half-written in the database either way.
 */
router.post('/photo', avatarUpload.single('photo'), requireCsrfAfterUpload, async (req, res) => {
  const user = res.locals.currentUser;
  if (req.uploadRejected === 'type') return res.redirect('/profile?error=phototype');
  if (!req.file) return res.redirect('/profile?error=nophoto');

  // The previous picture is deleted only after the new name is stored: if the
  // update throws, the account still points at a file that exists.
  const previous = user.photo;
  await userModel.updatePhoto(user.id, req.file.filename);
  if (previous && previous !== req.file.filename) removeStored(previous);

  res.redirect('/profile?success=photo');
});

/** Removes the picture and goes back to the initials. */
router.post('/photo/remove', async (req, res) => {
  const user = res.locals.currentUser;
  await userModel.updatePhoto(user.id, null);
  if (user.photo) removeStored(user.photo);
  res.redirect('/profile?success=photoremoved');
});

/**
 * Serves a profile picture.
 *
 * uploads/ is not served statically — accreditation documents live in the same
 * directory and are private. This route is the only way out for a picture, and
 * it will only ever emit a filename that is actually recorded as some user's
 * photo, so it cannot be turned into a reader for the documents beside it.
 *
 * Any signed-in user may fetch any other user's picture: they already see the
 * face in the community chat, which is what a profile picture is for.
 */
router.get('/photo/:id', async (req, res) => {
  const user = await userModel.findById(parseInt(req.params.id, 10));
  const abs = user && resolveStored(user.photo);
  if (!abs) return res.status(404).end();
  // The filename changes on every upload, so a cached copy can never be stale.
  res.set('Cache-Control', 'private, max-age=86400');
  res.sendFile(abs, (err) => { if (err && !res.headersSent) res.status(404).end(); });
});

module.exports = router;
