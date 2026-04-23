const axios = require('axios');
const cacheService = require('./cacheService');
const db = require('../models/db');

const AIRLABS_API_URL = 'https://airlabs.co/api/v9'; // Note: AirLabs often uses /fleets or /aircraft_types for specs
const AIRLABS_API_KEY = process.env.AIRLABS_API_KEY;

if (!AIRLABS_API_KEY) {
  console.warn('⚠️  AIRLABS_API_KEY is not configured. Aircraft enrichment will be limited.');
}

const airlabsClient = axios.create({ baseURL: AIRLABS_API_URL, timeout: 15000 });

/**
 * Long-lived cache lookup with split TTLs: hits live for 30 days, misses for 24h.
 * Keeps us from burning the tight AirLabs rate limit on static reference data.
 */
async function cachedLookup(key, fetchFn) {
  const cached = cacheService.get(key);
  if (cached !== undefined) return cached;
  const value = await fetchFn();
  const ttl = value ? cacheService.TTL.staticRef : cacheService.TTL.negative;
  cacheService.set(key, value ?? null, ttl);
  return value ?? null;
}

/**
 * Get detailed aircraft information by IATA code
 * @param {string} iata - Aircraft IATA code (e.g., B737, A320)
 */
exports.getAircraftInfo = async (iata) => {
  const code = String(iata || '').toUpperCase();
  if (!code) return null;
  return cachedLookup(`airlabs:aircraft:${code}`, async () => {
    try {
      const response = await airlabsClient.get('/aircraft_types', {
        params: { iata_code: code, api_key: AIRLABS_API_KEY },
      });
      const aircraft = response.data?.response?.[0];
      if (!aircraft) return null;
      return {
        iata: aircraft.iata_code,
        icao: aircraft.icao_code,
        name: aircraft.model_name || aircraft.name,
        manufacturer: aircraft.manufacturer,
        type: classifyAircraftType(aircraft.model_name || ''),
        capacity: aircraft.capacity || null,
        range: aircraft.range || null,
        cruiseSpeed: aircraft.cruise_speed || null,
        categories: [],
      };
    } catch (error) {
      console.error('AirLabs API Error:', error.message);
      return null;
    }
  });
};

/**
 * Get multiple aircraft info
 * @param {Array} iataCodes - Array of IATA codes
 */
exports.getMultipleAircraft = async (iataCodes) => {
  try {
    if (!iataCodes || iataCodes.length === 0) return {};
    
    const uniqueIatas = [...new Set(iataCodes)];
    const promises = uniqueIatas.map(iata => exports.getAircraftInfo(iata));
    const results = await Promise.all(promises);
    
    const aircraftMap = {};
    results.forEach(aircraft => {
      if (aircraft && aircraft.iata) {
        aircraftMap[aircraft.iata] = aircraft;
      }
    });
    
    return aircraftMap;
  } catch (error) {
    console.error('AirLabs Batch Error:', error.message);
    return {};
  }
};

/**
 * Get airline information by IATA code
 * @param {string} iata - Airline IATA code
 */
exports.getAirlineInfo = async (iata) => {
  const code = String(iata || '').toUpperCase();
  if (!code) return null;
  return cachedLookup(`airlabs:airline:${code}`, async () => {
    try {
      const response = await airlabsClient.get('/airlines', {
        params: { iata_code: code, api_key: AIRLABS_API_KEY },
      });
      const airline = response.data?.response?.[0];
      if (!airline) return null;
      return {
        iata: airline.iata_code,
        icao: airline.icao_code,
        name: airline.name,
        country: airline.country_name,
      };
    } catch (error) {
      console.error('AirLabs API Error:', error.message);
      return null;
    }
  });
};

/**
 * Get multiple airline info
 * @param {Array} iataCodes - Array of airline IATA codes
 */
exports.getMultipleAirlines = async (iataCodes) => {
  try {
    if (!iataCodes || iataCodes.length === 0) return {};
    
    const uniqueIatas = [...new Set(iataCodes)];
    const promises = uniqueIatas.map(iata => exports.getAirlineInfo(iata));
    const results = await Promise.all(promises);
    
    const airlineMap = {};
    results.forEach(airline => {
      if (airline && airline.iata) {
        airlineMap[airline.iata] = airline;
      }
    });
    
    return airlineMap;
  } catch (error) {
    console.error('AirLabs Batch Airlines Error:', error.message);
    return {};
  }
};

