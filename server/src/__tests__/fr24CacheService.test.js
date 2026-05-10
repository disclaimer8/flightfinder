// Mock fr24Service so refresh() tests don't make real HTTP calls.
jest.mock('../services/fr24Service', () => ({
  isEnabled: jest.fn(() => true),
  fetchVariantStats: jest.fn(),
  fetchFamilyStats: jest.fn(),
  fetchRouteStats: jest.fn(),
}));

// Stub out the data-source modules refresh iterates over.
jest.mock('../models/aircraftVariants', () => ({
  getAllVariants: () => [
    { icao: 'B789', familySlug: 'boeing-787', slug: '787-9' },
    { icao: 'B788', familySlug: 'boeing-787', slug: '787-8' },
  ],
}));
jest.mock('../models/aircraftFamilies', () => ({
  getFamilyList: () => [
    { slug: 'boeing-787', icaoList: ['B788', 'B789', 'B78X'] },
  ],
}));
jest.mock('../models/db', () => ({
  getTopRoutesByObservedFrequency: () => [
    { from: 'JFK', to: 'LHR', count: 100 },
    { from: 'LAX', to: 'NRT', count: 80 },
  ],
}));

const fr24Service = require('../services/fr24Service');
const cache = require('../services/fr24CacheService');

beforeEach(() => {
  cache.clear();
  jest.clearAllMocks();
  // clearAllMocks only clears call history, not implementations — re-establish
  // the default isEnabled=true so a prior test's mockReturnValue(false) doesn't
  // bleed into the next test.
  fr24Service.isEnabled.mockReturnValue(true);
});

describe('fr24CacheService basics', () => {
  it('exports public API', () => {
    expect(typeof cache.get).toBe('function');
    expect(typeof cache.set).toBe('function');
    expect(typeof cache.clear).toBe('function');
    expect(typeof cache.isStale).toBe('function');
    expect(typeof cache.refresh).toBe('function');
    expect(typeof cache.stats).toBe('function');
  });

  it('get returns null for unknown key', () => {
    expect(cache.get('variant:UNKNOWN')).toBeNull();
  });

  it('set + get round-trip', () => {
    const stats = { totalFlights: 1, fetchedAt: Date.now() };
    cache.set('variant:B789', stats);
    expect(cache.get('variant:B789')).toEqual(stats);
  });

  it('isStale returns true when cache empty', () => {
    expect(cache.isStale()).toBe(true);
  });

  it('isStale returns true when oldest entry > 7 days old', () => {
    const eightDaysAgo = Date.now() - 8 * 24 * 60 * 60 * 1000;
    cache.set('variant:B789', { totalFlights: 1, fetchedAt: eightDaysAgo });
    expect(cache.isStale()).toBe(true);
  });

  it('isStale returns false when all entries are fresh', () => {
    cache.set('variant:B789', { totalFlights: 1, fetchedAt: Date.now() });
    cache.set('family:boeing-787', { totalFlights: 1, fetchedAt: Date.now() - 60_000 });
    expect(cache.isStale()).toBe(false);
  });

  it('clear empties the cache', () => {
    cache.set('variant:B789', { totalFlights: 1, fetchedAt: Date.now() });
    cache.clear();
    expect(cache.get('variant:B789')).toBeNull();
    expect(cache.stats().keys).toBe(0);
  });
});

