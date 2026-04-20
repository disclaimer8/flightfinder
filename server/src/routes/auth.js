const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const authController = require('../controllers/authController');
const validate = require('../middleware/validate');
const requireAuth = require('../middleware/requireAuth');
const csrfOriginCheck = require('../middleware/csrf');

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many auth attempts, please try again later.' },
  skip: () => process.env.NODE_ENV === 'test',
});

const verifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests, please try again later.' },
  skip: () => process.env.NODE_ENV === 'test',
});

// Email verification routes (separate, looser limiter)
router.get('/verify-email', verifyLimiter, authController.verifyEmail);
router.post('/resend-verification', verifyLimiter, authController.resendVerification);

// Auth routes
router.use(authLimiter);
router.post('/register', validate.authBody.register, authController.register);
router.post('/login',    validate.authBody.login,    authController.login);
// /refresh and /logout read the httpOnly refresh-token cookie. Guard them
// with an Origin/Referer check — CSRF token validation for CodeQL + real
// defense-in-depth on top of sameSite:strict.
router.post('/refresh',  csrfOriginCheck, authController.refresh);
router.post('/logout',   csrfOriginCheck, authController.logout);
router.get('/me',        requireAuth, authController.me);

module.exports = router;
