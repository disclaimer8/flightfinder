'use strict';

/**
 * airlabsFleetService — per-tail worldwide fleet data via AirLabs /fleets.
 *
 * Endpoint: GET https://airlabs.co/api/v9/fleets
 * Filters:  hex | reg_number
 *
 * Response fields used:
 *   hex, reg_number, flag, airline_iata, airline_icao,
 *   icao (type code), iata (type code), model, manufacturer,
 *   type, category, engine, engine_count,
 *   built (year int), age (years float), msn, line,
 *   lat, lng, alt, last_seen
 *
 * Cache: 30 days on hit (fleet data is static), 24h on miss.
 */

const axios = require('axios');
const cacheService = require('./cacheService');
const openFlights = require('./openFlightsService');

const AIRLABS_API_URL = 'https://airlabs.co/api/v9';

const airlabsClient = axios.create({ baseURL: AIRLABS_API_URL, timeout: 15000 });

/**
 * Look up per-tail fleet record from AirLabs /fleets.
 *
 * @param {object} opts
 * @param {string} [opts.hex]  - ICAO 24-bit transponder hex (e.g. "76CDC2")
 * @param {string} [opts.reg]  - Registration number (e.g. "9V-SNB")
 * @returns {Promise<object|null>}
 */
exports.getFleetRecord = async ({ hex, reg } = {}) => {
  const apiKey = process.env.AIRLABS_API_KEY;
  if (!apiKey) return null;

  // Prefer hex lookup; fall back to registration.
  const lookupKey = hex
    ? String(hex).toUpperCase()
    : reg
      ? String(reg).toUpperCase()
      : null;

  if (!lookupKey) return null;

  const cacheKey = `airlabs:fleet:${lookupKey}`;
  const cached = cacheService.get(cacheKey);
  if (cached !== undefined) return cached;

  try {
    const params = { api_key: apiKey };
    if (hex) {
      params.hex = String(hex).toLowerCase(); // AirLabs hex is lowercase
    } else {
      params.reg_number = String(reg).toUpperCase();
    }

    const res = await airlabsClient.get('/fleets', { params });
    const rows = Array.isArray(res.data?.response) ? res.data.response : [];
    const row = rows[0] || null;

    if (!row) {
      cacheService.set(cacheKey, null, cacheService.TTL.negative);
      return null;
    }

    // Resolve age: prefer response `age` field, else compute from `built`.
    let ageYears = null;
    if (row.age != null && Number.isFinite(Number(row.age))) {
      ageYears = Math.round(Number(row.age));
    } else if (row.built != null) {
      const buildYear = parseInt(row.built, 10);
      if (!isNaN(buildYear) && buildYear > 1940) {
        ageYears = new Date().getFullYear() - buildYear;
      }
    }

    // Resolve airline name from OpenFlights (mirrors pattern in airlabsService.js).
    const airlineIata = row.airline_iata || null;
    const airlineName = airlineIata
      ? (openFlights.getAirline(airlineIata)?.name || null)
      : null;

    const result = {
      hex: row.hex || null,
      reg_number: row.reg_number || null,
      icao_type: row.icao || null,   // AirLabs uses `icao` for the aircraft type ICAO code
      iata_type: row.iata || null,   // and `iata` for the IATA type code
      airline_iata: airlineIata,
      airline_name: airlineName,
      model: row.model || null,
      manufacturer: row.manufacturer || null,
      build_year: row.built ? parseInt(row.built, 10) : null,
      age_years: ageYears,
      last_seen: row.last_seen || null,
    };

    cacheService.set(cacheKey, result, cacheService.TTL.staticRef); // 30 days
    return result;
  } catch (err) {
    console.warn(`[airlabsFleet] getFleetRecord failed for ${lookupKey}: ${err?.response?.status ?? err.message}`);
    cacheService.set(cacheKey, null, cacheService.TTL.negative);
    return null;
  }
};
