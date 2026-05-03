const express = require('express');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
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

// Admin utility — only active when ADMIN_TOKEN env var is set. See authController.adminVerifyEmail.
router.post('/admin/verify-email', express.json(), authController.adminVerifyEmail);

// Auth routes
router.use(authLimiter);
router.post('/register', validate.authBody.register, authController.register);
router.post('/login',    validate.authBody.login,    authController.login);
// /refresh and /logout are the ONLY endpoints that read req.cookies (the
// httpOnly refresh-token). cookieParser is mounted route-scoped here —
// not globally in index.js — so the rest of the API can never accidentally
// rely on cookie-based auth (CSRF surface stays minimal). csrfOriginCheck
// then validates the Origin/Referer header against ALLOWED_ORIGINS as
// defense-in-depth on top of sameSite:strict on the cookie itself.
router.post('/refresh',  cookieParser(), csrfOriginCheck, authController.refresh);
router.post('/logout',   cookieParser(), csrfOriginCheck, authController.logout);
router.get('/me',        requireAuth, authController.me);

module.exports = router;
