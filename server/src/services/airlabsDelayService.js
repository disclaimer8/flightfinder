'use strict';

const axios = require('axios');
const cacheService = require('./cacheService');

const AIRLABS_API_URL = 'https://airlabs.co/api/v9';
const TIMEOUT_MS = 10000;
const CACHE_TTL_7D = 7 * 24 * 60 * 60; // 7 days in seconds (node-cache uses seconds)
const NEGATIVE_TTL_6H = 6 * 60 * 60;   // 6 hours in seconds

const client = axios.create({ baseURL: AIRLABS_API_URL, timeout: TIMEOUT_MS });

/**
 * Aggregated delay statistics from AirLabs /flight_delays.
 * Used as fallback in delayPredictionService when local samples <10.
 *
 * Cache key: airlabs:delay:{DEP}-{ARR}-{AIRLINE} (route+airline aggregated)
 * TTL: 7 days on hit, 6h on miss.
 *
 * @param {object} params
 * @param {string} params.airline       IATA airline code (e.g. "BA")
 * @param {string} [params.flightNumber] flight number digits (kept for API stability, unused in cache key)
 * @param {string} params.dep           3-letter departure IATA
 * @param {string} params.arr           3-letter arrival IATA
 * @returns {Promise<object|null>}      aggregated stats or null
 */
async function getDelayStats({ airline, flightNumber, dep, arr } = {}) {
  const apiKey = process.env.AIRLABS_API_KEY;
  if (!apiKey) return null;
  if (!dep || !arr || dep.length !== 3 || arr.length !== 3) return null;

  const cacheKey = `airlabs:delay:${dep.toUpperCase()}-${arr.toUpperCase()}-${(airline || '').toUpperCase()}`;
  const hit = cacheService.get(cacheKey);
  if (hit !== undefined) return hit;

  try {
    const params = {
      api_key: apiKey,
      dep_iata: dep.toUpperCase(),
      arr_iata: arr.toUpperCase(),
    };
    if (airline) params.airline_iata = airline.toUpperCase();

    const res = await client.get('/flight_delays', { params });
    const rows = Array.isArray(res.data?.response) ? res.data.response : [];

    if (rows.length === 0) {
      cacheService.set(cacheKey, null, NEGATIVE_TTL_6H);
      return null;
    }

    const row = rows[0];
    const result = {
      median:    row.delay     != null ? Math.round(row.delay)          : null,
      onTimePct: row.delay_pct != null ? (1 - row.delay_pct / 100)      : null,
      cancelPct: row.cancel_pct != null ? row.cancel_pct / 100          : null,
      sample:    row.flights_count || null,
      source:    'airlabs',
    };

    cacheService.set(cacheKey, result, CACHE_TTL_7D);
    return result;
  } catch (err) {
    console.warn(
      `[airlabs] getDelayStats failed for ${dep}-${arr}/${airline}: ${err?.response?.status ?? err.message}`,
    );
    cacheService.set(cacheKey, null, NEGATIVE_TTL_6H);
    return null;
  }
}

module.exports = { getDelayStats };
