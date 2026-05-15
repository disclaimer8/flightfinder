'use strict';
const obr = require('../models/observedRoutes');
const editorial = require('../config/editorialPairs.json');
const { getFamilyBySlug, getFamilyList, getFamilyByCode, slugify } = require('../models/aircraftFamilies');
const openFlights = require('./openFlightsService');
const { haversineKm } = require('./geocodingService');
const { db } = require('../models/db');

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const EDITORIAL_PAIRS = new Set(
  (editorial.pairs || []).map((p) => String(p).toLowerCase())
);

// ── Per-function in-memory cache ──────────────────────────────────────────────
const _variantDataCache = new Map();

function _evictVariantCache() {
  if (_variantDataCache.size > 50) {
    const now = Date.now();
    for (const [k, v] of _variantDataCache.entries()) {
      if (v.expiresAt <= now) _variantDataCache.delete(k);
    }
  }
}

/** Resets all caches. Exposed for test isolation only. */
function _resetCaches() {
  _variantDataCache.clear();
}

function isEditorialPair(fromIata, toIata) {
  const key = `${String(fromIata).toLowerCase()}-${String(toIata).toLowerCase()}`;
  return EDITORIAL_PAIRS.has(key);
}

/**
 * Format decimal hours as "Xh Ym".
 * e.g. 6.83 → "6h 50m"
 */
function _formatHours(decimalHours) {
  const h = Math.floor(decimalHours);
  const m = Math.round((decimalHours - h) * 60);
  return `${h}h ${m}m`;
}

function isQualifying(fromIata, toIata, slug) {
  if (!getFamilyBySlug(slug)) return false;
  // Editorial-pair short-circuit removed in F3 polish: it caused head meta
  // to say "index, follow" while body emitted "noindex, follow" for pairs
  // with no actual observations (e.g. LHR-SIN/boeing-747). All callers now
  // gate on real data only — head and body emit consistent signals.
  const count = obr.countComboByPairAndFamily(
    fromIata,
    toIata,
    slug,
    Date.now() - FOURTEEN_DAYS_MS,
  );
  return count >= 1;
}

function shapeOperator(rows) {
  // Group rows by airline_iata, aggregate model variants and date range.
  const grouped = new Map();
  for (const r of rows) {
    const key = r.airline_iata || 'unknown';
    if (!grouped.has(key)) {
      grouped.set(key, {
        airline_iata: r.airline_iata,
        airline_name: null,
        models: new Set(),
        first_seen_at: r.first_seen_at,
        last_seen_at: r.seen_at,
      });
    }
    const g = grouped.get(key);
    g.models.add(r.aircraft_icao);
    if (r.seen_at > g.last_seen_at) g.last_seen_at = r.seen_at;
    if (r.first_seen_at < g.first_seen_at) g.first_seen_at = r.first_seen_at;
  }
  // Resolve airline names + flatten models set
  return [...grouped.values()].map((g) => {
    const airline = g.airline_iata ? openFlights.getAirlineByIcao(g.airline_iata) : null;
    return {
      airline_iata: g.airline_iata,
      airline_name: airline?.name || g.airline_iata || 'Unknown',
      models: [...g.models].sort(),
      first_seen_at: g.first_seen_at,
      last_seen_at: g.last_seen_at,
    };
  }).sort((a, b) => b.last_seen_at - a.last_seen_at);
}

function getOperators(fromIata, toIata, slug) {
  const rows = obr.getByPairAndFamily(
    fromIata,
    toIata,
    slug,
    Date.now() - FOURTEEN_DAYS_MS,
  );
  return shapeOperator(rows);
}

function getTopFamiliesForPair(fromIata, toIata, { limit = 8 } = {}) {
  const rows = obr.topFamiliesForPair(
    fromIata,
    toIata,
    Date.now() - NINETY_DAYS_MS,
    limit,
  );
  // Enrich each with display label via aircraftFamilies model
  return rows.map((r) => {
    const fam = getFamilyBySlug(r.slug);
    return {
      slug: r.slug,
      label: fam?.family?.label || fam?.name || r.slug,
      combo_count: r.combo_count,
    };
  });
}

/**
 * Full payload for a /routes/{pair}/{slug} variant landing page, or null if:
 *   - either airport is unknown
 *   - slug is unknown
 *   - zero observations in the 14-day window
 *
 * Returned operators are sorted by obs_count DESC, limited to 10.
 * other_aircraft contains top 3 OTHER families on the same pair (by obs_count).
 *
 * @param {object} opts
 * @param {string} opts.from      - departure IATA (case-insensitive)
 * @param {string} opts.to        - arrival IATA (case-insensitive)
 * @param {string} opts.slug      - aircraft family slug (e.g. 'boeing-787')
 * @param {number} [opts.sinceMs] - epoch ms lower bound; defaults to 14 days ago
 * @returns {object|null}
 */
