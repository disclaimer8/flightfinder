'use strict';
/**
 * Aircraft × Route programmatic landing pages API.
 *
 * GET /api/routes/:pair/aircraft/:slug  — main detail endpoint
 * GET /api/routes/:pair/aircraft-list   — sibling discovery for cross-linking
 *
 * Aircraft pillar sub-page endpoints (Spec D):
 * GET /api/aircraft/:slug/airlines
 * GET /api/aircraft/:slug/routes
 * GET /api/aircraft/:slug/safety
 * GET /api/aircraft/:slug/specs
 */
const express = require('express');
const router = express.Router();
const aircraftRouteSvc = require('../services/aircraftRouteService');
const aircraftPillarService = require('../services/aircraftPillarService');
const routePricingController = require('../controllers/routePricingController');

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

// Route × aircraft pricing (median EUR per aircraft for a city pair)
router.get('/routes/:pair/prices', routePricingController.getRoutePrices);

// Aircraft pillar sub-page endpoints
router.get('/aircraft/:slug/airlines', (req, res) => {
  const slug = String(req.params.slug || '').toLowerCase();
  res.json({ success: true, data: aircraftPillarService.getOperatorsForAircraft(slug) });
});

router.get('/aircraft/:slug/routes', (req, res) => {
  const slug = String(req.params.slug || '').toLowerCase();
  res.json({ success: true, data: aircraftPillarService.getRoutesForAircraft(slug) });
});

router.get('/aircraft/:slug/safety', (req, res) => {
  const slug = String(req.params.slug || '').toLowerCase();
  const fam = require('../models/aircraftFamilies').getFamilyBySlug(slug);
  // label = the human display name (e.g. "Boeing 787 Dreamliner") consumed
  // by the React breadcrumb. Falls back to slug for safe-degraded rendering.
  const label = fam?.family?.label || fam?.name || slug;
  res.json({
    success: true,
    label,
    data: aircraftPillarService.getSafetyForAircraft(slug),
  });
});

router.get('/aircraft/:slug/specs', (req, res) => {
  const slug = String(req.params.slug || '').toLowerCase();
  const data = aircraftPillarService.getSpecsForSlug(slug);
  if (!data) return res.status(404).json({ success: false, message: 'specs not available' });
  res.json({ success: true, data });
});

module.exports = router;
