'use strict';

const cacheService = require('../services/cacheService');
const {
  aggregateForMap,
  distinctAirlinesWithCounts,
  distinctAircraftWithCounts,
} = require('../models/observedRoutes');

const WINDOW_90D_MS = 90 * 24 * 60 * 60 * 1000;
const CACHE_TTL_S   = 5 * 60; // 5 minutes in seconds

/**
 * Sanitise a query-param value:
 *   - null/empty → null
 *   - non-alphanumeric chars → throws { status: 400 }
 *   - clamps to maxLen chars
 *
 * Returns the original-case string (callers upper/lower as needed).
 */
function sanitiseParam(val, maxLen) {
  if (val === undefined || val === null || val === '') return null;
  const str = String(val);
  if (/[^a-z0-9]/i.test(str)) {
    const err = new Error('Query parameter contains invalid characters');
    err.status = 400;
    throw err;
  }
  return str.slice(0, maxLen);
}

/**
 * GET /api/map/routes?airline=&aircraft=
 *
 * Returns { routes: [...] } from aggregateForMap with a 90-day window.
 * airline: IATA code, up to 4 chars, alphanumeric only, optional.
 * aircraft: ICAO type code, up to 6 chars, alphanumeric only, optional.
 *
 * Cache: 5 minutes per (airline, aircraft) combination.
 * Header: Cache-Control: public, max-age=300
 */
exports.getRoutes = (req, res) => {
  let airline, aircraft;
  try {
    airline  = sanitiseParam(req.query.airline,  4);
    aircraft = sanitiseParam(req.query.aircraft, 6);
  } catch (err) {
    return res.status(400).json({ success: false, message: err.message });
  }

  const airlineU  = airline  ? airline.toUpperCase()  : null;
  const aircraftU = aircraft ? aircraft.toUpperCase() : null;

  const cacheKey = `map-routes:v1:${airlineU || ''}:${aircraftU || ''}`;
  const cached   = cacheService.get(cacheKey);
  if (cached !== undefined) {
    res.set('Cache-Control', 'public, max-age=300');
    return res.json(cached);
  }

  try {
    const sinceMs = Date.now() - WINDOW_90D_MS;
    const routes  = aggregateForMap({ airline: airlineU, aircraft: aircraftU, sinceMs });
    const payload = { routes };
    cacheService.set(cacheKey, payload, CACHE_TTL_S);
    res.set('Cache-Control', 'public, max-age=300');
    return res.json(payload);
  } catch (err) {
    console.error('[mapRoutes] getRoutes error:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to fetch routes' });
  }
};

/**
 * GET /api/map/filters
 *
 * Returns { airlines: [{iata, name, count}], aircraft: [{icao, label, count}] }
 * from the last 90 days. Airlines capped at top 200; aircraft returns all.
 * Both lists are sorted by count DESC (the model query already orders them).
 *
 * Cache: 5 minutes.
 * Header: Cache-Control: public, max-age=300
 */
exports.getFilters = (_req, res) => {
  const cacheKey = 'map-filters:v1';
  const cached   = cacheService.get(cacheKey);
  if (cached !== undefined) {
    res.set('Cache-Control', 'public, max-age=300');
    return res.json(cached);
  }

  try {
    const sinceMs  = Date.now() - WINDOW_90D_MS;
    const airlines = distinctAirlinesWithCounts(sinceMs).slice(0, 200);
    const aircraft = distinctAircraftWithCounts(sinceMs);
    const payload  = { airlines, aircraft };
    cacheService.set(cacheKey, payload, CACHE_TTL_S);
    res.set('Cache-Control', 'public, max-age=300');
    return res.json(payload);
  } catch (err) {
    console.error('[mapRoutes] getFilters error:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to fetch filters' });
  }
};
