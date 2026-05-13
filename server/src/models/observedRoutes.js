'use strict';
/**
 * observedRoutes model — pair+family queries for the aircraft-route grid.
 *
 * NOTE: aircraft_family_models does NOT exist as a SQLite table. Family→ICAO
 * code mappings live entirely in models/aircraftFamilies.js (JS module).
 * Therefore all queries that filter by family accept an array of ICAO type
 * codes resolved from the JS module, and use dynamic IN clauses.
 *
 * The four exported functions match the interface expected by the service
 * layer (aircraftRouteService.js) and the observedRoutes.test.js spec.
 */

const { db } = require('./db');
const { getFamilyBySlug, getFamilyList, getFamilyByCode } = require('./aircraftFamilies');
const openFlightsService = require('../services/openFlightsService');

/**
 * Build a reverse map: UPPER(icao_type) → family_slug.
 * Includes only ICAO codes (4-char, starts with letter) from each family.
 * Called once at module load — families are static.
 *
 * When multiple families share the same ICAO code (e.g. 'A320' appears in
 * both 'Airbus A320' and 'Airbus A320 family'), the last family wins.
 * In practice the canonical narrow family (not the composite) should be
 * preferred; we use the more-specific slug for ties via alphabetical order
 * so "airbus-a320" beats "airbus-a320-family" (shorter slug loses).
 * The test seeds only unambiguous ICAO codes (B788, B789, A359) so this
 * tie-breaking is irrelevant to correctness.
 */
function buildIcaoToSlugMap() {
  const map = new Map();
  const families = getFamilyList();
  for (const fam of families) {
    const rec = getFamilyBySlug(fam.slug);
    if (!rec) continue;
    for (const code of rec.icaoList) {
      const upper = code.toUpperCase();
      // Prefer more-specific (non-"family") slugs: overwrite only if not already set,
      // or if the existing slug contains "family" and this one doesn't.
      const existing = map.get(upper);
      if (!existing || (existing.includes('family') && !fam.slug.includes('family'))) {
        map.set(upper, fam.slug);
      }
    }
  }
  return map;
}

const ICAO_TO_SLUG = buildIcaoToSlugMap();

/**
 * Resolve a family slug to its list of ICAO type codes (uppercase).
 * Returns [] if slug is unknown.
 */
function icaosForSlug(slug) {
  const rec = getFamilyBySlug(String(slug).toLowerCase());
  if (!rec) return [];
  return rec.icaoList.map(c => c.toUpperCase());
}

/**
 * Build an SQL IN clause and corresponding parameter list.
 * Returns { clause: 'IN (?,?,?)', params: [...] } or
 *         { clause: 'IN (NULL)', params: [] } for empty arrays (always false).
 */
