// ============================================================
// routes/index.js — Landing Page & Auth Routes
// ============================================================

const express = require('express');
const classifications = require('../config/classifications');
const router  = express.Router();
const { clearAuthCookie } = require('../utils/cookies');
const { roleSwitchAllowed } = require('../middleware/roleContext');

// GET / — Landing / Login Page
router.get('/', (req, res) => {
    res.render('pages/index', {
        title: 'Agri-AIMS — Login',
        page:  'login',
        // The same lists the staff edit form offers. Registration used to ask
        // for none of this and the record was created on assumed defaults.
        classificationOptions: {
            farming: classifications.farming().map((c) => ({ key: c.key, label: c.label })),
            processing: classifications.processing().map((c) => ({ key: c.key, label: c.label })),
        },
        // Demo credentials are a local development convenience, never a public one.
        demoLogin: roleSwitchAllowed()
    });
});

// GET /logout — clear the session cookie and return to the login page
router.get('/logout', (req, res) => {
    clearAuthCookie(res);
    res.redirect('/');
});

module.exports = router;
