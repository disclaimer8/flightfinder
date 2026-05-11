const { getClient, isEnabled } = require('./amadeusClient');
const cache = require('../models/amadeusCache');

// Production reality (verified 2026-05-11 against self-service prod app):
//   ✓ airport_direct_dest  — works
//   ✓ airline_routes       — works
//   ✗ most_traveled        — 404 "Resource not found" (deprecated for self-service)
//   ✗ most_booked          — 404 (same)
//   ✗ travel_recs          — 410 GONE "API is decommissioned"
// Only the two surviving endpoints are kept here. If Amadeus reanimates the
// analytics endpoints, restore them as a follow-up.
const TTL = {
  airport_direct_dest: 30 * 24 * 60 * 60 * 1000,
  airline_routes:      30 * 24 * 60 * 60 * 1000,
};

function isLeader() {
  return !process.env.NODE_APP_INSTANCE || process.env.NODE_APP_INSTANCE === '0';
}

function budgetCap() {
  return parseInt(process.env.AMADEUS_DAILY_BUDGET_CALLS || '1000', 10);
}

function budgetExceeded() {
  return cache.todayBudget().calls >= budgetCap();
}

// In-memory circuit breaker for auth failures — opens for 1h after first 401/403.
let circuitOpenUntil = 0;
let budgetWarnedToday = '';
function circuitOpen() { return Date.now() < circuitOpenUntil; }
function openCircuit() { circuitOpenUntil = Date.now() + 60 * 60 * 1000; }

function staleOrNull(endpoint, key) {
  const row = cache.get(endpoint, key);
  return row ? row.payload : null;
}

async function fetchAndCache(endpoint, key, ttlMs, sdkCall, parse) {
  if (!isEnabled())  return staleOrNull(endpoint, key);
  if (!isLeader())   return staleOrNull(endpoint, key);
  if (circuitOpen()) return staleOrNull(endpoint, key);

  if (budgetExceeded()) {
    const today = new Date().toISOString().slice(0, 10);
    if (budgetWarnedToday !== today) {
      console.warn(`[amadeus-analytics] daily budget cap reached (${cache.todayBudget().calls} calls)`);
      budgetWarnedToday = today;
    }
    return staleOrNull(endpoint, key);
  }

  let response;
  try {
    response = await sdkCall();
  } catch (err) {
    cache.incrementBudget(0, 1);
    const status = err?.response?.statusCode || err?.code;
    if (status === 401 || status === 403) {
      openCircuit();
      console.warn(`[amadeus-analytics] auth error (${status}) — circuit open for 1h`);
    } else if (status === 429) {
      console.warn(`[amadeus-analytics] quota exceeded (429) on ${endpoint}/${key}`);
    } else {
      console.warn(`[amadeus-analytics] ${endpoint}/${key} failed: ${err.message}`);
    }
    return staleOrNull(endpoint, key);
  }

  cache.incrementBudget(1, 0);
  const payload = parse(response);
  if (payload != null) cache.put(endpoint, key, payload, ttlMs);
  return payload;
}

async function readOrFetch(endpoint, key, sdkCall, parse) {
  const row = cache.get(endpoint, key);
  if (row && row.fresh) return row.payload;
  return fetchAndCache(endpoint, key, TTL[endpoint], sdkCall, parse);
}

// ─────────── Public methods ───────────

async function getAirportDirectDestinations(iata) {
  const key = iata.toUpperCase();
  return readOrFetch('airport_direct_dest', key,
    () => getClient().airport.directDestinations.get({ departureAirportCode: key }),
    (r) => (r.data || []).map(x => x.iataCode).filter(Boolean));
}

async function getAirlineRoutes(iata) {
  const key = iata.toUpperCase();
  return readOrFetch('airline_routes', key,
    () => getClient().airline.destinations.get({ airlineCode: key }),
    (r) => (r.data || []).map(x => x.iataCode).filter(Boolean));
}

/**
 * Leader-only walk over the SEO enumeration sources (top airports, top airlines)
 * to refresh stale or missing rows in amadeus_cache. Budget-capped via
 * AMADEUS_DAILY_BUDGET_CALLS — exits early once today's calls cross the cap.
 * Follower workers (NODE_APP_INSTANCE !== '0') return a zero-result no-op.
 *
 * @param {object} [opts]
 * @param {number} [opts.airportLimit=200]
 * @param {number} [opts.airlineLimit=100]
 * @returns {Promise<{refreshed:number, skipped:number, failed:number, reason?:string}>}
 */
async function refreshStale({ airportLimit = 200, airlineLimit = 100 } = {}) {
  if (!isLeader())  return { refreshed: 0, skipped: 0, failed: 0, reason: 'follower' };
  if (!isEnabled()) return { refreshed: 0, skipped: 0, failed: 0, reason: 'disabled' };

  const db = require('../models/db');
  const airports = (db.getTopAirportsByObservedActivity?.({ limit: airportLimit }) ?? [])
    .map(a => a.iata).filter(Boolean);
  const airlines = (db.getTopAirlinesByObservedActivity?.({ limit: airlineLimit }) ?? [])
    .map(a => a.iata).filter(Boolean);

  let refreshed = 0, skipped = 0, failed = 0;

  async function call(fn) {
    if (budgetExceeded()) return;
    const before = cache.todayBudget().calls;
    const result = await fn();
    const after = cache.todayBudget().calls;
    if (after > before)         refreshed++;
    else if (result == null)    failed++;
    else                        skipped++;
  }

  for (const iata of airports) {
    if (budgetExceeded()) break;
    await call(() => getAirportDirectDestinations(iata));
  }
  for (const iata of airlines) {
    if (budgetExceeded()) break;
    await call(() => getAirlineRoutes(iata));
  }

  console.log(`[amadeus-analytics] refreshStale: refreshed=${refreshed} skipped=${skipped} failed=${failed} budget=${cache.todayBudget().calls}`);
  return { refreshed, skipped, failed };
}

module.exports = {
  getAirportDirectDestinations,
  getAirlineRoutes,
  refreshStale,
  _resetCircuitForTests: () => { circuitOpenUntil = 0; budgetWarnedToday = ''; },
  _TTL: TTL,
};
