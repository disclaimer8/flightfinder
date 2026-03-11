const NodeCache = require('node-cache');

// TTL values in seconds
const TTL = {
  flights: 10 * 60,      // 10 min — flight prices
  explore: 30 * 60,      // 30 min — explore destinations (expensive fan-out)
  aircraft: 24 * 60 * 60, // 24h — aircraft/airline data changes rarely
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
