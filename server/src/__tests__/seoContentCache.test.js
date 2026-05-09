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

  beforeEach(() => {
    cache._clearForTests();
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
    expect(s.pageCount).toBeGreaterThan(0);
    expect(typeof s.lastWarmedAt).toBe('number');
  });

  it('refresh() preserves a cached value when its builder throws on the next pass', () => {
    cache.warm({ schedule: false });
    const before = cache.get('/pricing');
    expect(before).toBeTruthy();

    // Force the pricing builder to throw on next refresh.
    const builders = require('../services/seoContentBuilders');
    const orig = builders.build;
    builders.build = (meta) => {
      if (meta && meta.kind === 'pricing') throw new Error('simulated builder failure');
      return orig(meta);
    };

    try {
      cache.refresh();
      // Prior value preserved because /pricing is still enumerated.
      expect(cache.get('/pricing')).toBe(before);
    } finally {
      builders.build = orig;
    }
  });

  it('refresh() prunes a key that has fallen out of enumeration', () => {
    cache.warm({ schedule: false });
    // Inject a stale key directly into the cache.
    cache._injectForTests('/this-path-not-in-enumeration', '<p>stale</p>');
    expect(cache.get('/this-path-not-in-enumeration')).toMatch(/stale/);

    cache.refresh();
    expect(cache.get('/this-path-not-in-enumeration')).toBeNull();
  });
});
