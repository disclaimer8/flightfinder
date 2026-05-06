'use strict';
const obr = require('../models/observedRoutes');
const editorial = require('../config/editorialPairs.json');
const { getFamilyBySlug, getFamilyList } = require('../models/aircraftFamilies');
const openFlights = require('./openFlightsService');

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
const EDITORIAL_PAIRS = new Set(
  (editorial.pairs || []).map((p) => String(p).toLowerCase())
);

function isEditorialPair(fromIata, toIata) {
  const key = `${String(fromIata).toLowerCase()}-${String(toIata).toLowerCase()}`;
  return EDITORIAL_PAIRS.has(key);
}

function isQualifying(fromIata, toIata, slug) {
  if (!getFamilyBySlug(slug)) return false;
  if (isEditorialPair(fromIata, toIata)) return true;
  const count = obr.countComboByPairAndFamily(
    fromIata,
    toIata,
    slug,
    Date.now() - NINETY_DAYS_MS,
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
    const airline = g.airline_iata ? openFlights.getAirline(g.airline_iata) : null;
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
    Date.now() - NINETY_DAYS_MS,
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

function listQualifying({ limit = 10000 } = {}) {
  const auto = obr.listQualifyingCombos(Date.now() - NINETY_DAYS_MS, limit);
  const seen = new Set(auto.map((r) => `${r.from_iata}-${r.to_iata}-${r.slug}`));

  const editorialAdded = [];
  const families = getFamilyList();
  for (const pair of EDITORIAL_PAIRS) {
    const [from, to] = pair.split('-');
    if (!from || !to) continue;
    for (const fam of families) {
      const key = `${from}-${to}-${fam.slug}`;
      if (!seen.has(key) && editorialAdded.length < 1000) {
        editorialAdded.push({
          from_iata: from,
          to_iata: to,
          slug: fam.slug,
          combo_count: 0,
        });
        seen.add(key);
      }
    }
  }
  return [...auto, ...editorialAdded].slice(0, limit);
}

module.exports = {
  isQualifying,
  isEditorialPair,
  getOperators,
  getTopFamiliesForPair,
  listQualifying,
};
