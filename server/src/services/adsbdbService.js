'use strict';

const axios = require('axios');
const https = require('https');
const { db } = require('../models/db');

// adsbdb.com — community ADS-B callsign → route resolver under ODbL.
// Free tier; polite rate limiting is on us. We per-callsign GET against
// /v0/callsign/{cs} and persist results in adsbdb_callsign_cache so we
// don't hammer the upstream after pm2 reloads.

const BASE_URL    = 'https://api.adsbdb.com/v0';
const POS_TTL_MS  = 7 * 24 * 60 * 60 * 1000;  // resolved routes
const NEG_TTL_MS  =     24 * 60 * 60 * 1000;  // 404s (callsign has no flightroute)
const RETRY_429_MS = 10 * 1000;

const adsbdbAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 4,
  maxFreeSockets: 2,
  timeout: 15000,
});

const adsbdbClient = axios.create({
  timeout: 10000,
  httpsAgent: adsbdbAgent,
});

function normCallsign(cs) {
  return String(cs || '').trim().toUpperCase();
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

exports.isEnabled = () => process.env.ADSBDB_ENABLED !== '0';

/**
 * Resolve a callsign to its (dep, arr) airports via adsbdb.com.
 * Returns null when unresolvable. Caches both positive and negative results.
 *
 * @param {string} callsign
 * @returns {Promise<{depIata:string, arrIata:string, depIcao:string|null, arrIcao:string|null, airlineIata:string|null, airlineIcao:string|null} | null>}
 */
exports.resolveCallsign = async (callsign) => {
  if (!exports.isEnabled()) return null;
  const cs = normCallsign(callsign);
  if (!cs) return null;

  // Cache lookup (fresh entries only)
  const cached = db.prepare(
    'SELECT * FROM adsbdb_callsign_cache WHERE callsign = ? AND expires_at > ?'
  ).get(cs, Date.now());
  if (cached) {
    if (cached.dep_iata == null) return null; // negative cache hit
    return {
      depIata:     cached.dep_iata,
      arrIata:     cached.arr_iata,
      depIcao:     cached.dep_icao,
      arrIcao:     cached.arr_icao,
      airlineIata: cached.airline_iata,
      airlineIcao: cached.airline_icao,
    };
  }

  // Live fetch
  const fetchOnce = () => adsbdbClient.get(`${BASE_URL}/callsign/${encodeURIComponent(cs)}`);
  let resp;
  try {
    resp = await fetchOnce();
  } catch (err) {
    const status = err?.response?.status;
    if (status === 404) {
      writeCache(cs, null, NEG_TTL_MS);
      return null;
    }
    if (status === 429) {
      await sleep(RETRY_429_MS);
      try {
        resp = await fetchOnce();
      } catch (err2) {
        console.warn(`[adsbdb] 429 after retry for ${cs}: ${err2?.response?.status ?? err2.message}`);
        return null;
      }
    } else {
      console.warn(`[adsbdb] resolveCallsign(${cs}) failed: ${status ?? err.message}`);
      return null;
    }
  }

  const route = resp?.data?.response?.flightroute;
  if (!route || !route.origin?.iata_code || !route.destination?.iata_code) {
    console.warn(`[adsbdb] malformed 200 for ${cs} (missing iata_code) — not caching`);
    return null;
  }

  const parsed = {
    depIata:     route.origin.iata_code,
    arrIata:     route.destination.iata_code,
    depIcao:     route.origin.icao_code || null,
    arrIcao:     route.destination.icao_code || null,
    airlineIata: route.airline?.iata || null,
    airlineIcao: route.airline?.icao || null,
  };
  writeCache(cs, parsed, POS_TTL_MS);
  return parsed;
};

function writeCache(cs, parsed, ttlMs) {
  const now = Date.now();
  const expires = now + ttlMs;
  db.prepare(`
    INSERT INTO adsbdb_callsign_cache
      (callsign, dep_iata, arr_iata, dep_icao, arr_icao, airline_iata, airline_icao, resolved_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(callsign) DO UPDATE SET
      dep_iata=excluded.dep_iata,
      arr_iata=excluded.arr_iata,
      dep_icao=excluded.dep_icao,
      arr_icao=excluded.arr_icao,
      airline_iata=excluded.airline_iata,
      airline_icao=excluded.airline_icao,
      resolved_at=excluded.resolved_at,
      expires_at=excluded.expires_at
  `).run(
    cs,
    parsed?.depIata ?? null,
    parsed?.arrIata ?? null,
    parsed?.depIcao ?? null,
    parsed?.arrIcao ?? null,
    parsed?.airlineIata ?? null,
    parsed?.airlineIcao ?? null,
    now, expires,
  );
}
