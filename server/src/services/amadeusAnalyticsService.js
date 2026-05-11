const { getClient, isEnabled } = require('./amadeusClient');
const cache = require('../models/amadeusCache');

const TTL = {
  airport_direct_dest: 30 * 24 * 60 * 60 * 1000,
  airline_routes:      30 * 24 * 60 * 60 * 1000,
  most_traveled:       30 * 24 * 60 * 60 * 1000,
  most_booked:         30 * 24 * 60 * 60 * 1000,
  travel_recs:         14 * 24 * 60 * 60 * 1000,
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

async function getMostTraveled(originIata, period) {
  const key = `${originIata.toUpperCase()}:${period}`;
  return readOrFetch('most_traveled', key,
    () => getClient().travel.analytics.airTraffic.traveled.get({
      originCityCode: originIata.toUpperCase(),
      period,
    }),
    (r) => r.data || []);
}

async function getMostBooked(originIata, period) {
  const key = `${originIata.toUpperCase()}:${period}`;
  return readOrFetch('most_booked', key,
    () => getClient().travel.analytics.airTraffic.booked.get({
      originCityCode: originIata.toUpperCase(),
      period,
    }),
    (r) => r.data || []);
}

async function getTravelRecommendations(cityCodes, travelerCountryCode) {
  const sorted = [...cityCodes].map(s => s.toUpperCase()).sort();
  const key = `${sorted.join(',')}|${(travelerCountryCode || '').toUpperCase()}`;
  return readOrFetch('travel_recs', key,
    () => getClient().referenceData.recommendedLocations.get({
      cityCodes: sorted.join(','),
      travelerCountryCode: travelerCountryCode || 'US',
    }),
    (r) => r.data || []);
}

async function refreshStale(_opts = {}) {
  // Implemented in Phase C. Stubbed here so warm() hook is safe to add early.
  return { refreshed: 0, skipped: 0, failed: 0 };
}

module.exports = {
  getAirportDirectDestinations,
  getAirlineRoutes,
  getMostTraveled,
  getMostBooked,
  getTravelRecommendations,
  refreshStale,
  _resetCircuitForTests: () => { circuitOpenUntil = 0; budgetWarnedToday = ''; },
  _TTL: TTL,
};
