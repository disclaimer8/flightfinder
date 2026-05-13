'use strict';

/**
 * airlineAircraftController — GET /api/airline/:iata/aircraft/:icao/routes
 *
 * Validates path params, delegates to airlineAircraftService.getCombo,
 * returns 400/404/200 as appropriate. 5-minute in-process cache.
 */

const cacheService          = require('../services/cacheService');
const airlineAircraftService = require('../services/airlineAircraftService');

const CACHE_TTL_S = 5 * 60; // 5 minutes

const IATA_RE = /^[A-Z0-9]{2,3}$/i;
const ICAO_RE = /^[A-Z][A-Z0-9]{2,5}$/i;

/**
 * GET /api/airline/:iata/aircraft/:icao/routes
 */
exports.getRoutes = (req, res) => {
  const rawIata = req.params.iata;
  const rawIcao = req.params.icao;

  if (!IATA_RE.test(rawIata)) {
    return res.status(400).json({ success: false, message: 'Invalid airline IATA code' });
  }
  if (!ICAO_RE.test(rawIcao)) {
    return res.status(400).json({ success: false, message: 'Invalid aircraft ICAO code' });
  }

  const iata = rawIata.toUpperCase();
  const icao = rawIcao.toUpperCase();

  const cacheKey = `airline-aircraft-routes:v1:${iata}:${icao}`;
  const cached   = cacheService.get(cacheKey);
  if (cached !== undefined) {
    if (cached._404) return res.status(404).json({ error: 'no routes found' });
    res.set('Cache-Control', 'public, max-age=300');
    return res.json(cached);
  }

  try {
    const sinceMs = Date.now() - (90 * 24 * 60 * 60 * 1000);
    const data    = airlineAircraftService.getCombo({ iataAirline: iata, icaoAircraft: icao, sinceMs });

    if (data === null) {
      cacheService.set(cacheKey, { _404: true }, CACHE_TTL_S);
      return res.status(404).json({ error: 'no routes found' });
    }

    const payload = { success: true, ...data };
    cacheService.set(cacheKey, payload, CACHE_TTL_S);
    res.set('Cache-Control', 'public, max-age=300');
    return res.json(payload);
  } catch (err) {
    console.error('[airlineAircraft] getRoutes error:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to fetch airline/aircraft routes' });
  }
};
