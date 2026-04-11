'use strict';

/**
 * Geocoding service — resolves city names / IATA codes to coordinates
 * and finds nearby airports. Uses the already-loaded airports.dat in memory.
 * No external API needed.
 */

const openFlights = require('./openFlightsService');

// ── Haversine distance ────────────────────────────────────────────────────────

/**
 * Great-circle distance between two lat/lon points in km.
 */
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── City aliases — covers common mismatches with airports.dat city field ──────

const CITY_ALIASES = {
  'new york':   ['JFK', 'EWR', 'LGA'],
  'nyc':        ['JFK', 'EWR', 'LGA'],
  'ny':         ['JFK', 'EWR', 'LGA'],
  'london':     ['LHR', 'LGW', 'LTN', 'STN', 'LCY', 'SEN'],
  'tokyo':      ['NRT', 'HND'],
  'moscow':     ['SVO', 'DME', 'VKO'],
  'paris':      ['CDG', 'ORY'],
  'milan':      ['MXP', 'LIN', 'BGY'],
  'rome':       ['FCO', 'CIA'],
  'chicago':    ['ORD', 'MDW'],
  'los angeles':['LAX', 'BUR', 'LGB', 'ONT', 'SNA'],
  'la':         ['LAX'],
  'san francisco': ['SFO', 'OAK', 'SJC'],
  'sf':         ['SFO'],
  'miami':      ['MIA', 'FLL', 'PBI'],
  'houston':    ['IAH', 'HOU'],
  'dallas':     ['DFW', 'DAL'],
  'washington': ['IAD', 'DCA', 'BWI'],
  'dc':         ['IAD', 'DCA', 'BWI'],
  'toronto':    ['YYZ', 'YTZ', 'YHM'],
  'montreal':   ['YUL', 'YHU'],
  'vancouver':  ['YVR'],
  'beijing':    ['PEK', 'PKX'],
  'shanghai':   ['PVG', 'SHA'],
  'seoul':      ['ICN', 'GMP'],
  'dubai':      ['DXB', 'DWC'],
  'istanbul':   ['IST', 'SAW'],
  'jakarta':    ['CGK', 'HLP'],
  'kuala lumpur': ['KUL', 'SZB'],
  'bangkok':    ['BKK', 'DMK'],
  'sydney':     ['SYD', 'BNK'],
  'melbourne':  ['MEL', 'AVV'],
  'cairo':      ['CAI'],
  'johannesburg': ['JNB', 'HLA'],
  'cape town':  ['CPT'],
  'nairobi':    ['NBO'],
  'casablanca': ['CMN'],
  'buenos aires': ['EZE', 'AEP'],
  'sao paulo':  ['GRU', 'CGH', 'VCP'],
  'lima':       ['LIM'],
  'bogota':     ['BOG'],
  'santiago':   ['SCL'],
  'mexico city': ['MEX'],
  'athens':     ['ATH'],
  'lisbon':     ['LIS'],
  'madrid':     ['MAD', 'TOJ'],
  'barcelona':  ['BCN'],
  'amsterdam':  ['AMS'],
  'frankfurt':  ['FRA', 'HHN'],
  'munich':     ['MUC'],
  'zurich':     ['ZRH'],
  'vienna':     ['VIE'],
  'brussels':   ['BRU', 'CRL'],
  'copenhagen': ['CPH'],
  'oslo':       ['OSL', 'TRF'],
  'stockholm':  ['ARN', 'BMA', 'NYO'],
  'helsinki':   ['HEL'],
  'dublin':     ['DUB'],
  'singapore':  ['SIN'],
  'hong kong':  ['HKG'],
  'mumbai':     ['BOM'],
  'delhi':      ['DEL'],
  'kyiv':       ['KBP', 'IEV'],
  'kiev':       ['KBP', 'IEV'],
  'warsaw':     ['WAW', 'WMI'],
  'prague':     ['PRG'],
  'budapest':   ['BUD'],
  'bucharest':  ['OTP', 'BBU'],
  'sofia':      ['SOF'],
  'belgrade':   ['BEG'],
  'zagreb':     ['ZAG'],
};

// ── Core functions ────────────────────────────────────────────────────────────

/**
 * Find up to `limit` airports within `radiusKm` of a lat/lon point,
 * sorted by distance ascending.
 *
 * @param {number} lat
 * @param {number} lon
 * @param {number} radiusKm
 * @param {number} [limit=5]
 * @returns {{ iata: string, name: string, city: string, distanceKm: number }[]}
 */
