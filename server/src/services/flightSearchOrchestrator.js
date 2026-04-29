const google = require('./googleFlightsService');
const ita = require('./itaMatrixService');
const tpAdapter = require('./travelpayoutsAdapter');
const cache = require('./cacheService');

const TTL_FRESH = (cache.TTL && cache.TTL.flights) || 600;        // 10 min
const TTL_STALE = 24 * 60 * 60;                                    // 24h

function cacheKey(params) {
  const { departure, arrival, date, returnDate, passengers } = params;
  return `flights:${departure}:${arrival}:${date}:${returnDate || ''}:${passengers || 1}`;
}

function staleKey(params) {
  return 'stale:' + cacheKey(params);
}

function nonEmpty(arr) {
  return Array.isArray(arr) && arr.length > 0;
}

/**
 * Run the fallback chain and return { flights, source }.
 * Never throws — orchestration errors get squashed into source: 'none'.
 *
 * Source semantics:
 * - service.search(params) returns NormalizedFlight[] | null
 * - null = transport/upstream failure → advance to next source
 * - [] = upstream said "no results for this query" → advance (we treat empty
 *        the same as null for the purpose of fallback; orchestrator's job is
 *        to give the user SOMETHING, even if upstream legitimately had nothing)
 */
exports.search = async (params) => {
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
};