// ── Route cache: iata → Set<arr_iata>, expires after 24h ─────────────────────
const _routesCache = new Map(); // iata → { dests: Set, fetchedAt: number }
const ROUTES_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 h

/** Exposed for tests only */
exports._clearRoutesCache = () => _routesCache.clear();

/**
 * Fetch all direct destination IATA codes from an origin airport.
 * Paginates AirLabs /routes (50 results per page, offset param).
 * Returns empty Set gracefully when key absent or on any error.
 *
 * @param {string} iata  3-letter origin IATA
 * @returns {Promise<Set<string>>}
 */
exports.getRoutes = async (iata) => {
  // Check env dynamically so tests can delete the key at runtime
  const apiKey = process.env.AIRLABS_API_KEY;
  if (!apiKey) return new Set();

  const code = iata.toUpperCase();
  const cached = _routesCache.get(code);
  if (cached && (Date.now() - cached.fetchedAt) < ROUTES_CACHE_TTL) {
    return cached.dests;
  }

  const dests = new Set();
  let offset = 0;
  const MAX_PAGES = 20;

  try {
    for (let page = 0; page < MAX_PAGES; page++) {
      const response = await airlabsClient.get('/routes', {
        params: { dep_iata: code, api_key: apiKey, offset },
      });
      const rows = response.data?.response ?? [];
      if (!rows.length) break;
      for (const row of rows) {
        if (row.arr_iata && row.arr_iata.length === 3) dests.add(row.arr_iata.toUpperCase());
      }
      offset += 50;
    }
  } catch (err) {
    console.warn(`[airlabs] getRoutes failed for ${code}:`, err.message);
    return dests;
  }

  _routesCache.set(code, { dests, fetchedAt: Date.now() });
  return dests;
};

/**
 * GET /schedules?dep_iata=X — today's scheduled departures from an airport.
 * Returns a plain array of flight rows (airline, flight_iata, arr_iata, times, status).
 * On Developer tier this is where we get realistic destination *breadth* (LHR → 161
 * unique destinations, vs /routes which is curtailed to ~9).
 *
 * IMPORTANT: aircraft_icao is NOT populated on this endpoint — enrich separately
 * via observed_routes (populated from /flights snapshots).
 *
 * Cached 12h (schedules are stable for the day). Returns [] on any error.
 */
exports.getSchedules = async (iata) => {
  const code = String(iata || '').toUpperCase();
  if (!code || code.length !== 3) return [];
  const apiKey = process.env.AIRLABS_API_KEY;
  if (!apiKey) return [];

  const cacheKey = `airlabs:schedules:${code}`;
  const hit = cacheService.get(cacheKey);
  if (hit !== undefined) return hit;

  try {
    const res = await airlabsClient.get('/schedules', {
      params: { dep_iata: code, api_key: apiKey },
    });
    const rows = Array.isArray(res.data?.response) ? res.data.response : [];
    cacheService.set(cacheKey, rows, rows.length ? cacheService.TTL.schedules : cacheService.TTL.negative);
    return rows;
  } catch (err) {
    console.warn(`[airlabs] getSchedules failed for ${code}: ${err?.response?.status ?? err.message}`);
    cacheService.set(cacheKey, [], cacheService.TTL.negative);
    return [];
  }
};

/**
 * GET /flights?dep_iata=X — live airborne snapshot. Rows carry aircraft_icao
 * with 100% coverage on Developer tier, plus reg_number / hex / lat-lng /
 * speed / airline for each bird currently in the air having departed X.
 *
 * Side effect: every non-empty response UPSERTs into `observed_routes`
 * (dep_iata, arr_iata, aircraft_icao) so that historical aircraft enrichment
 * for a route accumulates over time without burning extra API budget.
 *
 * Cached 10 min to avoid hammering the endpoint on repeated user queries.
 */
