'use strict';

const routePricingService = require('../services/routePricingService');

const PAIR_RE = /^([A-Z0-9]{3})-([A-Z0-9]{3})$/i;
const ICAO_RE = /^[A-Z][A-Z0-9]{2,5}$/i;
const CACHE_TTL_S = 300;

exports.getRoutePrices = (req, res) => {
  const m = PAIR_RE.exec(req.params.pair || '');
  if (!m) {
    return res.status(400).json({ success: false, message: 'Invalid route pair' });
  }
  const dep = m[1].toUpperCase();
  const arr = m[2].toUpperCase();

  try {
    const prices = routePricingService.getPricesForRoute(dep, arr);
    if (!prices || prices.length === 0) {
      return res.status(404).json({ error: 'no price data' });
    }
    res.set('Cache-Control', `public, max-age=${CACHE_TTL_S}`);
    return res.json({ success: true, dep, arr, prices });
  } catch (err) {
    console.error('[routePricing] getRoutePrices error:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to fetch prices' });
  }
};

exports.getAircraftPrices = (req, res) => {
  if (!ICAO_RE.test(req.params.icao || '')) {
    return res.status(400).json({ success: false, message: 'Invalid ICAO code' });
  }
  const icao = req.params.icao.toUpperCase();
  const limit = Math.min(Number(req.query.limit) || 10, 50);

  try {
    const routes = routePricingService.getRoutesForAircraft(icao, limit);
    if (!routes || routes.length === 0) {
      return res.status(404).json({ error: 'no price data' });
    }
    res.set('Cache-Control', `public, max-age=${CACHE_TTL_S}`);
    return res.json({ success: true, aircraft_icao: icao, routes });
  } catch (err) {
    console.error('[routePricing] getAircraftPrices error:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to fetch prices' });
  }
};
