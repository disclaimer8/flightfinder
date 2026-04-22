'use strict';

const express = require('express');
const requireAuth  = require('../middleware/requireAuth');
const controller   = require('../controllers/subscriptionController');

const router = express.Router();

// Checkout + portal require auth.
router.post('/checkout', requireAuth, controller.createCheckout);
router.get('/portal',    requireAuth, controller.createPortal);

// Public: lifetime remaining counter for pricing page (cached client-side).
router.get('/lifetime-status', controller.getLifetimeStatus);

// Webhook: NO auth, body must be raw — wired in index.js BEFORE json middleware.
router.post('/webhook', controller.handleWebhook);

module.exports = router;
