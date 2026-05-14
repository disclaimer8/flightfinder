'use strict';

/**
 * routeService — aggregations for /routes/{from}-{to} landing-page enrichment.
 *
 * CRITICAL: observed_routes.airline_iata stores ICAO codes despite its name
 * (e.g. 'BAW' not 'BA'). We resolve via openFlightsService.getAirlineByIcao().
 *
 * URL pairs use airport IATA codes (e.g. LHR-JFK). Both lowercase and uppercase
 * are accepted — normalised to uppercase internally.
 */

const { db }              = require('../models/db');
const openFlightsService  = require('./openFlightsService');
const { getFamilyByCode } = require('../models/aircraftFamilies');
const { haversineKm }     = require('./geocodingService');

const WINDOW_90D_MS = 90 * 24 * 60 * 60 * 1000;
const CACHE_TTL_MS  = 5 * 60 * 1000; // 5 minutes

// ── Per-function in-memory caches ─────────────────────────────────────────────
// key → { result, expiresAt }
const _routeDataCache   = new Map();
const _validPairsCache  = new Map();
const _topRoutesCache   = new Map();

/** Resets all caches. Exposed for test isolation only. */
function _resetCaches() {
  _routeDataCache.clear();
  _validPairsCache.clear();
  _topRoutesCache.clear();
}
exports._resetCaches = _resetCaches;

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Light expired-entry eviction so Maps don't grow indefinitely. */
function _evict(cache) {
  if (cache.size > 50) {
    const now = Date.now();
    for (const [k, v] of cache.entries()) {
      if (v.expiresAt <= now) cache.delete(k);
    }
  }
}

/**
 * Format decimal hours as "Xh Ym".
 * e.g. 6.83 → "6h 50m"
 */
function formatHours(decimalHours) {
  const h = Math.floor(decimalHours);
  const m = Math.round((decimalHours - h) * 60);
  return `${h}h ${m}m`;
}

// ── getRouteData ──────────────────────────────────────────────────────────────

/**
 * Return the full enriched payload for a (from, to) airport pair, or null when
 * the pair is too thin or either airport doesn't resolve.
 *
 * Threshold: (distinct operators >= 3 OR distinct aircraft >= 2)
 *            AND both airports resolve via openFlights.
 *
 * @param {object} opts
 * @param {string} opts.from     - departure IATA code (case-insensitive)
 * @param {string} opts.to       - arrival IATA code (case-insensitive)
 * @param {number} [opts.sinceMs] - epoch ms lower bound; defaults to 90 days ago
 * @returns {object|null}
 */
