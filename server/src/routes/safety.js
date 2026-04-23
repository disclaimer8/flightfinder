'use strict';

const express     = require('express');
const router      = express.Router();
const requireAuth = require('../middleware/requireAuth');
const requireTier = require('../middleware/entitlement');
const validate    = require('../middleware/validate');
const controller  = require('../controllers/safetyController');
const authService = require('../services/authService');
const { db } = require('../models/db');

const getUserTierCols = db.prepare(
  'SELECT subscription_tier, sub_valid_until FROM users WHERE id = ?',
);

/**
 * If a valid Bearer token is present, attach req.user (with id, email, tier,
 * sub_valid_until). If no header or the token is missing/invalid/expired, call
 * next() anonymously (req.user stays unset). Never writes to res. Downstream
 * handlers should treat missing req.user as "free tier".
 */
function optionalAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return next();
  const token = header.slice(7);
  try {
    const payload = authService.verifyAccessToken(token);
    const tierRow = getUserTierCols.get(payload.sub) || {};
    req.user = {
      id: payload.sub,
      email: payload.email,
      subscription_tier: tierRow.subscription_tier || 'free',
      sub_valid_until:   tierRow.sub_valid_until || null,
    };
  } catch {
    // Invalid / expired token → treat as anonymous. No res.status(401).
  }
  next();
}

// Free, public — feed
router.get('/events',          validate.safetyEventsQuery,     controller.listEvents);
router.get('/events/:id',      validate.safetyEventIdParam,    controller.getEvent);

// Free counts; Pro adds breakdowns. optionalAuth lets isPro() branch.
router.get('/operators/:code', validate.safetyOperatorParam,   optionalAuth, controller.getOperator);

// Pro-only — full per-tail history
router.get('/aircraft/:reg',   requireAuth, requireTier('pro'),
                               validate.safetyRegistrationParam, controller.getAircraft);

module.exports = router;
