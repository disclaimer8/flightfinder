'use strict';

const axios = require('axios');
const cacheService = require('./cacheService');
const aircraftDbService = require('./aircraftDbService');
const db = require('../models/db');

// AeroDataBox REST API via RapidAPI.
//   Free tier: 600 units/month, 2400 req/month, 1 req/sec throttle.
//   Airport-window endpoint costs 2 units/call (max 12h window).
//   Flight-by-number endpoint costs 1 unit/call.
const ADB_HOST = 'aerodatabox.p.rapidapi.com';
const ADB_BASE = `https://${ADB_HOST}`;

const adbClient = axios.create({
  timeout: 15000,
  baseURL: ADB_BASE,
});

// ── Rate limiter ────────────────────────────────────────────────────────────
// Single module-level gate: enforces min 1.1s between any two outbound calls
// (safety margin above their 1 req/sec quota). Chained promise so concurrent
// callers serialise cleanly instead of stampeding.
const MIN_INTERVAL_MS = 1100;
let _lastCall = 0;
let _chain = Promise.resolve();

function throttled(fn) {
  _chain = _chain.then(async () => {
    const wait = Math.max(0, MIN_INTERVAL_MS - (Date.now() - _lastCall));
    if (wait) await new Promise((r) => setTimeout(r, wait));
    _lastCall = Date.now();
    return fn();
  });
  return _chain;
}

/** Feature flag — true iff the RapidAPI key is configured. */
exports.isEnabled = () => !!process.env.RAPIDAPI_KEY;

function authHeaders() {
  return {
    'X-RapidAPI-Key': process.env.RAPIDAPI_KEY,
    'X-RapidAPI-Host': ADB_HOST,
  };
}

// ── Normalisation helpers ──────────────────────────────────────────────────

/**
 * Resolve ICAO type from the local aircraft_db (hex → type) with AeroDataBox
 * response as a fallback for `reg` and human-readable `model`. Also writes
 * through to observed_routes when we have a full (dep, arr, icao_type) triple,
 * so future route-map queries benefit from the fresh observation.
 */
function enrichAircraft(ac, depIata, arrIata) {
  const raw = ac || {};
  const hex = typeof raw.modeS === 'string' ? raw.modeS.toLowerCase() : null;
  let icaoType = null;
  let reg = typeof raw.reg === 'string' ? raw.reg : null;

  if (hex) {
    const resolved = aircraftDbService.resolveIcaoType(hex);
    if (resolved) {
      icaoType = resolved.icaoType || null;
      if (!reg && resolved.reg) reg = resolved.reg;
    }
  }

  const model = typeof raw.model === 'string' ? raw.model : null;

  // Best-effort write-through — never throw out of here.
  if (icaoType && depIata && arrIata) {
    try {
      db.upsertObservedRoute({
        depIata,
        arrIata,
        aircraftIcao: icaoType,
        airlineIata: null,
      });
    } catch (e) {
      console.warn('[aerodatabox] observed_routes upsert failed:', e.message);
    }
  }

  return { icaoType, reg, model, hex };
}

function normaliseFlight(f) {
  const dep = f?.departure || {};
  const arr = f?.arrival || {};
  const depIata = dep.airport?.iata || null;
  const arrIata = arr.airport?.iata || null;
  return {
    number: typeof f?.number === 'string' ? f.number.replace(/\s+/g, '') : null,
    airline: {
      iata: f?.airline?.iata || null,
      icao: f?.airline?.icao || null,
      name: f?.airline?.name || null,
    },
    dep: {
      iata: depIata,
      scheduledUtc: dep.scheduledTime?.utc || null,
      scheduledLocal: dep.scheduledTime?.local || null,
      terminal: dep.terminal || null,
    },
    arr: {
      iata: arrIata,
      scheduledUtc: arr.scheduledTime?.utc || null,
      scheduledLocal: arr.scheduledTime?.local || null,
      terminal: arr.terminal || null,
    },
    aircraft: enrichAircraft(f?.aircraft, depIata, arrIata),
    status: f?.status || null,
    codeshareStatus: f?.codeshareStatus || null,
    isCargo: !!f?.isCargo,
  };
}

