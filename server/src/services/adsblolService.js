'use strict';

const axios = require('axios');
const cacheService = require('./cacheService');
const db = require('../models/db');

// adsb.lol — free, global ADS-B feed. Commercial use OK under ODbL (attribution required).
// Two endpoints we use:
//   GET  /v2/type/{icao_type}            -> live aircraft of that type worldwide
//   POST /api/0/routeset                 -> resolve callsigns -> (dep, arr) IATA pairs
const ADSBLOL_V2_URL  = 'https://api.adsb.lol/v2';
const ADSBLOL_API_URL = 'https://api.adsb.lol';

const adsblolClient = axios.create({ timeout: 15000 });

const ROUTESET_BATCH_SIZE = 100;

/** Feature flag — service is opt-in via env. */
exports.isEnabled = () => process.env.ADSBLOL_ENABLED === '1';

/**
 * GET /v2/type/{icao_type} — live aircraft of the given ICAO type code.
 * Returns a normalized array of valid entries (callsign + lat/lng present).
 * Cached 10 min to avoid hammering the endpoint on repeated worker ticks / manual calls.
 */
exports.getAircraftByType = async (icaoType) => {
  if (!exports.isEnabled()) return [];
  const type = String(icaoType || '').toUpperCase();
  if (!type) return [];

  const cacheKey = `adsblol:type:${type}`;
  const hit = cacheService.get(cacheKey);
  if (hit !== undefined) return hit;

  try {
    const res = await adsblolClient.get(`${ADSBLOL_V2_URL}/type/${encodeURIComponent(type)}`);
    const raw = Array.isArray(res.data?.ac) ? res.data.ac : [];
    const planes = [];
    for (const a of raw) {
      const callsign = typeof a.flight === 'string' ? a.flight.trim() : '';
      if (!callsign) continue;
      if (a.lat == null || a.lon == null) continue;
      const lat = Number(a.lat);
      const lng = Number(a.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      planes.push({
        callsign,
        lat,
        lng,
        type,
        hex: a.hex || null,
        reg: a.r || null,
      });
    }
    cacheService.set(cacheKey, planes, planes.length ? cacheService.TTL.liveFlights : cacheService.TTL.negative);
    return planes;
  } catch (err) {
    console.warn(`[adsblol] getAircraftByType failed for ${type}: ${err?.response?.status ?? err.message}`);
    cacheService.set(cacheKey, [], cacheService.TTL.negative);
    return [];
  }
};

/**
 * POST /api/0/routeset — resolve a batch of callsigns into (dep, arr) IATA pairs.
 * Splits input into batches of 100 and aggregates results.
 * Skips entries whose _airport_codes_iata contains "unknown" (unresolved).
 *
 * @param {Array<{callsign:string, lat:number, lng:number}>} planes
 * @returns {Promise<Array<{callsign:string, depIata:string, arrIata:string, depIcao:string|null, arrIcao:string|null, airlineCode:string|null}>>}
 */
exports.resolveRoutes = async (planes) => {
  if (!exports.isEnabled()) return [];
  if (!Array.isArray(planes) || planes.length === 0) return [];

  const out = [];
  for (let i = 0; i < planes.length; i += ROUTESET_BATCH_SIZE) {
    const batch = planes.slice(i, i + ROUTESET_BATCH_SIZE).map(p => ({
      callsign: p.callsign,
      lat: p.lat,
      lng: p.lng,
    }));

    let rows;
    try {
      const res = await adsblolClient.post(`${ADSBLOL_API_URL}/api/0/routeset`, { planes: batch });
      rows = Array.isArray(res.data) ? res.data : [];
    } catch (err) {
      console.warn(`[adsblol] resolveRoutes batch failed: ${err?.response?.status ?? err.message}`);
      continue; // move on to next batch
    }

    for (const r of rows) {
      const codes = typeof r._airport_codes_iata === 'string' ? r._airport_codes_iata : '';
      if (!codes || codes.toLowerCase().includes('unknown')) continue;
      const parts = codes.split('-');
      if (parts.length !== 2) continue;
      const depIata = parts[0].toUpperCase();
      const arrIata = parts[1].toUpperCase();
      if (depIata.length !== 3 || arrIata.length !== 3) continue;

      const airports = Array.isArray(r._airports) ? r._airports : [];
      out.push({
        callsign: typeof r.callsign === 'string' ? r.callsign.trim() : '',
        depIata,
        arrIata,
        depIcao: airports[0]?.icao || null,
        arrIcao: airports[1]?.icao || null,
        airlineCode: r.airline_code || null,
      });
    }
  }
  return out;
};

/**
 * High-level pull: aircraft-of-type snapshot → route resolve → UPSERT observed_routes.
 * The `aircraft_icao` on every row we persist is the queried ICAO type (not a per-plane
 * lookup) because the /v2/type endpoint guarantees every returned aircraft is of that type.
 *
 * Returns {fetched, resolved, persisted} counts for worker logging.
 */
exports.pullAndPersistType = async (icaoType) => {
  if (!exports.isEnabled()) return { fetched: 0, resolved: 0, persisted: 0 };
  const type = String(icaoType || '').toUpperCase();
  if (!type) return { fetched: 0, resolved: 0, persisted: 0 };

  const planes = await exports.getAircraftByType(type);
  if (planes.length === 0) return { fetched: 0, resolved: 0, persisted: 0 };

  const routes = await exports.resolveRoutes(planes);
  let persisted = 0;
  for (const r of routes) {
    try {
      db.upsertObservedRoute({
        depIata: r.depIata,
        arrIata: r.arrIata,
        aircraftIcao: type,
        airlineIata: r.airlineCode || null,
      });
      persisted++;
    } catch (e) {
      // Never throw out of the worker loop — observation writes are best-effort.
      console.warn('[adsblol] observed_routes upsert failed:', e.message);
    }
  }

  return { fetched: planes.length, resolved: routes.length, persisted };
};
