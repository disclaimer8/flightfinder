'use strict';

const jontyRouteService      = require('./jontyRouteService');
const airlineAircraftService = require('./airlineAircraftService');
const openFlightsService     = require('./openFlightsService');

const HUB_MIN_ROUTES = 10;
const ORIGINS_CAP    = 100;
const TOP_N_AIRCRAFT = 6;
const TOP_N_HUBS     = 5;
const TOP_N_DESTS    = 5;

function getAirlineLanding(iata) {
  if (!iata) return null;
  const upper = String(iata).toUpperCase();

  const airlineRecord = openFlightsService.getAirline(upper);
  if (!airlineRecord) return null;

  const jonty    = buildJontySection(upper);
  const observed = buildObservedSection(upper);

  const observedEmpty = observed.topAircraft.length === 0
                     && observed.hubs.length === 0
                     && observed.topDests.length === 0;
  if (jonty === null && observedEmpty) return null;

  return {
    airline: {
      iata: airlineRecord.iata || upper,
      icao: airlineRecord.icao || null,
      name: airlineRecord.name || upper,
    },
    jonty,
    observed,
  };
}

function buildJontySection(iata) {
  let rows;
  try { rows = jontyRouteService.getAirlineNetwork(iata); }
  catch { return null; }
  if (!rows || rows.length === 0) return null;

  const countries = new Set();
  const originsMap = new Map();

  for (const r of rows) {
    if (r.origin_country) countries.add(r.origin_country);
    if (r.dest_country)   countries.add(r.dest_country);

    const prev = originsMap.get(r.origin_iata);
    if (prev) {
      prev.routeCount += 1;
    } else {
      originsMap.set(r.origin_iata, {
        iata: r.origin_iata,
        city: r.origin_city || null,
        country: r.origin_country || null,
        routeCount: 1,
      });
    }
  }

  const origins = Array.from(originsMap.values())
    .sort((a, b) => b.routeCount - a.routeCount)
    .slice(0, ORIGINS_CAP);

  const hubCount = Array.from(originsMap.values())
    .filter(o => o.routeCount >= HUB_MIN_ROUTES).length;

  return {
    totalRoutes: rows.length,
    totalCountries: countries.size,
    hubCount,
    origins,
  };
}

function buildObservedSection(iata) {
  const validCombos = safe(() => airlineAircraftService.listValidCombinations({})) || [];
  const validSet    = airlineAircraftService.buildValidComboSet(validCombos);
  const iataLower   = iata.toLowerCase();

  const rawTopAircraft = safe(() => airlineAircraftService.getTopAircraftForAirline({
    iataAirline: iata, limit: TOP_N_AIRCRAFT,
  })) || [];
  const topAircraft = rawTopAircraft.map(ac => ({
    icao: ac.icao_aircraft,
    name: ac.name,
    nPairs: ac.n_pairs,
    hasMatrix: validSet.has(`${iataLower}:${String(ac.icao_aircraft).toLowerCase()}`),
  }));

  const rawHubs = safe(() => airlineAircraftService.getTopHubsForAirline({
    iataAirline: iata, limit: TOP_N_HUBS,
  })) || [];
  const hubs = rawHubs.map(h => ({
    iata: h.iata, city: h.city, country: h.country, pairCount: h.pair_count,
  }));

  const rawTopDests = safe(() => airlineAircraftService.getTopDestinationsForAirline({
    iataAirline: iata, limit: TOP_N_DESTS,
  })) || [];
  const topDests = rawTopDests.map(d => ({
    iata: d.iata, city: d.city, country: d.country, pairCount: d.pair_count,
  }));

  return { topAircraft, hubs, topDests };
}

function safe(fn) {
  try { return fn(); } catch { return null; }
}

module.exports = { getAirlineLanding };