exports.getRouteData = function getRouteData({ from, to, sinceMs } = {}) {
  if (!from || !to) return null;

  const dep_iata = String(from).toUpperCase();
  const arr_iata = String(to).toUpperCase();
  const since    = Number.isFinite(Number(sinceMs)) ? Number(sinceMs) : (Date.now() - WINDOW_90D_MS);

  const cacheKey = `${dep_iata}:${arr_iata}:${Math.floor(since / 60_000)}`;
  const now      = Date.now();
  const cached   = _routeDataCache.get(cacheKey);
  if (cached && cached.expiresAt > now) return cached.result;

  // Resolve airports — bail early if either is missing.
  const dep = openFlightsService.getAirport(dep_iata);
  const arr = openFlightsService.getAirport(arr_iata);
  if (!dep || !arr) {
    _routeDataCache.set(cacheKey, { result: null, expiresAt: now + CACHE_TTL_MS });
    _evict(_routeDataCache);
    return null;
  }

  // Compute distance and estimated flight time.
  const distance_km      = haversineKm(dep.lat, dep.lon, arr.lat, arr.lon);
  const estimated_hours  = (distance_km / 850) + 0.33; // 850 km/h cruise + 20 min ground
  const estimated_time_str = formatHours(estimated_hours);

  // Query observed_routes for all rows matching this pair within the window.
  const rows = db.prepare(`
    SELECT airline_iata, aircraft_icao, seen_at
    FROM observed_routes
    WHERE UPPER(dep_iata) = ? AND UPPER(arr_iata) = ?
      AND seen_at > ?
      AND airline_iata IS NOT NULL
      AND aircraft_icao IS NOT NULL
  `).all(dep_iata, arr_iata, since);

  if (!rows || rows.length === 0) {
    _routeDataCache.set(cacheKey, { result: null, expiresAt: now + CACHE_TTL_MS });
    _evict(_routeDataCache);
    return null;
  }

  // Aggregate operators (keyed by airline_icao) and aircraft (keyed by aircraft_icao).
  // Note: observed_routes.airline_iata column stores ICAO codes despite its name.
  const operatorsMap = new Map(); // airline_icao → { airline_icao, aircraft_set, obs_count }
  const aircraftMap  = new Map(); // aircraft_icao → { icao, operator_set, obs_count }

  for (const row of rows) {
    const airline_icao  = String(row.airline_iata).toUpperCase();
    const aircraft_icao = String(row.aircraft_icao).toUpperCase();

    // Accumulate operator entry.
    if (!operatorsMap.has(airline_icao)) {
      operatorsMap.set(airline_icao, { airline_icao, aircraft_set: new Set(), obs_count: 0 });
    }
    const opEntry = operatorsMap.get(airline_icao);
    opEntry.aircraft_set.add(aircraft_icao);
    opEntry.obs_count++;

    // Accumulate aircraft entry.
    if (!aircraftMap.has(aircraft_icao)) {
      aircraftMap.set(aircraft_icao, { icao: aircraft_icao, operator_set: new Set(), obs_count: 0 });
    }
    const acEntry = aircraftMap.get(aircraft_icao);
    acEntry.operator_set.add(airline_icao);
    acEntry.obs_count++;
  }

  // Resolve operators: ICAO → name + iata. Drop unresolvable entries.
  const operators = [];
  for (const entry of operatorsMap.values()) {
    const airlineRecord = openFlightsService.getAirlineByIcao(entry.airline_icao);
    if (!airlineRecord || !airlineRecord.iata) continue; // drop — no display target
    operators.push({
      iata:           airlineRecord.iata,
      icao:           entry.airline_icao,
      name:           airlineRecord.name || airlineRecord.iata,
      aircraft_count: entry.aircraft_set.size,
      obs_count:      entry.obs_count,
    });
  }
  operators.sort((a, b) => b.obs_count - a.obs_count);

  // Resolve aircraft: aircraft_icao → family name.
  const aircraft = [];
  for (const entry of aircraftMap.values()) {
    const family = getFamilyByCode(entry.icao);
    aircraft.push({
      icao:           entry.icao,
      name:           family?.name || entry.icao,
      operator_count: entry.operator_set.size,
      obs_count:      entry.obs_count,
    });
  }
  aircraft.sort((a, b) => b.obs_count - a.obs_count);

  // Apply threshold: ≥3 distinct operators OR ≥2 distinct aircraft types.
  const distinct_operators = operators.length;
  const distinct_aircraft  = aircraft.length;

  if (distinct_operators < 3 && distinct_aircraft < 2) {
    _routeDataCache.set(cacheKey, { result: null, expiresAt: now + CACHE_TTL_MS });
    _evict(_routeDataCache);
    return null;
  }

  const result = {
    dep: {
      iata:    dep_iata,
      lat:     dep.lat,
      lon:     dep.lon,
      city:    dep.city    || null,
      country: dep.country || null,
    },
    arr: {
      iata:    arr_iata,
      lat:     arr.lat,
      lon:     arr.lon,
      city:    arr.city    || null,
      country: arr.country || null,
    },
    distance_km:         Math.round(distance_km),
    estimated_hours:     Math.round(estimated_hours * 100) / 100,
    estimated_time_str,
    operators,
    aircraft,
    summary: {
      total_observations: rows.length,
      distinct_operators,
      distinct_aircraft,
    },
  };

  _routeDataCache.set(cacheKey, { result, expiresAt: now + CACHE_TTL_MS });
  _evict(_routeDataCache);
  return result;
};