describe('fr24CacheService.refresh', () => {
  it('iterates variants + families + routes and stores results', async () => {
    fr24Service.fetchVariantStats.mockResolvedValue({ totalFlights: 100, fetchedAt: Date.now() });
    fr24Service.fetchFamilyStats.mockResolvedValue({ totalFlights: 200, fetchedAt: Date.now() });
    fr24Service.fetchRouteStats.mockResolvedValue({ totalFlights: 50, fetchedAt: Date.now() });

    const result = await cache.refresh();

    expect(result.refreshed).toBe(2 + 1 + 2);  // 2 variants + 1 family + 2 routes
    expect(result.failed).toBe(0);
    expect(cache.get('variant:B789')).toBeTruthy();
    expect(cache.get('family:boeing-787')).toBeTruthy();
    expect(cache.get('route:JFK-LHR')).toBeTruthy();
  });

  it('skips entries fetched within TTL/2 (idempotent on double-warm)', async () => {
    cache.set('variant:B789', { totalFlights: 1, fetchedAt: Date.now() - 60_000 });
    fr24Service.fetchVariantStats.mockResolvedValue({ totalFlights: 999, fetchedAt: Date.now() });

    await cache.refresh();

    // B789 should NOT have been refetched (still has totalFlights: 1)
    expect(cache.get('variant:B789').totalFlights).toBe(1);
  });

  it('per-key failure does not halt the loop', async () => {
    fr24Service.fetchVariantStats
      .mockResolvedValueOnce(null)  // B789 fails (returns null)
      .mockResolvedValueOnce({ totalFlights: 100, fetchedAt: Date.now() });  // B788 succeeds
    fr24Service.fetchFamilyStats.mockResolvedValue({ totalFlights: 200, fetchedAt: Date.now() });
    fr24Service.fetchRouteStats.mockResolvedValue({ totalFlights: 50, fetchedAt: Date.now() });

    const result = await cache.refresh();
    expect(result.refreshed).toBe(1 + 1 + 2);  // B788 + family + 2 routes
    expect(result.failed).toBe(1);
    expect(cache.get('variant:B789')).toBeNull();
    expect(cache.get('variant:B788')).toBeTruthy();
  });

  it('refresh is no-op when fr24Service is disabled', async () => {
    fr24Service.isEnabled.mockReturnValue(false);
    const result = await cache.refresh();
    expect(result).toEqual({ refreshed: 0, skipped: 0, failed: 0 });
    expect(fr24Service.fetchVariantStats).not.toHaveBeenCalled();
  });

  it('passes withYearly: true to variant + family fetchers, NOT to route fetcher', async () => {
    fr24Service.fetchVariantStats.mockResolvedValue({ totalFlights: 1, fetchedAt: Date.now() });
    fr24Service.fetchFamilyStats.mockResolvedValue({ totalFlights: 1, fetchedAt: Date.now() });
    fr24Service.fetchRouteStats.mockResolvedValue({ totalFlights: 1, fetchedAt: Date.now() });

    await cache.refresh();

    expect(fr24Service.fetchVariantStats).toHaveBeenCalledWith('B789', { withYearly: true });
    expect(fr24Service.fetchFamilyStats).toHaveBeenCalledWith(['B788', 'B789', 'B78X'], { withYearly: true });
    expect(fr24Service.fetchRouteStats).toHaveBeenCalledWith('JFK', 'LHR');
  });
});

describe('fr24CacheService route key canonicalization', () => {
  it('refresh canonicalizes route keys (alphabetical sort) so both directions hit one entry', async () => {
    // Mock db to return reverse-direction route (LHR-JFK)
    jest.resetModules();
    jest.doMock('../models/db', () => ({
      getTopRoutesByObservedFrequency: () => [{ from: 'LHR', to: 'JFK', count: 100 }],
    }));
    jest.doMock('../models/aircraftVariants', () => ({ getAllVariants: () => [] }));
    jest.doMock('../models/aircraftFamilies', () => ({ getFamilyList: () => [] }));
    jest.doMock('../services/fr24Service', () => ({
      isEnabled: () => true,
      fetchVariantStats: jest.fn(),
      fetchFamilyStats: jest.fn(),
      fetchRouteStats: jest.fn().mockResolvedValue({ totalFlights: 50, fetchedAt: Date.now() }),
    }));
    const cache2 = require('../services/fr24CacheService');
    cache2.clear();
    await cache2.refresh();
    // Even though we queried with LHR→JFK, cache key is canonical JFK-LHR
    expect(cache2.get('route:JFK-LHR')).toBeTruthy();
    expect(cache2.get('route:LHR-JFK')).toBeNull();
  });
});
