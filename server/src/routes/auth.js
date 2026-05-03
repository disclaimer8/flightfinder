const express = require('express');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const router = express.Router();
const authController = require('../controllers/authController');
const validate = require('../middleware/validate');
const requireAuth = require('../middleware/requireAuth');
const csrfOriginCheck = require('../middleware/csrf');

// Strict limiter — only for credential-accepting endpoints (brute-force surface).
// /login + /register accept arbitrary email/password attempts, so 10/15min/IP is
// the right ceiling. /me and /refresh are NOT here: those are auto-fired by the
// SPA on every mount/page-reload (refreshUser → /me; bootstrap → /refresh). A
// user navigating around the app can easily exceed 10 calls in 15min through
// nothing but normal browsing — when /me starts returning 429, the client treats
// it as "auth expired", clears tokenRef, and the user finds themselves staring
// at "Buy Pro" on a page they were already paying for. Then /login also rate-
// limits and they're locked out. We hit this in prod 2026-05-03.
const authStrictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many auth attempts, please try again later.' },
  skip: () => process.env.NODE_ENV === 'test',
});

// Looser limiter for endpoints the SPA fires automatically (on mount, on route
// change, after silent token refresh). 60/15min/IP is generous enough for a
// human browsing the app, while still cutting off a runaway client loop.
// /me and /refresh are independently auth-gated (Bearer token / httpOnly cookie
// + CSRF Origin check) so the rate-limit is purely abuse-mitigation, not a
// security primitive.
const authBackgroundLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests, please slow down.' },
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

// Credential-accepting endpoints — strict limiter.
router.post('/register', authStrictLimiter, validate.authBody.register, authController.register);
router.post('/login',    authStrictLimiter, validate.authBody.login,    authController.login);

// /refresh and /logout are the ONLY endpoints that read req.cookies (the
// httpOnly refresh-token). cookieParser is mounted route-scoped here —
// not globally in index.js — so the rest of the API can never accidentally
// rely on cookie-based auth (CSRF surface stays minimal). csrfOriginCheck
// then validates the Origin/Referer header against ALLOWED_ORIGINS as
// defense-in-depth on top of sameSite:strict on the cookie itself.
// These use the LOOSER limiter — see authBackgroundLimiter rationale above.
router.post('/refresh',  authBackgroundLimiter, cookieParser(), csrfOriginCheck, authController.refresh);
router.post('/logout',   authBackgroundLimiter, cookieParser(), csrfOriginCheck, authController.logout);

// /me is a read endpoint fired by every page mount; auth-gated by Bearer
// token via requireAuth, so the limit is abuse-only.
router.get('/me',        authBackgroundLimiter, requireAuth, authController.me);

module.exports = router;
