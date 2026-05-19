'use strict';

const cacheService          = require('../services/cacheService');
const airlineLandingService = require('../services/airlineLandingService');

const CACHE_TTL_S = 5 * 60;
const IATA_RE = /^[A-Z0-9]{2,3}$/i;

exports.getLanding = (req, res) => {
  const rawIata = req.params.iata;
  if (!IATA_RE.test(rawIata)) {
    return res.status(400).json({ success: false, message: 'Invalid airline IATA code' });
  }
  const iata = rawIata.toUpperCase();

  const cacheKey = `airline-landing:v1:${iata}`;
  const cached   = cacheService.get(cacheKey);
  if (cached !== undefined) {
    if (cached._404) return res.status(404).json({ error: 'no airline data' });
    res.set('Cache-Control', 'public, max-age=300');
    return res.json(cached);
  }

  try {
    const data = airlineLandingService.getAirlineLanding(iata);
    if (data === null) {
      cacheService.set(cacheKey, { _404: true }, CACHE_TTL_S);
      return res.status(404).json({ error: 'no airline data' });
    }
    const payload = { success: true, ...data };
    cacheService.set(cacheKey, payload, CACHE_TTL_S);
    res.set('Cache-Control', 'public, max-age=300');
    return res.json(payload);
  } catch (err) {
    console.error('[airline] getLanding error:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to fetch airline landing' });
  }
};
