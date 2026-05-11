const { db } = require('../models/db');
const cache = require('../models/amadeusCache');

beforeEach(() => {
  db.exec('DELETE FROM amadeus_cache; DELETE FROM amadeus_budget;');
});

describe('amadeusCache.put/get', () => {
  test('round-trips a payload with TTL', () => {
    cache.put('airline_routes', 'BA', { destinations: ['JFK', 'LAX'] }, 60_000);
    const got = cache.get('airline_routes', 'BA');
    expect(got).not.toBeNull();
    expect(got.payload).toEqual({ destinations: ['JFK', 'LAX'] });
    expect(got.fresh).toBe(true);
  });

  test('returns stale flag when past expires_at', () => {
    const past = Date.now() - 1000;
    db.prepare(`INSERT INTO amadeus_cache(endpoint,key,payload_json,fetched_at,expires_at)
                VALUES (?,?,?,?,?)`).run('airline_routes', 'BA', '{"x":1}', past - 60_000, past);
    const got = cache.get('airline_routes', 'BA');
    expect(got.fresh).toBe(false);
    expect(got.payload).toEqual({ x: 1 });
  });

  test('get() returns null when row absent', () => {
    expect(cache.get('airline_routes', 'XX')).toBeNull();
  });

  test('put() overwrites existing row (PK conflict)', () => {
    cache.put('airline_routes', 'BA', { v: 1 }, 60_000);
    cache.put('airline_routes', 'BA', { v: 2 }, 60_000);
    expect(cache.get('airline_routes', 'BA').payload).toEqual({ v: 2 });
  });
});

describe('amadeusCache.getStale', () => {
  test('returns only past-TTL keys, capped by limit', () => {
    const past = Date.now() - 1000;
    const future = Date.now() + 60_000;
    db.prepare(`INSERT INTO amadeus_cache(endpoint,key,payload_json,fetched_at,expires_at)
                VALUES (?,?,?,?,?)`).run('airline_routes', 'A', '{}', 0, past);
    db.prepare(`INSERT INTO amadeus_cache(endpoint,key,payload_json,fetched_at,expires_at)
                VALUES (?,?,?,?,?)`).run('airline_routes', 'B', '{}', 0, future);
    const stale = cache.getStale('airline_routes', 10);
    expect(stale.map(r => r.key)).toEqual(['A']);
  });
});

describe('amadeusCache.budget', () => {
  test('todayBudget() returns zeroes when no row', () => {
    const b = cache.todayBudget();
    expect(b.calls).toBe(0);
    expect(b.errors).toBe(0);
  });

  test('incrementBudget(n, e) accumulates per UTC day', () => {
    cache.incrementBudget(3, 1);
    cache.incrementBudget(2, 0);
    const b = cache.todayBudget();
    expect(b.calls).toBe(5);
    expect(b.errors).toBe(1);
  });
});