// ── listValidRoutePairs ───────────────────────────────────────────────────────

/**
 * Enumerate (from, to) pairs meeting the threshold, for sitemap enumeration.
 *
 * Threshold: distinct operators >= minOperators OR distinct aircraft >= minAircraft.
 * Airport coordinate availability is NOT checked here — that happens at request time.
 *
 * @param {object} opts
 * @param {number} [opts.sinceMs]       - epoch ms lower bound; defaults to 90 days ago
 * @param {number} [opts.minOperators]  - min distinct operators (default 3)
 * @param {number} [opts.minAircraft]   - min distinct aircraft types (default 2)
 * @returns {Array<{from, to, op_count, ac_count}>}
 */
exports.listValidRoutePairs = function listValidRoutePairs({
  sinceMs,
  minOperators = 3,
  minAircraft  = 2,
} = {}) {
  const since    = Number.isFinite(Number(sinceMs)) ? Number(sinceMs) : (Date.now() - WINDOW_90D_MS);
  // Bucket to nearest minute for cache-hit stability across rapid calls.
  const sinceBucket = Math.floor(since / 60_000) * 60_000;
  const minOps      = Math.max(1, Number(minOperators) || 3);
  const minAc       = Math.max(1, Number(minAircraft)  || 2);
  const cacheKey    = `${sinceBucket}:${minOps}:${minAc}`;
  const now         = Date.now();

  const cached = _validPairsCache.get(cacheKey);
  if (cached && cached.expiresAt > now) return cached.result;

  const rows = db.prepare(`
    SELECT dep_iata, arr_iata,
           COUNT(DISTINCT airline_iata)  AS op_count,
           COUNT(DISTINCT aircraft_icao) AS ac_count
    FROM observed_routes
    WHERE seen_at > ? AND airline_iata IS NOT NULL AND aircraft_icao IS NOT NULL
    GROUP BY dep_iata, arr_iata
    HAVING op_count >= ? OR ac_count >= ?
    ORDER BY op_count + ac_count DESC
  `).all(sinceBucket, minOps, minAc);

  const result = rows.map(r => ({
    from:     String(r.dep_iata).toUpperCase(),
    to:       String(r.arr_iata).toUpperCase(),
    op_count: r.op_count,
    ac_count: r.ac_count,
  }));

  _validPairsCache.set(cacheKey, { result, expiresAt: now + CACHE_TTL_MS });
  _evict(_validPairsCache);
  return result;
};

// ── getTopRoutesFromCity / getTopRoutesToCity ─────────────────────────────────

/**
 * Return the top destination airports from a departure IATA, for the
 * "Other routes from {city}" cross-link cluster.
 *
 * @param {object} opts
 * @param {string} opts.iata           - departure IATA code (case-insensitive)
 * @param {number} [opts.sinceMs]      - epoch ms lower bound; defaults to 90 days ago
 * @param {number} [opts.limit]        - max results (default 5)
 * @param {string} [opts.excludePair]  - "DEP-ARR" pair to exclude (current page pair)
 * @returns {Array<{arr_iata, arr_city, arr_country, count}>}
 */
