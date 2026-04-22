'use strict';
const express = require('express');
const requireAuth = require('../middleware/requireAuth');
const requireTier = require('../middleware/entitlement');
const controller  = require('../controllers/pushController');

const router = express.Router();

// Public: browser needs the VAPID public key to subscribe.
router.get('/public-key', controller.publicKey);

// Gated: saving a push subscription is a Pro feature (alerts on saved trips).
router.post('/subscribe',   requireAuth, requireTier('pro'), controller.subscribe);
router.post('/unsubscribe', requireAuth, controller.unsubscribe);

module.exports = router;
