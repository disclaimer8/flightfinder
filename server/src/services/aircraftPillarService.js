'use strict';
const obr = require('../models/observedRoutes');
const safety = require('../models/safetyEvents');
const openFlights = require('./openFlightsService');
const { getFamilyBySlug } = require('../models/aircraftFamilies');
const aircraftSpecs = require('../data/aircraftSpecs.json');

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

function getSpecsForSlug(slug) {
  return aircraftSpecs.families?.[slug] || null;
}

function getOperatorsForAircraft(slug, { limit = 50 } = {}) {
  const fam = getFamilyBySlug(slug);
  if (!fam) return [];
  const codes = (fam.icaoTypes || fam.icaoList || []).map((c) => c.toUpperCase());
  if (codes.length === 0) return [];

  const rows = obr.getRowsByAircraftCodes(codes, Date.now() - NINETY_DAYS_MS);
  const byAirline = new Map();
  for (const r of rows) {
    if (!r.airline_iata) continue;
    if (!byAirline.has(r.airline_iata)) {
      byAirline.set(r.airline_iata, {
        airline_iata: r.airline_iata,
        airline_name: openFlights.getAirline(r.airline_iata)?.name || r.airline_iata,
        route_count: 0,
        models: new Set(),
        last_seen_at: r.seen_at,
        sample_routes: [],
      });
    }
    const a = byAirline.get(r.airline_iata);
    a.route_count += 1;
    a.models.add(r.aircraft_icao);
    if (r.seen_at > a.last_seen_at) a.last_seen_at = r.seen_at;
    if (a.sample_routes.length < 3) {
      a.sample_routes.push(`${r.dep_iata}-${r.arr_iata}`);
    }
  }
  return [...byAirline.values()]
    .map((a) => ({ ...a, models: [...a.models].sort() }))
    .sort((a, b) => b.route_count - a.route_count)
    .slice(0, limit);
}

function getRoutesForAircraft(slug, { limit = 50 } = {}) {
  const fam = getFamilyBySlug(slug);
  if (!fam) return [];
  const codes = (fam.icaoTypes || fam.icaoList || []).map((c) => c.toUpperCase());
  if (codes.length === 0) return [];

  const rows = obr.getRowsByAircraftCodes(codes, Date.now() - NINETY_DAYS_MS);
  const byPair = new Map();
  for (const r of rows) {
    const key = `${r.dep_iata}-${r.arr_iata}`;
    if (!byPair.has(key)) {
      byPair.set(key, {
        dep_iata: r.dep_iata,
        arr_iata: r.arr_iata,
        operators: new Set(),
        models: new Set(),
        last_seen_at: r.seen_at,
      });
    }
    const p = byPair.get(key);
    if (r.airline_iata) p.operators.add(r.airline_iata);
    p.models.add(r.aircraft_icao);
    if (r.seen_at > p.last_seen_at) p.last_seen_at = r.seen_at;
  }
  return [...byPair.values()]
    .map((p) => ({
      dep_iata: p.dep_iata,
      arr_iata: p.arr_iata,
      operator_count: p.operators.size,
      operators: [...p.operators].sort(),
      models: [...p.models].sort(),
      last_seen_at: p.last_seen_at,
    }))
    .sort(
      (a, b) => b.operator_count - a.operator_count
        || b.last_seen_at - a.last_seen_at
    )
    .slice(0, limit);
}

function getSafetyForAircraft(slug, { limit = 100 } = {}) {
  const fam = getFamilyBySlug(slug);
  if (!fam) return [];
  const codes = (fam.icaoTypes || fam.icaoList || []).map((c) => c.toUpperCase());
  if (codes.length === 0) return [];
  return safety.getByAircraftCodes(codes, { limit });
}

module.exports = {
  getSpecsForSlug,
  getOperatorsForAircraft,
  getRoutesForAircraft,
  getSafetyForAircraft,
};
