jest.mock('../services/cacheService', () => ({
  get: jest.fn(() => undefined),
  set: jest.fn(),
  TTL: { negative: 60, tpPrice: 600 },
}));

// We mock the client (axios instance) to inspect outgoing params.
let lastCallParams = null;
jest.mock('axios', () => ({
  create: () => ({
    get: jest.fn((url, opts) => {
      lastCallParams = opts?.params;
      return Promise.resolve({ data: { success: true, data: { JFK: { '0': { price: 487, airline: 'BA' } } }, currency: 'usd' } });
    }),
  }),
}));

// TP needs TOKEN env var to be set or getCheapest short-circuits. Set it before requiring.
process.env.TRAVELPAYOUTS_TOKEN = 'test-token';

const tp = require('../services/travelpayoutsService');

describe('travelpayoutsService.getCheapest cabin → trip_class mapping', () => {
  beforeEach(() => {
    lastCallParams = null;
  });

  test('default (no cabin) → trip_class=0 (economy)', async () => {
    await tp.getCheapest({ origin: 'LHR', destination: 'JFK', date: '2099-01-15' });
    expect(lastCallParams).toMatchObject({ trip_class: 0 });
  });

  test('cabin="economy" → trip_class=0', async () => {
    await tp.getCheapest({ origin: 'LHR', destination: 'JFK', date: '2099-01-15', cabin: 'economy' });
    expect(lastCallParams).toMatchObject({ trip_class: 0 });
  });

  test('cabin="premium-economy" → trip_class=1', async () => {
    await tp.getCheapest({ origin: 'LHR', destination: 'JFK', date: '2099-01-15', cabin: 'premium-economy' });
    expect(lastCallParams).toMatchObject({ trip_class: 1 });
  });

  test('cabin="business" → trip_class=2', async () => {
    await tp.getCheapest({ origin: 'LHR', destination: 'JFK', date: '2099-01-15', cabin: 'business' });
    expect(lastCallParams).toMatchObject({ trip_class: 2 });
  });

  test('cabin="first" → trip_class=3', async () => {
    await tp.getCheapest({ origin: 'LHR', destination: 'JFK', date: '2099-01-15', cabin: 'first' });
    expect(lastCallParams).toMatchObject({ trip_class: 3 });
  });

  test('cache key includes cabin so different cabins do not collide', async () => {
    const cacheService = require('../services/cacheService');
    cacheService.get.mockReset();
    cacheService.set.mockReset();
    cacheService.get.mockReturnValue(undefined);

    await tp.getCheapest({ origin: 'LHR', destination: 'JFK', date: '2099-01-15', cabin: 'economy' });
    await tp.getCheapest({ origin: 'LHR', destination: 'JFK', date: '2099-01-15', cabin: 'business' });

    const setKeys = cacheService.set.mock.calls.map(c => c[0]);
    // economy and business should produce DIFFERENT cache keys
    expect(new Set(setKeys).size).toBe(setKeys.length);
    expect(setKeys.some(k => k.includes('economy'))).toBe(true);
    expect(setKeys.some(k => k.includes('business'))).toBe(true);
  });
});
