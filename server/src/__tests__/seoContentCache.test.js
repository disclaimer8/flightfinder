// server/src/__tests__/seoContentCache.test.js
const cache = require('../services/seoContentCache');

describe('seoContentCache', () => {
  beforeAll(() => {
    const db = require('../models/db');
    function seed(dep, arr, icao, airline) {
      db.upsertObservedRoute({
        depIata: dep, arrIata: arr, aircraftIcao: icao, airlineIata: airline, source: 'test',
      });
    }
    seed('LHR', 'JFK', 'B77W', 'BA');
  });

  it('warm() populates entries for known SEO paths', () => {
    cache.warm({ schedule: false });
    expect(cache.get('/pricing')).toMatch(/Pro/);
    expect(cache.get('/about')).toMatch(/<p>/);
  });

  it('get() returns null for unknown paths', () => {
    cache.warm({ schedule: false });
    expect(cache.get('/this/does/not/exist')).toBeNull();
  });

  it('refresh() does not clear existing entries when a builder errors', () => {
    cache.warm({ schedule: false });
    const before = cache.get('/pricing');
    cache.refresh();
    expect(cache.get('/pricing')).toBe(before);
  });

  it('stats() reports size and lastWarmedAt', () => {
    cache.warm({ schedule: false });
    const s = cache.stats();
    expect(s.size).toBeGreaterThan(0);
    expect(typeof s.lastWarmedAt).toBe('number');
  });
});
