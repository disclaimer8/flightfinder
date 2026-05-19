'use strict';

/**
 * routePricingService — read-side service for the route × aircraft × price
 * widget. Reads daily snapshot rows produced by aggregate-gf-prices.js into
 * route_aircraft_prices, enriches with aircraft family labels/slugs, airline
 * display names, and a coarse 5-year safety summary.
 *
 * Cached at 5 min TTL per (dep, arr) pair — keeps the upcoming /api endpoint
 * cheap under bursty SSR/CSR fan-out without staling beyond the snapshot
 * cadence.
 */

const { db } = require('../models/db');
const cacheService = require('./cacheService');
const openFlights = require('./openFlightsService');
const aircraftSafetyService = require('./aircraftSafetyService');
const { getFamilyByCode, slugify } = require('../models/aircraftFamilies');

const CACHE_TTL_S = 5 * 60;
const FIVE_YEARS_MS = 5 * 365 * 24 * 3600 * 1000;

function safetySummaryForIcao(icao) {
  const fam = getFamilyByCode(icao);
  if (!fam) return { accident_count_5y: 0, level: 'green' };
  const cutoffMs = Date.now() - FIVE_YEARS_MS;
  // Real aircraftFamilies.getFamilyByCode returns { name, family: { codes:Set }, label }.
  // Be defensive about shape — tests mock with { code, label } only.
  const icaoList = fam.family && fam.family.codes
    ? [...fam.family.codes]
    : [icao];
  const familyName = fam.name || fam.code || icao;
  let events = [];
  try {
    events = aircraftSafetyService.getMergedEventsForFamily({
      icaoList, familyName, limit: 500,
    }) || [];
  } catch {
    events = [];
  }
  const recent = events.filter((e) => {
    const t = typeof e.occurred_at === 'number' ? e.occurred_at : e.date_ms;
    return typeof t === 'number' && t >= cutoffMs;
  });
  const n = recent.length;
  const level = n === 0 ? 'green' : (n <= 3 ? 'yellow' : 'red');
  return { accident_count_5y: n, level };
}

exports.getPricesForRoute = function getPricesForRoute(dep, arr) {
  const depU = String(dep || '').toUpperCase();
  const arrU = String(arr || '').toUpperCase();
  if (!depU || !arrU) return [];

  const key = `rap:route:${depU}:${arrU}`;
  const cached = cacheService.get(key);
  if (cached !== undefined) return cached;

  const rows = db.prepare(`
    SELECT aircraft_icao, median_eur, min_eur, max_eur, n_quotes, airlines_csv, snapshot_at
    FROM route_aircraft_prices
    WHERE dep_iata = ? AND arr_iata = ?
    ORDER BY median_eur ASC
  `).all(depU, arrU);

  const enriched = rows.map((r) => {
    const fam = getFamilyByCode(r.aircraft_icao);
    const airlines = r.airlines_csv ? r.airlines_csv.split(',').filter(Boolean) : [];
    return {
      aircraft_icao: r.aircraft_icao,
      aircraft_name: (fam && fam.label) || r.aircraft_icao,
      aircraft_slug: fam ? slugify(fam.label) : r.aircraft_icao.toLowerCase(),
      median_eur: r.median_eur,
      min_eur: r.min_eur,
      max_eur: r.max_eur,
      n_quotes: r.n_quotes,
      airlines,
      airlines_display: airlines
        .map((icao) => {
          const a = openFlights.getAirlineByIcao(icao);
          return (a && a.name) || icao;
        })
        .join(', '),
      safety: safetySummaryForIcao(r.aircraft_icao),
      snapshot_at: r.snapshot_at,
    };
  });

  cacheService.set(key, enriched, CACHE_TTL_S);
  return enriched;
};

exports.getRoutesForAircraft = function getRoutesForAircraft(icao, limit = 10) {
  const icaoU = String(icao || '').toUpperCase();
  if (!icaoU) return [];

  const key = `rap:aircraft:${icaoU}:${limit}`;
  const cached = cacheService.get(key);
  if (cached !== undefined) return cached;

  const rows = db.prepare(`
    SELECT dep_iata, arr_iata, median_eur, min_eur, max_eur, n_quotes
    FROM route_aircraft_prices
    WHERE aircraft_icao = ?
    ORDER BY n_quotes DESC
    LIMIT ?
  `).all(icaoU, limit);

  const enriched = rows.map((r) => {
    const dep = openFlights.getAirport(r.dep_iata);
    const arr = openFlights.getAirport(r.arr_iata);
    return {
      dep_iata: r.dep_iata,
      arr_iata: r.arr_iata,
      dep_city: (dep && dep.city) || r.dep_iata,
      arr_city: (arr && arr.city) || r.arr_iata,
      median_eur: r.median_eur,
      min_eur: r.min_eur,
      max_eur: r.max_eur,
      n_quotes: r.n_quotes,
    };
  });

  cacheService.set(key, enriched, CACHE_TTL_S);
  return enriched;
};
