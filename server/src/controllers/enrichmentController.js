'use strict';

const enrichmentService = require('../services/enrichmentService');
const cache = require('../services/cacheService');

// ID formats:
//   "BA175:2026-05-15" → { airline:'BA', flightNumber:'175', date:'2026-05-15' }  (mainline search)
//   "LX:2026-05-15"    → { airline:'LX', flightNumber:null, date:'2026-05-15' }   (by-aircraft search — route+aircraft, no flight#)
// When flightNumber is null the enrichment service still returns weather, amenities,
// CO₂ and livery; gate/on-time/delay-forecast short-circuit to null because they
// need a specific flight to look up.
function parseFlightId(id) {
  const [head, date] = id.split(':');
  const withNum = /^([A-Z0-9]{2})(\d{1,4})$/.exec(head || '');
  if (withNum) return { airline: withNum[1], flightNumber: withNum[2], date: date || null };
  const airlineOnly = /^([A-Z0-9]{2})$/.exec(head || '');
  if (airlineOnly) return { airline: airlineOnly[1], flightNumber: null, date: date || null };
  return null;
}

async function getEnriched(req, res) {
  const { id } = req.params;
  const parsed = parseFlightId(id);
  if (!parsed) return res.status(400).json({ success: false, message: 'Invalid flight id' });

  const flight = {
    id,
    airline:      parsed.airline,
    flightNumber: parsed.flightNumber,
    departure: { code: req.query.dep },
    arrival:   { code: req.query.arr },
    aircraft:  { icaoType: req.query.type, registration: req.query.reg },
  };

  try {
    const key = `enriched:${id}:${flight.departure.code}:${flight.arrival.code}:${flight.aircraft.icaoType}`;
    const { data } = await cache.getOrFetch(
      key,
      () => enrichmentService.enrichFlight(flight),
      600, // 10 min
    );
    return res.json({ success: true, tier: 'pro', data });
  } catch (err) {
    console.error('[enrich] failed:', err);
    return res.status(500).json({ success: false, message: 'Enrichment failed' });
  }
}

// Public teaser endpoint: same shape, all null values. Lets the client render
// blurred placeholders without branching on 403s.
function getTeaser(_req, res) {
  return res.json({
    success: true,
    tier: 'free',
    data: {
      livery: null,
      aircraft: null,
      onTime: null,
      delayForecast: null,
      co2: null,
      amenities: null,
      gate: null,
      weather: { origin: null, destination: null },
    },
  });
}

module.exports = { getEnriched, getTeaser };
