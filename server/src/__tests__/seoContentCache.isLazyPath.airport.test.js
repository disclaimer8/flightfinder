'use strict';
// Lynchpin test for the "lazy-bake regex desync" trap (FF memory).
// If a new SSR URL family lands in builders + resolvers but the lazy-bake
// regex isn't updated, the cache silently skips its builder and serves the
// React shell → Soft 404. Adding a test per family makes the trap loud.

const cache = require('../services/seoContentCache');

describe('seoContentCache.isLazyPath — Phase 1 SSR families', () => {
  // /airline/:iata is in lazy path because warm() enumerates airlines via
  // FF observed_routes which stores ICAO not IATA — pre-warm caches the
  // wrong URL family. Lazy bake on first hit handles the real IATA URLs.
  const ACCEPTED = [
    '/flights-from/ORK',
    '/flights-from/lhr/',
    '/flights-to/ORK',
    '/flights-to/lhr/',
    '/airline/EI',
    '/airline/ei/',
    '/airline/EI/from/ORK',
    '/airline/ei/from/ork/',
  ];

  it.each(ACCEPTED)('%s is recognised as lazy SSR path', (p) => {
    expect(cache.isLazyPath(p)).toBe(true);
  });

  const REJECTED = [
    '/flights-from/',           // missing IATA
    '/flights-from/ABCD',       // 4 chars too long
    '/flights-from/AB',         // 2 chars too short
    '/flights-to/12',           // digits not allowed for airport IATA
    '/airline/EI/from/AB',      // airport must be 3 chars
    '/random/path',
    '',
  ];

  it.each(REJECTED)('%s is NOT a lazy SSR path', (p) => {
    expect(cache.isLazyPath(p)).toBe(false);
  });

  it('preserves existing lazy families (regression guard)', () => {
    // Make sure the refactor didn't break the previously-lazy families.
    expect(cache.isLazyPath('/accidents/ua-flight-93')).toBe(true);
    expect(cache.isLazyPath('/safety/events/12345')).toBe(true);
    expect(cache.isLazyPath('/airline/EI/aircraft/B788')).toBe(true);
    expect(cache.isLazyPath('/routes/jfk-lhr')).toBe(true);
    expect(cache.isLazyPath('/routes/jfk-lhr/boeing-787')).toBe(true);
  });
});
