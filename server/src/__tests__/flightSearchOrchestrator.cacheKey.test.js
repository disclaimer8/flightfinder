// Regression test for cabin / flexDates cache key isolation.
// Without this, an economy search on LHR→JFK could poison the business
// cabin cache because cacheKey() ignored cabin (caught during Phase 2
// Task 2 code review).

const orchestrator = require('../services/flightSearchOrchestrator');

jest.mock('../services/googleFlightsService', () => ({ search: jest.fn() }));
jest.mock('../services/itaMatrixService', () => ({ search: jest.fn().mockResolvedValue(null) }));
jest.mock('../services/travelpayoutsAdapter', () => ({ search: jest.fn().mockResolvedValue(null) }));
jest.mock('../services/cacheService', () => {
  const store = new Map();
  return {
    get: jest.fn((k) => store.get(k)),
    set: jest.fn((k, v) => { store.set(k, v); }),
    TTL: { flights: 600 },
    _clear: () => store.clear(),
  };
});

const google = require('../services/googleFlightsService');
const cache = require('../services/cacheService');

describe('flightSearchOrchestrator cache key includes cabin + flexDates', () => {
  beforeEach(() => {
    cache._clear();
    google.search.mockReset();
  });

  test('economy and business hit DIFFERENT cache entries', async () => {
    const economyFlights = [{ id: 'economy-flight', price: 487 }];
    const businessFlights = [{ id: 'business-flight', price: 2487 }];

    // First call: economy → returns economyFlights → caches under economy key
    google.search.mockResolvedValueOnce(economyFlights);
    const r1 = await orchestrator.search({
      departure: 'LHR', arrival: 'JFK', date: '2099-01-15',
      passengers: 1, cabin: 'economy', flexDates: false,
    });
    expect(r1.flights).toEqual(economyFlights);

    // Second call: business → must NOT pull from economy cache; calls google again
    google.search.mockResolvedValueOnce(businessFlights);
    const r2 = await orchestrator.search({
      departure: 'LHR', arrival: 'JFK', date: '2099-01-15',
      passengers: 1, cabin: 'business', flexDates: false,
    });
    expect(r2.flights).toEqual(businessFlights);
    expect(r2.source).toBe('google'); // freshly fetched, not 'cache'
    expect(google.search).toHaveBeenCalledTimes(2);
  });

  test('flexDates=true and flexDates=false hit DIFFERENT cache entries', async () => {
    const exactFlights = [{ id: 'exact', price: 487 }];
    const flexFlights = [{ id: 'flex', price: 312 }];

    google.search.mockResolvedValueOnce(exactFlights);
    await orchestrator.search({
      departure: 'LHR', arrival: 'JFK', date: '2099-01-15',
      passengers: 1, cabin: 'economy', flexDates: false,
    });

    google.search.mockResolvedValueOnce(flexFlights);
    const r2 = await orchestrator.search({
      departure: 'LHR', arrival: 'JFK', date: '2099-01-15',
      passengers: 1, cabin: 'economy', flexDates: true,
    });
    expect(r2.flights).toEqual(flexFlights);
    expect(google.search).toHaveBeenCalledTimes(2);
  });

  test('same cabin + same flexDates hits cache on second call', async () => {
    const economyFlights = [{ id: 'economy-flight', price: 487 }];

    google.search.mockResolvedValueOnce(economyFlights);
    await orchestrator.search({
      departure: 'LHR', arrival: 'JFK', date: '2099-01-15',
      passengers: 1, cabin: 'economy', flexDates: false,
    });

    // Second identical call: should hit cache, NOT call google again
    const r2 = await orchestrator.search({
      departure: 'LHR', arrival: 'JFK', date: '2099-01-15',
      passengers: 1, cabin: 'economy', flexDates: false,
    });
    expect(r2.flights).toEqual(economyFlights);
    expect(r2.source).toBe('cache');
    expect(google.search).toHaveBeenCalledTimes(1); // only the first call
  });
});
