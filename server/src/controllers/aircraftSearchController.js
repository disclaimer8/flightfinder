'use strict';

const { searchByAircraftFamily } = require('../services/aircraftSearchService');
const geocoding = require('../services/geocodingService');

/**
 * GET /api/flights/aircraft-search/stream
 *
 * SSE endpoint — streams search progress and results.
 * Expects validated query on req.validatedQuery (set by validate.aircraftSearchQuery).
 */
exports.streamAircraftSearch = async (req, res) => {
  const { familyName, city, radius, iata, date, passengers } = req.validatedQuery;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // disable nginx buffering

  const send = (event, data) => {
    if (!res.destroyed) {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    }
  };

  try {
    const gen = searchByAircraftFamily({ familyName, city, radius, iata, date, passengers });

    for await (const { event, data } of gen) {
      if (res.destroyed) break; // client closed connection
      send(event, data);
    }
  } catch (err) {
    console.error('[aircraftSearch] stream error:', err.message);
    send('error', { message: 'Search failed unexpectedly' });
  }

  if (!res.destroyed) res.end();
};

/**
 * GET /api/airports/search?q=London&limit=8
 *
 * Autocomplete endpoint for city/airport search in the UI.
 */
exports.searchAirports = (req, res) => {
  const { q, limit } = req.query;
  if (!q || q.length < 2) {
    return res.status(400).json({ success: false, message: 'q must be at least 2 characters' });
  }
  const lim = Math.min(parseInt(limit, 10) || 8, 20);
  const results = geocoding.searchAirports(q, lim);
  res.json({ success: true, airports: results });
};
