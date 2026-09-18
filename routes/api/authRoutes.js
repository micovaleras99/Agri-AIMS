const express = require('express');
const authController = require('../../controllers/authController');

const router = express.Router();

router.get('/farms-for-register', authController.farmsForRegister);
router.post('/logout', authController.logout);
router.post('/register', authController.register);
router.post('/login', authController.login);

// Email-OTP verification for registration
router.post('/verify-otp', authController.verifyRegistrationOtp);
router.post('/resend-otp', authController.resendOtp);

// Forgot password: request code → verify code → set new password
router.post('/forgot-password', authController.forgotPassword);
router.post('/verify-reset-otp', authController.verifyResetOtp);
router.post('/reset-password', authController.resetPassword);

module.exports = router;
