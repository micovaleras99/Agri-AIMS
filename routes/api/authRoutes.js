const express = require('express');
const authController = require('../../controllers/authController');

const router = express.Router();

router.get('/farms-for-register', authController.farmsForRegister);
router.post('/logout', authController.logout);
router.post('/register', authController.register);
router.post('/login', authController.login);

module.exports = router;
