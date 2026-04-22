'use strict';

const express = require('express');
const requireAuth = require('../middleware/requireAuth');
const requireTier = require('../middleware/entitlement');
const controller  = require('../controllers/enrichmentController');

const router = express.Router();

// Teaser is public so the UI can render blurred placeholders for anyone.
router.get('/:id/enriched/teaser', controller.getTeaser);

// Full card is Pro-only.
router.get('/:id/enriched', requireAuth, requireTier('pro'), controller.getEnriched);

module.exports = router;