exports.getLiveFlights = async (iata) => {
  const code = String(iata || '').toUpperCase();
  if (!code || code.length !== 3) return [];
  const apiKey = process.env.AIRLABS_API_KEY;
  if (!apiKey) return [];

  const cacheKey = `airlabs:flights:${code}`;
  const hit = cacheService.get(cacheKey);
  if (hit !== undefined) return hit;

  try {
    const res = await airlabsClient.get('/flights', {
      params: { dep_iata: code, api_key: apiKey },
    });
    const rows = Array.isArray(res.data?.response) ? res.data.response : [];

    // Persist observations — bounded unique rows per (dep, arr, aircraft).
    for (const f of rows) {
      if (f.dep_iata && f.arr_iata && f.aircraft_icao && f.dep_iata.length === 3 && f.arr_iata.length === 3) {
        try {
          db.upsertObservedRoute({
            depIata: f.dep_iata.toUpperCase(),
            arrIata: f.arr_iata.toUpperCase(),
            aircraftIcao: f.aircraft_icao.toUpperCase(),
            airlineIata: f.airline_iata || null,
          });
        } catch (e) {
          // DB write failure is non-critical — never block the response.
          console.warn('[airlabs] observed_routes upsert failed:', e.message);
        }
      }
    }

    cacheService.set(cacheKey, rows, rows.length ? cacheService.TTL.liveFlights : cacheService.TTL.negative);
    return rows;
  } catch (err) {
    console.warn(`[airlabs] getLiveFlights failed for ${code}: ${err?.response?.status ?? err.message}`);
    cacheService.set(cacheKey, [], cacheService.TTL.negative);
    return [];
  }
};

/**
 * GET /v9/flight?flight_iata=BA175 — per-flight status (gate, terminal,
 * registration, aircraft type, delay, status). Replaces AeroDataBox
 * getFlightByNumber in the enrichment card; saves AeroDataBox quota.
 *
 * 1 credit per call on the AirLabs developer plan (25k/month).
 */
exports.getFlight = async (flightIata) => {
  if (!AIRLABS_API_KEY) return null;
  const key = String(flightIata || '').toUpperCase();
  if (!key) return null;
  const cacheKey = `airlabs:flight:${key}`;
  const cached = cacheService.get(cacheKey);
  if (cached !== undefined) return cached;
  try {
    const res = await airlabsClient.get('/flight', {
      params: { flight_iata: key, api_key: AIRLABS_API_KEY },
    });
    const f = res.data?.response;
    if (!f || typeof f !== 'object') {
      cacheService.set(cacheKey, null, cacheService.TTL.negative);
      return null;
    }
    cacheService.set(cacheKey, f, cacheService.TTL.liveFlights); // 10 min
    return f;
  } catch (err) {
    console.warn(`[airlabs] getFlight failed for ${key}: ${err?.response?.status ?? err.message}`);
    cacheService.set(cacheKey, null, cacheService.TTL.negative);
    return null;
  }
};

/**
 * GET /v9/airplanes?reg_number=X or ?hex=Y — per-tail fleet record.
 * Returns { hex, reg_number, icao_code_hex, airline_iata, delivered, ... }.
 * `delivered` is an ISO date from which we derive build_year.
 */
exports.getAirplane = async ({ hex, reg }) => {
  if (!AIRLABS_API_KEY) return null;
  const params = { api_key: AIRLABS_API_KEY };
  if (hex) params.hex = String(hex).toLowerCase();
  else if (reg) params.reg_number = String(reg).toUpperCase();
  else return null;

  const cacheKey = `airlabs:airplane:${params.hex || params.reg_number}`;
  const cached = cacheService.get(cacheKey);
  if (cached !== undefined) return cached;
  try {
    const res = await airlabsClient.get('/airplanes', { params });
    const rows = Array.isArray(res.data?.response) ? res.data.response : [];
    const row = rows[0] || null;
    // Fleet data barely changes — cache 30 days on hit, 24h on miss.
    const ttl = row ? cacheService.TTL.staticRef : cacheService.TTL.negative;
    cacheService.set(cacheKey, row, ttl);
    return row;
  } catch (err) {
    console.warn(`[airlabs] getAirplane failed: ${err?.response?.status ?? err.message}`);
    cacheService.set(cacheKey, null, cacheService.TTL.negative);
    return null;
  }
};

/**
 * Classify aircraft into a high-level type based on its model/name
 */
function classifyAircraftType(name = '') {
  const nameLower = String(name).toLowerCase();
  
  if (nameLower.includes('dash') || nameLower.includes('atr') || nameLower.includes('prop')) {
    return 'turboprop';
  }
  if (nameLower.includes('crj') || nameLower.includes('e170') || nameLower.includes('e175') || nameLower.includes('e190') || nameLower.includes('erj')) {
    return 'regional';
  }
  if (nameLower.includes('777') || nameLower.includes('787') || nameLower.includes('a350') || nameLower.includes('a380') || nameLower.includes('747') || nameLower.includes('330')) {
    return 'wide-body';
  }
  if (nameLower.includes('737') || nameLower.includes('a320') || nameLower.includes('a319') || nameLower.includes('a321') || nameLower.includes('757')) {
    return 'jet';
  }
  
  return 'jet'; // Default fallback
}