exports.getTopRoutesFromCity = function getTopRoutesFromCity({
  iata,
  sinceMs,
  limit       = 5,
  excludePair = null,
} = {}) {
  if (!iata) return [];

  const dep_iata = String(iata).toUpperCase();
  const since    = Number.isFinite(Number(sinceMs)) ? Number(sinceMs) : (Date.now() - WINDOW_90D_MS);
  const lim      = Math.max(1, Number(limit) || 5);

  const cacheKey = `from:${dep_iata}:${Math.floor(since / 60_000)}:${lim}:${excludePair || ''}`;
  const now      = Date.now();
  const cached   = _topRoutesCache.get(cacheKey);
  if (cached && cached.expiresAt > now) return cached.result;

  // Parse excludePair into dep/arr IATAs for the NOT filter.
  let excDep = dep_iata;
  let excArr  = '__NONE__'; // sentinel that never matches a real IATA
  if (excludePair) {
    const parts = String(excludePair).toUpperCase().split('-');
    if (parts.length === 2) {
      excDep = parts[0];
      excArr  = parts[1];
    }
  }

  const rows = db.prepare(`
    SELECT arr_iata, COUNT(*) AS count
    FROM observed_routes
    WHERE UPPER(dep_iata) = ?
      AND seen_at > ?
      AND NOT (UPPER(dep_iata) = ? AND UPPER(arr_iata) = ?)
    GROUP BY arr_iata
    ORDER BY count DESC
    LIMIT ?
  `).all(dep_iata, since, excDep, excArr, lim);

  const result = rows.map(r => {
    const ap = openFlightsService.getAirport(r.arr_iata);
    return {
      arr_iata:    String(r.arr_iata).toUpperCase(),
      arr_city:    ap?.city    || null,
      arr_country: ap?.country || null,
      count:       r.count,
    };
  });

  _topRoutesCache.set(cacheKey, { result, expiresAt: now + CACHE_TTL_MS });
  _evict(_topRoutesCache);
  return result;
};

/**
 * Mirror of getTopRoutesFromCity — returns top departure airports for a given
 * arrival IATA ("Other routes to {city}").
 *
 * @param {object} opts
 * @param {string} opts.iata           - arrival IATA code (case-insensitive)
 * @param {number} [opts.sinceMs]      - epoch ms lower bound; defaults to 90 days ago
 * @param {number} [opts.limit]        - max results (default 5)
 * @param {string} [opts.excludePair]  - "DEP-ARR" pair to exclude (current page pair)
 * @returns {Array<{dep_iata, dep_city, dep_country, count}>}
 */
exports.getTopRoutesToCity = function getTopRoutesToCity({
  iata,
  sinceMs,
  limit       = 5,
  excludePair = null,
} = {}) {
  if (!iata) return [];

  const arr_iata = String(iata).toUpperCase();
  const since    = Number.isFinite(Number(sinceMs)) ? Number(sinceMs) : (Date.now() - WINDOW_90D_MS);
  const lim      = Math.max(1, Number(limit) || 5);

  const cacheKey = `to:${arr_iata}:${Math.floor(since / 60_000)}:${lim}:${excludePair || ''}`;
  const now      = Date.now();
  const cached   = _topRoutesCache.get(cacheKey);
  if (cached && cached.expiresAt > now) return cached.result;

  // Parse excludePair into dep/arr IATAs for the NOT filter.
  let excDep = '__NONE__';
  let excArr  = arr_iata;
  if (excludePair) {
    const parts = String(excludePair).toUpperCase().split('-');
    if (parts.length === 2) {
      excDep = parts[0];
      excArr  = parts[1];
    }
  }

  const rows = db.prepare(`
    SELECT dep_iata, COUNT(*) AS count
    FROM observed_routes
    WHERE UPPER(arr_iata) = ?
      AND seen_at > ?
      AND NOT (UPPER(dep_iata) = ? AND UPPER(arr_iata) = ?)
    GROUP BY dep_iata
    ORDER BY count DESC
    LIMIT ?
  `).all(arr_iata, since, excDep, excArr, lim);

  const result = rows.map(r => {
    const ap = openFlightsService.getAirport(r.dep_iata);
    return {
      dep_iata:    String(r.dep_iata).toUpperCase(),
      dep_city:    ap?.city    || null,
      dep_country: ap?.country || null,
      count:       r.count,
    };
  });

  _topRoutesCache.set(cacheKey, { result, expiresAt: now + CACHE_TTL_MS });
  _evict(_topRoutesCache);
  return result;
};