function getVariantData({ from, to, slug, sinceMs } = {}) {
  if (!from || !to || !slug) return null;

  const dep_iata = String(from).toUpperCase();
  const arr_iata = String(to).toUpperCase();
  const since    = Number.isFinite(Number(sinceMs)) ? Number(sinceMs) : (Date.now() - FOURTEEN_DAYS_MS);

  const cacheKey = `${dep_iata}:${arr_iata}:${slug}`;
  const now      = Date.now();
  const cached   = _variantDataCache.get(cacheKey);
  if (cached && cached.expiresAt > now) return cached.result;

  // Resolve airports
  const depAp = openFlights.getAirport(dep_iata);
  const arrAp = openFlights.getAirport(arr_iata);
  if (!depAp || !arrAp) {
    _variantDataCache.set(cacheKey, { result: null, expiresAt: now + CACHE_TTL_MS });
    _evictVariantCache();
    return null;
  }

  // Resolve family
  const famRec = getFamilyBySlug(slug);
  if (!famRec) {
    _variantDataCache.set(cacheKey, { result: null, expiresAt: now + CACHE_TTL_MS });
    _evictVariantCache();
    return null;
  }

  const icaoList = famRec.icaoList.map((c) => c.toUpperCase());
  if (icaoList.length === 0) {
    _variantDataCache.set(cacheKey, { result: null, expiresAt: now + CACHE_TTL_MS });
    _evictVariantCache();
    return null;
  }

  // Query observed_routes for this pair + family
  const placeholders = icaoList.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT airline_iata, aircraft_icao, seen_at, first_seen_at
    FROM observed_routes
    WHERE UPPER(dep_iata) = ?
      AND UPPER(arr_iata) = ?
      AND UPPER(aircraft_icao) IN (${placeholders})
      AND seen_at >= ?
      AND airline_iata IS NOT NULL
  `).all(dep_iata, arr_iata, ...icaoList, since);

  if (!rows || rows.length === 0) {
    _variantDataCache.set(cacheKey, { result: null, expiresAt: now + CACHE_TTL_MS });
    _evictVariantCache();
    return null;
  }

  // Aggregate operators (keyed by airline_icao — the column name is misleading)
  const operatorsMap = new Map();
  for (const row of rows) {
    const airlineIcao = String(row.airline_iata).toUpperCase();
    if (!operatorsMap.has(airlineIcao)) {
      operatorsMap.set(airlineIcao, {
        airline_icao:  airlineIcao,
        obs_count:     0,
        first_seen_at: row.first_seen_at || row.seen_at,
        last_seen_at:  row.seen_at,
      });
    }
    const entry = operatorsMap.get(airlineIcao);
    entry.obs_count++;
    if (row.seen_at > entry.last_seen_at)   entry.last_seen_at  = row.seen_at;
    if ((row.first_seen_at || row.seen_at) < entry.first_seen_at) {
      entry.first_seen_at = row.first_seen_at || row.seen_at;
    }
  }

  // Resolve operators: ICAO → IATA + name. Drop unresolvable.
  const operators = [];
  for (const entry of operatorsMap.values()) {
    const airlineRecord = openFlights.getAirlineByIcao(entry.airline_icao);
    if (!airlineRecord || !airlineRecord.iata) continue;
    operators.push({
      iata:         airlineRecord.iata,
      icao:         entry.airline_icao,
      name:         airlineRecord.name || airlineRecord.iata,
      country:      airlineRecord.country || null,
      obs_count:    entry.obs_count,
      first_seen_at: entry.first_seen_at,
      last_seen_at:  entry.last_seen_at,
    });
  }
  operators.sort((a, b) => b.obs_count - a.obs_count);
  const topOperators = operators.slice(0, 10);

  // Other aircraft on this pair (different families)
  const otherRows = db.prepare(`
    SELECT UPPER(aircraft_icao) AS icao, COUNT(*) AS cnt
    FROM observed_routes
    WHERE UPPER(dep_iata) = ?
      AND UPPER(arr_iata) = ?
      AND UPPER(aircraft_icao) NOT IN (${placeholders})
      AND seen_at >= ?
      AND aircraft_icao IS NOT NULL
    GROUP BY aircraft_icao
  `).all(dep_iata, arr_iata, ...icaoList, since);

  // Aggregate other aircraft rows into families
  const otherFamilyMap = new Map(); // slug → { slug, name, obs_count }
  for (const row of otherRows) {
    const fam = getFamilyByCode(row.icao);
    if (!fam) continue;
    const otherSlug = slugify(fam.name);
    if (!otherSlug || otherSlug === slug) continue;
    const existing = otherFamilyMap.get(otherSlug);
    if (existing) {
      existing.obs_count += row.cnt;
    } else {
      otherFamilyMap.set(otherSlug, {
        slug:      otherSlug,
        name:      fam.label || fam.name,
        obs_count: row.cnt,
      });
    }
  }
  const other_aircraft = [...otherFamilyMap.values()]
    .sort((a, b) => b.obs_count - a.obs_count)
    .slice(0, 3);

  // Compute distance and flight time
  const distance_km = haversineKm(depAp.lat, depAp.lon, arrAp.lat, arrAp.lon);
  const estimated_hours = (distance_km / 850) + 0.33;
  const estimated_time_str = _formatHours(estimated_hours);

  const result = {
    dep: {
      iata:    dep_iata,
      lat:     depAp.lat,
      lon:     depAp.lon,
      city:    depAp.city    || null,
      country: depAp.country || null,
    },
    arr: {
      iata:    arr_iata,
      lat:     arrAp.lat,
      lon:     arrAp.lon,
      city:    arrAp.city    || null,
      country: arrAp.country || null,
    },
    family: {
      slug,
      name:      famRec.name,
      label:     famRec.family?.label || famRec.name,
      icao_list: icaoList,
    },
    distance_km:         Math.round(distance_km),
    estimated_time_str,
    operators:           topOperators,
    other_aircraft,
    observed_count:      rows.length,
  };

  _variantDataCache.set(cacheKey, { result, expiresAt: now + CACHE_TTL_MS });
  _evictVariantCache();
  return result;
}

function listQualifying({ limit = 10000 } = {}) {
  // Only return combos with real observations. The former editorial-pair injection
  // added combo_count:0 entries to the sitemap — those pages had no data to render
  // and Google flagged them as Soft 404. Drop that logic entirely.
  return obr.listQualifyingCombos(Date.now() - FOURTEEN_DAYS_MS, limit);
}

module.exports = {
  isQualifying,
  isEditorialPair,
  getOperators,
  getTopFamiliesForPair,
  listQualifying,
  getVariantData,
  _resetCaches,
};
