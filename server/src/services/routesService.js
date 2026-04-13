'use strict';

const openFlights    = require('./openFlightsService');
const openSkyService = require('./openSkyService');
const airlabsService = require('./airlabsService');

/**
 * Merge routes from AirLabs (scheduled) and OpenSky (live ADS-B).
 *
 * Confidence tiers:
 *   live      — seen departing in last 12h via OpenSky
 *   scheduled — current airline schedule via AirLabs
 *
 * @param {string} iata  3-letter IATA origin
 * @returns {Promise<{
 *   origin: string,
 *   destinations: string[],
 *   confidences: Record<string, 'live'|'scheduled'>
 * }>}
 */
exports.getRoutes = async (iata) => {
  const code    = iata.toUpperCase();
  const airport = openFlights.getAirport(code);
  const icao    = airport?.icao;

  // ── 1. OpenSky (live ADS-B, last 12h) ──────────────────────────────────────
  let openSkyMap = new Map(); // destIata → lastSeen Date
  if (icao) {
    try {
      const departures = await openSkyService.getDepartures(icao);
      for (const { destIata, lastSeen } of departures) {
        const prev = openSkyMap.get(destIata);
        if (!prev || lastSeen > prev) openSkyMap.set(destIata, lastSeen);
      }
    } catch (err) {
      console.warn(`[routes] OpenSky error for ${code}:`, err.message);
    }
  }

  // ── 2. AirLabs (scheduled routes, 24h cache) ───────────────────────────────
  let airlabsSet = new Set();
  try {
    airlabsSet = await airlabsService.getRoutes(code);
  } catch (err) {
    console.warn(`[routes] AirLabs error for ${code}:`, err.message);
  }

  // ── Merge: live wins over scheduled ────────────────────────────────────────
  const allDest = new Set([...openSkyMap.keys(), ...airlabsSet]);

  const confidences = {};
  for (const dest of allDest) {
    if (dest === code) continue; // skip self-loops
    confidences[dest] = openSkyMap.has(dest) ? 'live' : 'scheduled';
  }

  const destinations = Object.keys(confidences);
  return { origin: code, destinations, confidences };
};
