'use strict';

const openFlights    = require('./openFlightsService');
const openSkyService = require('./openSkyService');
const airlabsService = require('./airlabsService');
const db             = require('../models/db');

const OBSERVED_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const LIVE_STALE_MS        = 15 * 60 * 1000;           // 15 min — "just departed"

/**
 * Build the RouteMap data for an origin airport.
 *
 * Sources, in order of precedence (merged, not replaced):
 *   1. AirLabs /schedules  — today's departing flights, giving full destination
 *                            breadth (~160 dests for a hub). No aircraft data.
 *   2. AirLabs /flights    — live airborne snapshot with 100% aircraft_icao.
 *                            Also triggers a write-through into observed_routes
 *                            so aircraft enrichment accumulates over time.
 *   3. observed_routes DB  — historical (dep,arr,aircraft) tuples we've seen
 *                            during any /flights call in the last 30 days.
 *   4. OpenSky ADS-B       — supplementary 12h live "just departed" signal;
 *                            used only to upgrade a destination's confidence to
 *                            'live' when it's already present from above.
 *
 * Confidence:
 *   live      — seen airborne in the last 15 min OR via OpenSky in last 12h
 *   scheduled — on today's AirLabs schedule but not yet/anymore airborne
 *   observed  — absent from today's schedule but seen at some point in last 30d
 *
 * @param {string} iata  3-letter IATA origin
 * @returns {Promise<{
 *   origin: string,
 *   destinations: string[],
 *   confidences: Record<string, 'live'|'scheduled'|'observed'>,
 *   aircraft: Record<string, string[]>   // arr_iata → array of aircraft_icao codes
 * }>}
 */
exports.getRoutes = async (iata) => {
  const code    = iata.toUpperCase();
  const airport = openFlights.getAirport(code);
  const icao    = airport?.icao;

  const now = Date.now();
  const liveCutoff     = now - LIVE_STALE_MS;
  const observedCutoff = now - OBSERVED_LOOKBACK_MS;

  // 1. AirLabs /schedules → destination breadth (no aircraft).
  let scheduleDests = new Set();
  try {
    const schedRows = await airlabsService.getSchedules(code);
    for (const row of schedRows) {
      if (row.arr_iata && row.arr_iata.length === 3) {
        scheduleDests.add(row.arr_iata.toUpperCase());
      }
    }
  } catch (err) {
    console.warn(`[routes] AirLabs schedules error for ${code}:`, err.message);
  }

  // 2. AirLabs /flights → live airborne + aircraft enrichment + write-through to DB.
  const liveAirborne = new Map(); // arr_iata → Set<aircraft_icao>
  try {
    const liveRows = await airlabsService.getLiveFlights(code);
    for (const row of liveRows) {
      if (!row.arr_iata || row.arr_iata.length !== 3) continue;
      const arr = row.arr_iata.toUpperCase();
      if (!liveAirborne.has(arr)) liveAirborne.set(arr, new Set());
      if (row.aircraft_icao) liveAirborne.get(arr).add(row.aircraft_icao.toUpperCase());
    }
  } catch (err) {
    console.warn(`[routes] AirLabs live-flights error for ${code}:`, err.message);
  }

  // 3. OpenSky 12h ADS-B — supplementary live signal (sparse, enriches confidence).
  let openSkyLive = new Set();
  if (icao) {
    try {
      const departures = await openSkyService.getDepartures(icao);
      for (const { destIata, lastSeen } of departures) {
        if (lastSeen && lastSeen.getTime() >= liveCutoff) openSkyLive.add(destIata);
      }
    } catch (err) {
      console.warn(`[routes] OpenSky error for ${code}:`, err.message);
    }
  }

  // 4. observed_routes — historical (dep,arr,aircraft) accumulation.
  let observedDests = new Set();
  try {
    observedDests = new Set(db.observedDestinationsFromDep(code, observedCutoff));
  } catch (err) {
    console.warn(`[routes] observed_routes read error for ${code}:`, err.message);
  }

  // Merge all destination sets.
  const allDest = new Set([
    ...scheduleDests,
    ...liveAirborne.keys(),
    ...openSkyLive,
    ...observedDests,
  ]);

  const confidences = {};
  const aircraft    = {};

  for (const dest of allDest) {
    if (dest === code) continue; // skip self-loops

    // Confidence tiering
    if (liveAirborne.has(dest) || openSkyLive.has(dest)) {
      confidences[dest] = 'live';
    } else if (scheduleDests.has(dest)) {
      confidences[dest] = 'scheduled';
    } else {
      confidences[dest] = 'observed';
    }

    // Aircraft enrichment: live snapshot wins; else fall back to DB lookup.
    const acSet = new Set(liveAirborne.get(dest) || []);
    if (acSet.size === 0) {
      try {
        const hist = db.observedAircraftByRoute(code, dest, observedCutoff);
        for (const row of hist) acSet.add(row.aircraft_icao);
      } catch { /* DB read is best-effort */ }
    }
    if (acSet.size) aircraft[dest] = Array.from(acSet).sort();
  }

  const destinations = Object.keys(confidences);
  return { origin: code, destinations, confidences, aircraft };
};
