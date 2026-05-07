const google = require('./googleFlightsService');
const ita = require('./itaMatrixService');
const tpAdapter = require('./travelpayoutsAdapter');
const cache = require('./cacheService');

const TTL_FRESH = (cache.TTL && cache.TTL.flights) || 600;        // 10 min
const TTL_STALE = 24 * 60 * 60;                                    // 24h

function cacheKey(params) {
  const { departure, arrival, date, returnDate, passengers, cabin = 'economy', flexDates = false } = params;
  // cabin and flexDates change which flights/prices come back, so they must be
  // part of the cache key — otherwise an economy search poisons the business
  // cabin cache (and vice versa).
  return `flights:${departure}:${arrival}:${date}:${returnDate || ''}:${passengers || 1}:${cabin}:${flexDates ? 'flex' : 'exact'}`;
}

function staleKey(params) {
  return 'stale:' + cacheKey(params);
}

function nonEmpty(arr) {
  return Array.isArray(arr) && arr.length > 0;
}

function expandDateRange(anchorDate) {
  const dates = [];
  const base = new Date(anchorDate + 'T00:00:00Z');
  for (let offset = -3; offset <= 3; offset++) {
    const d = new Date(base.getTime() + offset * 86400000);
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

function dedupeFlights(flights) {
  const seen = new Map();
  for (const f of flights) {
    const key = `${f.carrier || ''}|${f.flightNo || f.flightNumber || ''}|${f.departureTime || f.depTime || ''}`;
    if (!seen.has(key)) seen.set(key, f);
  }
  return [...seen.values()];
}

/**
 * Run the fallback chain for a single day and return { flights, source }.
 * Never throws — orchestration errors get squashed into source: 'none'.
 *
 * Source semantics:
 * - service.search(params) returns NormalizedFlight[] | null
 * - null = transport/upstream failure → advance to next source
 * - [] = upstream said "no results for this query" → advance (we treat empty
 *        the same as null for the purpose of fallback; orchestrator's job is
 *        to give the user SOMETHING, even if upstream legitimately had nothing)
 */
async function runSingleDaySearch(params) {
  const key = cacheKey(params);
  const fresh = cache.get(key);
  if (nonEmpty(fresh)) return { flights: fresh, source: 'cache' };

  const candidates = [
    { name: 'google',        run: () => google.search(params) },
    { name: 'ita',           run: () => ita.search(params) },
    { name: 'travelpayouts', run: () => tpAdapter.search(params) },
  ];

  for (const c of candidates) {
    let result;
    try {
      result = await c.run();
    } catch (err) {
      console.warn(`[orchestrator] ${c.name} threw:`, err && err.message);
      result = null;
    }
    if (nonEmpty(result)) {
      cache.set(key, result, TTL_FRESH);
      cache.set(staleKey(params), result, TTL_STALE);
      return { flights: result, source: c.name };
    }
  }

  const stale = cache.get(staleKey(params));
  if (nonEmpty(stale)) return { flights: stale, source: 'stale-cache' };

  return { flights: [], source: 'none' };
}

exports.search = async ({
  departure, arrival, date, returnDate, passengers,
  cabin = 'economy', flexDates = false,
} = {}) => {
  if (!flexDates) {
    return runSingleDaySearch({ departure, arrival, date, returnDate, passengers, cabin, flexDates: false });
  }

  // Fan-out path — share a single cache entry for the merged 7-day result.
  const flexParams = { departure, arrival, date, returnDate, passengers, cabin, flexDates: true };
  const flexKey = cacheKey(flexParams);
  const fresh = cache.get(flexKey);
  if (nonEmpty(fresh)) return { flights: fresh, source: 'cache' };

  const dates = expandDateRange(date);
  const results = await Promise.all(
    dates.map(d => runSingleDaySearch({
      departure, arrival, date: d, returnDate, passengers, cabin, flexDates: false,
    }))
  );

  const merged = results.flatMap(r => r?.flights || []);
  const flights = dedupeFlights(merged);

  // Source label: pick the most-authoritative source represented.
  const sourcePriority = ['google', 'ita', 'travelpayouts', 'cache', 'stale-cache', 'none'];
  const sources = results.map(r => r?.source).filter(Boolean);
  const source = sourcePriority.find(s => sources.includes(s)) || 'none';

  if (nonEmpty(flights)) {
    cache.set(flexKey, flights, TTL_FRESH);
    cache.set(staleKey(flexParams), flights, TTL_STALE);
  }

  return { flights, source };
};
