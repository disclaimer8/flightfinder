'use strict';

const openFlights     = require('./openFlightsService');
const openSkyService  = require('./openSkyService');
const wikidataService = require('./wikidataService');

/**
 * Merge routes from all three sources for an origin airport.
 * Each destination gets the highest-confidence tier from any source that knows it.
 *
 * @param {string} iata  3-letter IATA origin
 * @returns {Promise<{
 *   origin: string,
 *   destinations: string[],
 *   confidences: Record<string, 'live'|'scheduled'|'historical'>
 * }>}
 */
exports.getRoutes = async (iata) => {
  const code    = iata.toUpperCase();
  const airport = openFlights.getAirport(code);
  const icao    = airport?.icao;

  // ── 1. OpenSky (live ADS-B traffic, last 7 days) ──────────────────────────
  let openSkyMap = new Map(); // destIata → lastSeen Date
  if (icao) {
    try {
      const departures = await openSkyService.getDepartures(icao, 7);
      for (const { destIata, lastSeen } of departures) {
        const prev = openSkyMap.get(destIata);
        if (!prev || lastSeen > prev) openSkyMap.set(destIata, lastSeen);
      }
    } catch (err) {
      console.warn(`[routes] OpenSky error for ${code}:`, err.message);
    }
  }

  // ── 2. Wikidata (scheduled routes, weekly refresh) ────────────────────────
  const wikidataSet = wikidataService.getRoutes(code);

  // ── 3. OpenFlights routes.dat (historical fallback) ───────────────────────
  const historicalSet = new Set(openFlights.getDirectDestinations(code));

  // ── Merge: assign highest-confidence tier per destination ─────────────────
  const allDest = new Set([
    ...openSkyMap.keys(),
    ...wikidataSet,
    ...historicalSet,
  ]);

  const confidences = {};
  for (const dest of allDest) {
    if (dest === code) continue; // skip self-loops
    if (openSkyMap.has(dest)) {
      confidences[dest] = 'live';
    } else if (wikidataSet.has(dest)) {
      confidences[dest] = 'scheduled';
    } else {
      confidences[dest] = 'historical';
    }
  }

  const destinations = Object.keys(confidences);
  return { origin: code, destinations, confidences };
};
