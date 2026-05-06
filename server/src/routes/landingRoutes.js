'use strict';
/**
 * Aircraft × Route programmatic landing pages API.
 *
 * GET /api/routes/:pair/aircraft/:slug  — main detail endpoint
 * GET /api/routes/:pair/aircraft-list   — sibling discovery for cross-linking
 */
const express = require('express');
const router = express.Router();
const aircraftRouteSvc = require('../services/aircraftRouteService');

// Aircraft × Route programmatic landing — main detail
router.get('/routes/:pair/aircraft/:slug', (req, res) => {
  const m = /^([a-z]{3})-([a-z]{3})$/i.exec(req.params.pair);
  if (!m) return res.status(400).json({ success: false, message: 'invalid pair' });
  const fromIata = m[1].toLowerCase();
  const toIata = m[2].toLowerCase();
  const slug = String(req.params.slug || '').toLowerCase();

  if (!aircraftRouteSvc.isQualifying(fromIata, toIata, slug)) {
    return res.status(404).json({ success: false, message: 'not qualifying' });
  }

  const operators = aircraftRouteSvc.getOperators(fromIata, toIata, slug);
  res.json({
    success: true,
    data: {
      operators,
      fromIata: fromIata.toUpperCase(),
      toIata: toIata.toUpperCase(),
      slug,
    },
  });
});

// Sibling discovery for cross-linking
router.get('/routes/:pair/aircraft-list', (req, res) => {
  const m = /^([a-z]{3})-([a-z]{3})$/i.exec(req.params.pair);
  if (!m) return res.status(400).json({ success: false, message: 'invalid pair' });
  const fromIata = m[1].toLowerCase();
  const toIata = m[2].toLowerCase();
  const list = aircraftRouteSvc.getTopFamiliesForPair(fromIata, toIata, { limit: 8 });
  res.json({ success: true, data: list });
});

module.exports = router;
