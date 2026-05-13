'use strict';

/**
 * airlineAircraftService — aggregates observed_routes by (airline ICAO, aircraft ICAO)
 * for the airline×aircraft matrix landing pages.
 *
 * CRITICAL: observed_routes.airline_iata column stores ICAO codes despite its name.
 * Input to getCombo/listValidCombinations is IATA (e.g. 'BA'); we convert to ICAO
 * via openFlightsService.getAirline(iata)?.icao before passing to SQL.
 */

const { db } = require('../models/db');
const openFlightsService = require('./openFlightsService');
const { getFamilyByCode, slugify: slugifyAircraft } = require('../models/aircraftFamilies');
const { haversineKm } = require('./geocodingService');

const WINDOW_90D_MS = 90 * 24 * 60 * 60 * 1000;
const MIN_PAIRS     = 5; // thin-combo threshold

// Re-export haversineKm so callers can access it from this module.
exports.haversineKm = haversineKm;

/**
 * Return the full data object for an airline×aircraft combination, or null when
 * the combo is too thin (< MIN_PAIRS distinct (dep,arr) pairs after coord-miss drops).
 *
 * @param {object} opts
 * @param {string} opts.iataAirline  - IATA airline code (e.g. 'BA')
 * @param {string} opts.icaoAircraft - ICAO aircraft type (e.g. 'A388')
 * @param {number} [opts.sinceMs]    - epoch ms lower bound; defaults to 90 days ago
 * @returns {object|null}
 */
exports.getCombo = function getCombo({ iataAirline, icaoAircraft, sinceMs } = {}) {
  if (!iataAirline || !icaoAircraft) return null;

  // Convert IATA airline → ICAO for the SQL filter (column stores ICAO codes).
  const airlineRecord = openFlightsService.getAirline(String(iataAirline).toUpperCase());
  if (!airlineRecord || !airlineRecord.icao) return null;

  const airlineIcao  = String(airlineRecord.icao).toUpperCase();
  const aircraftUpper = String(icaoAircraft).toUpperCase();
  const since         = Number.isFinite(Number(sinceMs)) ? Number(sinceMs) : (Date.now() - WINDOW_90D_MS);

  // Each (dep_iata, arr_iata, aircraft_icao) row is unique by PK.
  // For a given airline+aircraft combo, we collapse by (dep, arr), keeping max seen_at.
  const rows = db.prepare(`
    SELECT dep_iata, arr_iata, MAX(seen_at) AS last_seen_at
    FROM observed_routes
    WHERE UPPER(airline_iata)  = ?
      AND UPPER(aircraft_icao) = ?
      AND seen_at > ?
    GROUP BY dep_iata, arr_iata
  `).all(airlineIcao, aircraftUpper, since);

  if (!rows || rows.length === 0) return null;

  // Enrich with airport coords and haversine distance; drop pairs with missing coords.
  const routes = [];
  let  dropped = 0;
  for (const row of rows) {
    const dep = openFlightsService.getAirport(row.dep_iata);
    const arr = openFlightsService.getAirport(row.arr_iata);
    if (
      !dep || !arr ||
      dep.lat == null || dep.lon == null ||
      arr.lat == null || arr.lon == null
    ) {
      dropped++;
      continue;
    }
    routes.push({
      dep: {
        iata:    row.dep_iata.toUpperCase(),
        lat:     dep.lat,
        lon:     dep.lon,
        name:    dep.name   || null,
        city:    dep.city   || null,
        country: dep.country || null,
      },
      arr: {
        iata:    row.arr_iata.toUpperCase(),
        lat:     arr.lat,
        lon:     arr.lon,
        name:    arr.name   || null,
        city:    arr.city   || null,
        country: arr.country || null,
      },
      distance_km:  Math.round(haversineKm(dep.lat, dep.lon, arr.lat, arr.lon)),
      last_seen_at: row.last_seen_at,
    });
  }

  if (dropped > 0) {
    console.info(`[airlineAircraftService] dropped ${dropped} pair(s) with missing airport coords for ${iataAirline}/${icaoAircraft}`);
  }

  // Thin-combo guard: < 5 surviving pairs → null.
  if (routes.length < MIN_PAIRS) return null;

  // Sort by last_seen_at DESC.
  routes.sort((a, b) => b.last_seen_at - a.last_seen_at);

  // Summary stats.
  const allDistances = routes.map(r => r.distance_km);
  const maxDist = Math.max(...allDistances);
  const minDist = Math.min(...allDistances);
  const longest = routes.find(r => r.distance_km === maxDist) || null;
  const shortest = routes.find(r => r.distance_km === minDist) || null;

  const airportSet = new Set();
  for (const r of routes) {
    airportSet.add(r.dep.iata);
    airportSet.add(r.arr.iata);
  }

  // Aircraft family metadata.
  const family = getFamilyByCode(aircraftUpper);

  return {
    airline: {
      iata:    airlineRecord.iata,
      icao:    airlineRecord.icao,
      name:    airlineRecord.name,
      country: airlineRecord.country || null,
    },
    aircraft: {
      icao:         aircraftUpper,
      name:         family?.name || aircraftUpper,
      slug:         family?.name ? slugifyAircraft(family.name) : null,
      category:     family?.family?.type || null,
      manufacturer: family?.family?.manufacturer || null,
    },
    summary: {
      n_pairs:    routes.length,
      n_airports: airportSet.size,
      longest:    longest ? { dep: longest.dep.iata, arr: longest.arr.iata, distance_km: longest.distance_km } : null,
      shortest:   shortest ? { dep: shortest.dep.iata, arr: shortest.arr.iata, distance_km: shortest.distance_km } : null,
    },
    routes,
  };
};

/**
 * Enumerate valid (airline IATA, aircraft ICAO) combos with >= minPairs distinct
 * (dep, arr) observations in the window. Used for sitemap generation.
 *
 * Filters out combos whose airline ICAO code cannot be resolved to an IATA code.
 *
 * @param {object} opts
 * @param {number} [opts.sinceMs]  - epoch ms lower bound; defaults to 90 days ago
 * @param {number} [opts.minPairs] - minimum distinct pairs (default 5)
 * @returns {Array<{iata: string, icao_aircraft: string, n_pairs: number}>}
 */
exports.listValidCombinations = function listValidCombinations({ sinceMs, minPairs = MIN_PAIRS } = {}) {
  const since = Number.isFinite(Number(sinceMs)) ? Number(sinceMs) : (Date.now() - WINDOW_90D_MS);
  const min   = Math.max(1, Number(minPairs) || MIN_PAIRS);

  // Count distinct (dep,arr) pairs per (airline_iata ICAO, aircraft_icao).
  const rows = db.prepare(`
    SELECT airline_iata AS airline_icao,
           UPPER(aircraft_icao) AS icao_aircraft,
           COUNT(DISTINCT dep_iata || '|' || arr_iata) AS n_pairs
    FROM observed_routes
    WHERE seen_at > ?
      AND airline_iata IS NOT NULL
      AND aircraft_icao IS NOT NULL
    GROUP BY airline_iata, aircraft_icao
    HAVING n_pairs >= ?
  `).all(since, min);

  // Resolve each airline ICAO → IATA; discard unresolvable ones.
  const result = [];
  for (const row of rows) {
    const airlineRecord = openFlightsService.getAirlineByIcao(row.airline_icao);
    if (!airlineRecord || !airlineRecord.iata) continue;
    result.push({
      iata:         airlineRecord.iata,
      icao_aircraft: row.icao_aircraft,
      n_pairs:      row.n_pairs,
    });
  }

  return result;
};