function nearbyAirports(lat, lon, radiusKm, limit = 5) {
  const all = openFlights.getAllAirports();
  const results = [];

  for (const airport of all) {
    if (!airport.lat || !airport.lon) continue;
    const dist = haversineKm(lat, lon, airport.lat, airport.lon);
    if (dist <= radiusKm) {
      results.push({ ...airport, distanceKm: Math.round(dist) });
    }
  }

  results.sort((a, b) => a.distanceKm - b.distanceKm);
  return results.slice(0, limit);
}

/**
 * Resolve a city name or IATA code to a list of nearby airport IATA codes.
 *
 * Resolution order:
 *   1. Direct IATA code (e.g. "LHR")
 *   2. City alias dict (e.g. "new york" → [JFK, EWR, LGA])
 *   3. airports.dat city field exact match (case-insensitive)
 *   4. airports.dat city field partial / startsWith match
 *
 * @param {string} query  — city name or IATA code
 * @param {number} radiusKm
 * @param {number} [maxAirports=3]
 * @returns {{ iata: string, name: string, city: string, distanceKm: number }[]}
 */
function resolveCity(query, radiusKm, maxAirports = 3) {
  if (!query) return [];
  const q = query.trim().toLowerCase();

  // 1. Direct IATA (3 upper-case letters)
  if (/^[a-z]{3}$/i.test(q)) {
    const airport = openFlights.getAirport(q.toUpperCase());
    if (airport && airport.lat && airport.lon) {
      const nearby = nearbyAirports(airport.lat, airport.lon, radiusKm, maxAirports);
      return nearby.length ? nearby : [{ ...airport, distanceKm: 0 }];
    }
  }

  // 2. Alias dict
  const aliasHits = CITY_ALIASES[q];
  if (aliasHits?.length) {
    // Use first hit's coordinates as the anchor
    const anchor = openFlights.getAirport(aliasHits[0]);
    if (anchor?.lat && anchor?.lon) {
      const nearby = nearbyAirports(anchor.lat, anchor.lon, radiusKm, maxAirports);
      // Merge: always include alias airports even if slightly outside radius
      const iatasInRange = new Set(nearby.map(a => a.iata));
      const extra = aliasHits
        .filter(code => !iatasInRange.has(code))
        .map(code => openFlights.getAirport(code))
        .filter(Boolean)
        .map(a => ({ ...a, distanceKm: Math.round(haversineKm(anchor.lat, anchor.lon, a.lat, a.lon)) }));
      return [...nearby, ...extra].slice(0, maxAirports);
    }
  }

  // 3. Exact city field match
  const all = openFlights.getAllAirports();
  const exact = all.filter(a => a.city?.toLowerCase() === q && a.lat && a.lon);
  if (exact.length) {
    const anchor = exact[0];
    const nearby = nearbyAirports(anchor.lat, anchor.lon, radiusKm, maxAirports);
    return nearby.length ? nearby : exact.slice(0, maxAirports).map(a => ({ ...a, distanceKm: 0 }));
  }

  // 4. Partial city match (startsWith)
  const partial = all.filter(a => a.city?.toLowerCase().startsWith(q) && a.lat && a.lon);
  if (partial.length) {
    const anchor = partial[0];
    const nearby = nearbyAirports(anchor.lat, anchor.lon, radiusKm, maxAirports);
    return nearby.length ? nearby : partial.slice(0, maxAirports).map(a => ({ ...a, distanceKm: 0 }));
  }

  return [];
}

/**
 * Search airports by query string for autocomplete (city name or IATA fragment).
 * Returns up to `limit` results. Does not need a radius.
 *
 * @param {string} query
 * @param {number} [limit=8]
 */
function searchAirports(query, limit = 8) {
  if (!query || query.length < 2) return [];
  const q = query.trim().toLowerCase();
  const all = openFlights.getAllAirports();
  const results = [];

  for (const a of all) {
    if (
      a.iata?.toLowerCase().startsWith(q) ||
      a.city?.toLowerCase().startsWith(q) ||
      a.name?.toLowerCase().includes(q)
    ) {
      results.push(a);
      if (results.length >= limit) break;
    }
  }
  return results;
}

module.exports = { haversineKm, nearbyAirports, resolveCity, searchAirports };