// Airport-window endpoint uses a different schema: each item has a single
// `movement` block describing the OTHER endpoint. With direction=Departure,
// `movement` is the arrival; the queried airport is the departure (implicit).
function normaliseMovement(f, queriedIata, direction) {
  const m = f?.movement || {};
  const otherIata = m.airport?.iata || null;
  const isDeparture = direction === 'Departure';
  const depIata = isDeparture ? queriedIata : otherIata;
  const arrIata = isDeparture ? otherIata : queriedIata;
  const depTime = isDeparture ? {} : (m.scheduledTime || {});
  const arrTime = isDeparture ? (m.scheduledTime || {}) : {};
  const depTerm  = isDeparture ? null : (m.terminal || null);
  const arrTerm  = isDeparture ? (m.terminal || null) : null;
  return {
    number: typeof f?.number === 'string' ? f.number.replace(/\s+/g, '') : null,
    airline: {
      iata: f?.airline?.iata || null,
      icao: f?.airline?.icao || null,
      name: f?.airline?.name || null,
    },
    dep: {
      iata: depIata,
      scheduledUtc: depTime.utc || null,
      scheduledLocal: depTime.local || null,
      terminal: depTerm,
    },
    arr: {
      iata: arrIata,
      scheduledUtc: arrTime.utc || null,
      scheduledLocal: arrTime.local || null,
      terminal: arrTerm,
    },
    aircraft: enrichAircraft(f?.aircraft, depIata, arrIata),
    status: f?.status || null,
    codeshareStatus: f?.codeshareStatus || null,
    isCargo: !!f?.isCargo,
  };
}

// ── Public endpoints ───────────────────────────────────────────────────────

/**
 * GET /flights/number/{number}/{date}  — cost: 1 unit.
 * Returns the first segment normalised, or null on any failure (404, 429, timeout).
 */
exports.getFlightByNumber = async (flightNumber, dateYmd) => {
  if (!exports.isEnabled()) return null;
  const num = String(flightNumber || '').trim().replace(/\s+/g, '');
  const date = String(dateYmd || '').trim();
  if (!num || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;

  const cacheKey = `adb:flight:${num}:${date}`;
  const { data } = await cacheService.getOrFetch(cacheKey, async () => {
    try {
      return await throttled(async () => {
        const res = await adbClient.get(
          `/flights/number/${encodeURIComponent(num)}/${encodeURIComponent(date)}`,
          { headers: authHeaders() }
        );
        const arr = Array.isArray(res.data) ? res.data : [];
        if (!arr.length) return null;
        return normaliseFlight(arr[0]);
      });
    } catch (err) {
      const status = err?.response?.status;
      if (status === 429) {
        console.warn(`[aerodatabox] 429 rate-limited on getFlightByNumber(${num})`);
      } else {
        console.warn(`[aerodatabox] getFlightByNumber(${num}) failed: ${status || err.message}`);
      }
      return null;
    }
  }, cacheService.TTL.aircraft);

  return data;
};

/**
 * GET /flights/airports/iata/{IATA}/{fromLocal}/{toLocal}?direction=Departure...
 * Cost: 2 units per call. Window must be ≤ 12h; callers who need a full day should
 * split into two calls (we do this in the controller, not here, to keep this fn simple).
 */
exports.getAirportDepartures = async (iata, fromLocal, toLocal) => {
  if (!exports.isEnabled()) return [];
  const code = String(iata || '').toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) return [];
  if (!fromLocal || !toLocal) return [];

  // Validate window length ≤ 12h (AeroDataBox hard cap).
  const diffH = (new Date(toLocal) - new Date(fromLocal)) / 3_600_000;
  if (!Number.isFinite(diffH) || diffH <= 0 || diffH > 12) {
    console.warn(`[aerodatabox] invalid window: ${fromLocal} → ${toLocal} (${diffH}h)`);
    return [];
  }

  const cacheKey = `adb:apt:${code}:${fromLocal}:${toLocal}`;
  const { data } = await cacheService.getOrFetch(cacheKey, async () => {
    try {
      return await throttled(async () => {
        const res = await adbClient.get(
          `/flights/airports/iata/${encodeURIComponent(code)}/${encodeURIComponent(fromLocal)}/${encodeURIComponent(toLocal)}`,
          {
            headers: authHeaders(),
            params: {
              direction: 'Departure',
              withCancelled: false,
              withCodeshared: false,
              withCargo: false,
              withPrivate: false,
            },
          }
        );
        const list = Array.isArray(res.data?.departures) ? res.data.departures : [];
        return list.map((f) => normaliseMovement(f, code, 'Departure'));
      });
    } catch (err) {
      const status = err?.response?.status;
      if (status === 429) {
        console.warn(`[aerodatabox] 429 rate-limited on getAirportDepartures(${code})`);
      } else {
        console.warn(`[aerodatabox] getAirportDepartures(${code}) failed: ${status || err.message}`);
      }
      return [];
    }
  }, cacheService.TTL.aircraft);

  return Array.isArray(data) ? data : [];
};

// ── Internals exposed for tests ────────────────────────────────────────────
exports._enrichAircraft = enrichAircraft;
exports._normaliseFlight = normaliseFlight;
exports._normaliseMovement = normaliseMovement;
exports._resetThrottleForTests = () => { _lastCall = 0; _chain = Promise.resolve(); };
exports._MIN_INTERVAL_MS = MIN_INTERVAL_MS;
