'use strict';

const axios = require('axios');
const https = require('https');
const cacheService = require('./cacheService');
const db = require('../models/db');
const adsbdbService = require('./adsbdbService');

// adsb.lol — free, global ADS-B feed. Commercial use OK under ODbL (attribution required).
// One endpoint we still use:
//   GET  /v2/type/{icao_type}            -> live aircraft of that type worldwide
// Callsign → (dep, arr) resolution moved to adsbdbService (2026-05-19) after
// adsb.lol's POST /api/0/routeset began returning HTTP 201 with empty bodies.
const ADSBLOL_V2_URL  = 'https://api.adsb.lol/v2';

// Single keep-alive agent with a bounded pool. Without this, each axios call
// spawned a fresh TLS socket whose 'error'/'close' listeners stacked up on the
// shared default agent — MaxListenersExceededWarning every ~20 min cycle and
// eventual PM2 restart under memory pressure. Reusing one agent with a capped
// maxSockets keeps the listener count deterministic and trims TLS handshakes.
const adsblolAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 8,
  maxFreeSockets: 4,
  timeout: 30000,
});

const adsblolClient = axios.create({
  timeout: 15000,
  httpsAgent: adsblolAgent,
});

const ADSBDB_CONCURRENCY = 4;
const ADSBDB_PER_REQUEST_DELAY_MS = 250;

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

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
 * Resolve a batch of planes (with callsigns) into (dep, arr) IATA pairs
 * by calling adsbdbService.resolveCallsign once per plane, with a small
 * worker pool to stay polite to upstream.
 *
 * @param {Array<{callsign:string, lat:number, lng:number}>} planes
 * @returns {Promise<Array<{callsign:string, depIata:string, arrIata:string, depIcao:string|null, arrIcao:string|null, airlineCode:string|null}>>}
 */
exports.resolveRoutes = async (planes) => {
  if (!exports.isEnabled()) return [];
  if (!Array.isArray(planes) || planes.length === 0) return [];

  const seen = new Set();
  const queue = [];
  for (const p of planes) {
    if (!p || !p.callsign) continue;
    if (seen.has(p.callsign)) continue;
    seen.add(p.callsign);
    queue.push(p);
  }
  const out = [];

  async function worker() {
    let first = true;
    while (queue.length) {
      if (!first) await sleep(ADSBDB_PER_REQUEST_DELAY_MS);
      first = false;
      const p = queue.shift();
      if (!p || !p.callsign) continue;
      let r = null;
      try {
        r = await adsbdbService.resolveCallsign(p.callsign);
      } catch (err) {
        console.warn(`[adsblol] resolveCallsign(${p.callsign}) threw: ${err?.response?.status ?? err.message}`);
      }
      if (r) {
        out.push({
          callsign:    p.callsign,
          depIata:     r.depIata,
          arrIata:     r.arrIata,
          depIcao:     r.depIcao,
          arrIcao:     r.arrIcao,
          airlineCode: r.airlineIcao || r.airlineIata || null,
        });
      }
    }
  }

  const workers = Array.from({ length: ADSBDB_CONCURRENCY }, worker);
  await Promise.all(workers);
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

  if (planes.length > 0 && persisted === 0) {
    console.warn(`[adsblol] silent-fail tripwire: type=${type} fetched=${planes.length} resolved=${routes.length} persisted=0 — adsbdb may be down or returning only negatives`);
  }

  return { fetched: planes.length, resolved: routes.length, persisted };
};