function inClause(arr) {
  if (!arr || arr.length === 0) return { clause: 'IN (NULL)', params: [] };
  return {
    clause: `IN (${arr.map(() => '?').join(',')})`,
    params: arr,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Count distinct ICAO type codes (model variants) for a family observed on a
 * given (dep, arr) pair within the time window.
 *
 * ≥1 means the combo qualifies for indexing.
 *
 * @param {string} dep     - departure IATA (case-insensitive)
 * @param {string} arr     - arrival IATA (case-insensitive)
 * @param {string} slug    - family slug e.g. 'boeing-787'
 * @param {number} sinceMs - epoch ms lower bound for seen_at
 * @returns {number}
 */
function countComboByPairAndFamily(dep, arr, slug, sinceMs) {
  const icaos = icaosForSlug(slug);
  const { clause, params } = inClause(icaos);
  const sql = `
    SELECT COUNT(DISTINCT UPPER(aircraft_icao)) AS n
    FROM observed_routes
    WHERE LOWER(dep_iata) = ?
      AND LOWER(arr_iata) = ?
      AND UPPER(aircraft_icao) ${clause}
      AND seen_at >= ?
  `;
  const row = db.prepare(sql).get(
    String(dep).toLowerCase(),
    String(arr).toLowerCase(),
    ...params,
    Number(sinceMs) || 0,
  );
  return row?.n || 0;
}

/**
 * All observed_routes rows for a specific (pair, family) within the window.
 * Used to render the operators list on the landing page.
 *
 * @param {string} dep
 * @param {string} arr
 * @param {string} slug
 * @param {number} sinceMs
 * @returns {Array<{dep_iata, arr_iata, aircraft_icao, airline_iata, seen_at, first_seen_at}>}
 */
function getByPairAndFamily(dep, arr, slug, sinceMs) {
  const icaos = icaosForSlug(slug);
  const { clause, params } = inClause(icaos);
  const sql = `
    SELECT dep_iata, arr_iata, aircraft_icao, airline_iata, seen_at, first_seen_at
    FROM observed_routes
    WHERE LOWER(dep_iata) = ?
      AND LOWER(arr_iata) = ?
      AND UPPER(aircraft_icao) ${clause}
      AND seen_at >= ?
    ORDER BY seen_at DESC
  `;
  return db.prepare(sql).all(
    String(dep).toLowerCase(),
    String(arr).toLowerCase(),
    ...params,
    Number(sinceMs) || 0,
  );
}

/**
 * Sitemap enumeration: every qualifying (pair, slug) combo with ≥1 observation
 * in the time window.
 *
 * Implementation: fetch all observed_routes rows within the window, group them
 * by (dep, arr, aircraft_icao), then map each aircraft_icao to its family slug
 * via the in-memory ICAO_TO_SLUG map built at module load.
 *
 * @param {number} sinceMs
 * @param {number} limit   - max rows to return (capped at 50000)
 * @returns {Array<{from_iata, to_iata, slug, combo_count}>}
 */
function listQualifyingCombos(sinceMs, limit = 10000) {
  const cap = Math.min(Math.max(Number(limit) || 10000, 1), 50000);

  // Fetch all rows in window, grouped by (dep, arr, aircraft_icao)
  const rawRows = db.prepare(`
    SELECT LOWER(dep_iata) AS dep, LOWER(arr_iata) AS arr,
           UPPER(aircraft_icao) AS icao
    FROM observed_routes
    WHERE seen_at >= ?
    GROUP BY dep_iata, arr_iata, aircraft_icao
  `).all(Number(sinceMs) || 0);

  // Accumulate into (dep, arr, slug) → count map
  const accumulator = new Map();
  for (const row of rawRows) {
    const slug = ICAO_TO_SLUG.get(row.icao);
    if (!slug) continue; // unknown ICAO type — skip
    const key = `${row.dep}|${row.arr}|${slug}`;
    accumulator.set(key, (accumulator.get(key) || 0) + 1);
  }

  // Convert to array sorted by combo_count desc, capped at limit
  const result = [];
  for (const [key, count] of accumulator) {
    const [from_iata, to_iata, slug] = key.split('|');
    result.push({ from_iata, to_iata, slug, combo_count: count });
  }
  result.sort((a, b) => b.combo_count - a.combo_count);
  return result.slice(0, cap);
}

/**
 * Cross-linking: top aircraft families on a given pair, ranked by observation
 * count (number of rows in observed_routes for that family × pair).
 *
 * @param {string} dep
 * @param {string} arr
 * @param {number} sinceMs
 * @param {number} limit   - max families to return (capped at 20)
 * @returns {Array<{slug, combo_count}>}
 */
function topFamiliesForPair(dep, arr, sinceMs, limit = 8) {
  const cap = Math.min(Math.max(Number(limit) || 8, 1), 20);

  const rows = db.prepare(`
    SELECT UPPER(aircraft_icao) AS icao, COUNT(*) AS cnt
    FROM observed_routes
    WHERE LOWER(dep_iata) = ?
      AND LOWER(arr_iata) = ?
      AND seen_at >= ?
    GROUP BY aircraft_icao
  `).all(
    String(dep).toLowerCase(),
    String(arr).toLowerCase(),
    Number(sinceMs) || 0,
  );

  // Map ICAO → slug and aggregate
  const familyMap = new Map(); // slug → total count
  for (const row of rows) {
    const slug = ICAO_TO_SLUG.get(row.icao);
    if (!slug) continue;
    familyMap.set(slug, (familyMap.get(slug) || 0) + row.cnt);
  }

  const result = [];
  for (const [slug, combo_count] of familyMap) {
    result.push({ slug, combo_count });
  }
  result.sort((a, b) => b.combo_count - a.combo_count);
  return result.slice(0, cap);
}

/**
 * Aggregate observed_routes for the interactive map.
 *
 * Groups all rows by (dep_iata, arr_iata), collects the set of distinct
 * airlines and aircraft types per pair, and resolves airport coordinates via
 * openFlightsService. Pairs where either endpoint has no coordinate data are
 * silently dropped (logged via console.info).
 *
 * @param {object} opts
 * @param {string} [opts.airline]  - IATA airline code filter (case-insensitive)
 * @param {string} [opts.aircraft] - ICAO aircraft type filter (case-insensitive)
 * @param {number} [opts.sinceMs]  - epoch ms lower bound for seen_at (default 0)
 * @returns {Array<{
 *   dep_iata: string, arr_iata: string,
 *   dep_lat: number, dep_lon: number,
 *   arr_lat: number, arr_lon: number,
 *   airline_count: number, aircraft_count: number,
 *   last_seen_at: number,
 * }>}
 */
function aggregateForMap({ airline, aircraft, sinceMs } = {}) {
  const since = Number(sinceMs) || 0;

  // Build dynamic WHERE clauses for optional filters
  const conditions = ['seen_at >= ?'];
  const params = [since];

  if (airline) {
    conditions.push('UPPER(airline_iata) = ?');
    params.push(String(airline).toUpperCase());
  }
  if (aircraft) {
    conditions.push('UPPER(aircraft_icao) = ?');
    params.push(String(aircraft).toUpperCase());
  }

  const where = conditions.join(' AND ');
  const sql = `
    SELECT dep_iata, arr_iata, airline_iata, aircraft_icao, seen_at
    FROM observed_routes
    WHERE ${where}
  `;

  const rows = db.prepare(sql).all(...params);

  // Group by (dep_iata, arr_iata) pair
  const pairMap = new Map();
  for (const row of rows) {
    const key = `${row.dep_iata.toUpperCase()}|${row.arr_iata.toUpperCase()}`;
    if (!pairMap.has(key)) {
      pairMap.set(key, {
        dep_iata: row.dep_iata.toUpperCase(),
        arr_iata: row.arr_iata.toUpperCase(),
        airlines: new Set(),
        aircraft: new Set(),
        last_seen_at: 0,
      });
    }
    const entry = pairMap.get(key);
    if (row.airline_iata) entry.airlines.add(row.airline_iata.toUpperCase());
    if (row.aircraft_icao) entry.aircraft.add(row.aircraft_icao.toUpperCase());
    if (row.seen_at > entry.last_seen_at) entry.last_seen_at = row.seen_at;
  }

  // Resolve airport coords and drop pairs with missing data
  const result = [];
  let dropped = 0;
  for (const entry of pairMap.values()) {
    const dep = openFlightsService.getAirport(entry.dep_iata);
    const arr = openFlightsService.getAirport(entry.arr_iata);
    if (!dep || !arr || dep.lat == null || dep.lon == null || arr.lat == null || arr.lon == null) {
      dropped++;
      continue;
    }
    result.push({
      dep_iata: entry.dep_iata,
      arr_iata: entry.arr_iata,
      dep_lat: dep.lat,
      dep_lon: dep.lon,
      arr_lat: arr.lat,
      arr_lon: arr.lon,
      airline_count: entry.airlines.size,
      aircraft_count: entry.aircraft.size,
      last_seen_at: entry.last_seen_at,
    });
  }
  if (dropped > 0) {
    console.info(`[aggregateForMap] dropped ${dropped} pair(s) with missing airport coords`);
  }
  return result;
}

/**
 * Top airlines observed in the time window, enriched with human-readable name.
 *
 * SELECT airline_iata, COUNT(*) AS count
 * FROM observed_routes
 * WHERE seen_at > ? AND airline_iata IS NOT NULL
 * GROUP BY airline_iata ORDER BY count DESC
 *
 * Name lookup via openFlightsService.getAirline(iata)?.name; falls back to
 * the raw IATA code when the lookup misses.
 *
 * @param {number} sinceMs - epoch ms lower bound for seen_at
 * @returns {Array<{iata: string, name: string, count: number}>}
 */
function distinctAirlinesWithCounts(sinceMs) {
  const since = Number(sinceMs) || 0;
  const rows = db.prepare(`
    SELECT airline_iata, COUNT(*) AS count
    FROM observed_routes
    WHERE seen_at > ? AND airline_iata IS NOT NULL
    GROUP BY airline_iata
    ORDER BY count DESC
  `).all(since);

  return rows.map((row) => {
    const airline = openFlightsService.getAirline(row.airline_iata);
    return {
      iata: row.airline_iata,
      name: airline?.name || row.airline_iata,
      count: row.count,
    };
  });
}

/**
 * All aircraft types observed in the time window, enriched with a human-
 * readable label from aircraftFamilies.
 *
 * SELECT aircraft_icao, COUNT(*) AS count
 * FROM observed_routes
 * WHERE seen_at > ? AND aircraft_icao IS NOT NULL
 * GROUP BY aircraft_icao ORDER BY count DESC
 *
 * Label lookup via getFamilyByCode(icao)?.label; falls back to the raw ICAO
 * code when unknown.
 *
 * @param {number} sinceMs - epoch ms lower bound for seen_at
 * @returns {Array<{icao: string, label: string, count: number}>}
 */
function distinctAircraftWithCounts(sinceMs) {
  const since = Number(sinceMs) || 0;
  const rows = db.prepare(`
    SELECT aircraft_icao, COUNT(*) AS count
    FROM observed_routes
    WHERE seen_at > ? AND aircraft_icao IS NOT NULL
    GROUP BY aircraft_icao
    ORDER BY count DESC
  `).all(since);

  return rows.map((row) => {
    const family = getFamilyByCode(row.aircraft_icao);
    return {
      icao: row.aircraft_icao,
      label: family?.label || row.aircraft_icao,
      count: row.count,
    };
  });
}

module.exports = {
  countComboByPairAndFamily,
  getByPairAndFamily,
  listQualifyingCombos,
  topFamiliesForPair,
  aggregateForMap,
  distinctAirlinesWithCounts,
  distinctAircraftWithCounts,

  getRowsByAircraftCodes(codes, sinceMs) {
    if (!Array.isArray(codes) || codes.length === 0) return [];
    const upper = codes.map((c) => String(c).toUpperCase());
    const placeholders = upper.map(() => '?').join(',');
    const sql = `
      SELECT dep_iata, arr_iata, aircraft_icao, airline_iata, seen_at, first_seen_at
      FROM observed_routes
      WHERE UPPER(aircraft_icao) IN (${placeholders})
        AND seen_at >= ?
      ORDER BY seen_at DESC
    `;
    return db.prepare(sql).all(...upper, Number(sinceMs) || 0);
  },
};
