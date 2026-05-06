const NodeCache = require('node-cache');

// TTL values in seconds.
//
// Tuned 2026-05-06 to maximize AirLabs API budget usage on Developer tier
// (25K calls/month). Volume-heavy AirLabs endpoints (/flights, /flight,
// /schedules) get longer TTLs since the underlying data tolerates staleness
// and observed_routes accumulation isn't time-critical at the per-call level.
const TTL = {
  flights: 10 * 60,             // 10 min — flight prices (Google Flights / Travelpayouts; their freshness expectation)
  explore: 30 * 60,             // 30 min — explore destinations (expensive fan-out)
  aircraft: 24 * 60 * 60,       // 24h — legacy, kept for callers still using it
  staticRef: 30 * 24 * 60 * 60, // 30 days — aircraft specs, airline metadata (effectively static)
  negative: 24 * 60 * 60,       // 24h — remember "not found" results so we stop hammering the API
  tpPrice: 30 * 60,             // 30 min — Travelpayouts cheap-price lookup
  tpCalendar: 60 * 60,          // 1h — Travelpayouts monthly price calendar

  // AirLabs endpoints — bumped 2026-05-06 to halve API spend on the
  // hot path. Observed_routes upsert still fires on every cache miss
  // (refresh from /flights), so accumulation continues at the new pace.
  schedules: 24 * 60 * 60,      // 24h (was 12h) — /schedules is "today's departures", stable for the day
  liveFlights: 30 * 60,         // 30 min (was 10 min) — /flights live snapshot; aircraft assignments rarely flip mid-day
  flightStatus: 30 * 60,        // 30 min (NEW) — /flight per-flight status; gate/terminal info stable enough
};

const cache = new NodeCache({ useClones: false });

/**
 * Get or fetch: returns cached value, or calls fetchFn and caches result
 */
exports.getOrFetch = async (key, fetchFn, ttl = TTL.flights) => {
  const cached = cache.get(key);
  if (cached !== undefined) {
    console.debug(`[cache] HIT  ${key}`);
    return { data: cached, fromCache: true };
  }
  console.debug(`[cache] MISS ${key}`);
  const data = await fetchFn();
  cache.set(key, data, ttl);
  return { data, fromCache: false };
};

exports.TTL = TTL;

exports.get = (key) => cache.get(key); // returns undefined if missing
exports.set = (key, value, ttl) => cache.set(key, value, ttl);

exports.stats = () => ({
  keys: cache.keys().length,
  hits: cache.getStats().hits,
  misses: cache.getStats().misses,
});

exports.flush = () => cache.flushAll();
