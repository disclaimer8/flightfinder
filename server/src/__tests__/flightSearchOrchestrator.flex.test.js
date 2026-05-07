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

describe('flightSearchOrchestrator.search flexDates fan-out', () => {
  beforeEach(() => {
    cache._clear();
    google.search.mockReset();
  });

  test('flexDates=false fires exactly one underlying search', async () => {
    google.search.mockResolvedValue([]);
    await orchestrator.search({
      departure: 'LHR', arrival: 'JFK', date: '2099-01-15',
      passengers: 1, cabin: 'economy', flexDates: false,
    });
    expect(google.search).toHaveBeenCalledTimes(1);
    expect(google.search).toHaveBeenCalledWith(expect.objectContaining({ date: '2099-01-15' }));
  });

  test('flexDates=true fires 7 parallel searches (date-3..date+3)', async () => {
    google.search.mockResolvedValue([]);
    await orchestrator.search({
      departure: 'LHR', arrival: 'JFK', date: '2099-01-15',
      passengers: 1, cabin: 'economy', flexDates: true,
    });
    expect(google.search).toHaveBeenCalledTimes(7);
    const dates = google.search.mock.calls.map(c => c[0].date);
    expect(dates.sort()).toEqual([
      '2099-01-12', '2099-01-13', '2099-01-14', '2099-01-15',
      '2099-01-16', '2099-01-17', '2099-01-18',
    ]);
  });

  test('flexDates=true merges + dedupes by (carrier, flightNo, departureTime)', async () => {
    const flightA = { carrier: 'BA', flightNo: '178', departureTime: '2099-01-15T09:55:00Z', price: 487 };
    const flightB = { carrier: 'BA', flightNo: '178', departureTime: '2099-01-15T09:55:00Z', price: 499 }; // dup
    const flightC = { carrier: 'VS', flightNo: '3',   departureTime: '2099-01-16T11:30:00Z', price: 512 };

    // Mock returns: 7 calls total. We attach flightA and flightB to TWO different
    // dates so the dedupe is real (post-merge), not just per-day. flightC on day 4.
    google.search
      .mockResolvedValueOnce([flightA])
      .mockResolvedValueOnce([flightB])
      .mockResolvedValueOnce([flightC])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const out = await orchestrator.search({
      departure: 'LHR', arrival: 'JFK', date: '2099-01-15',
      passengers: 1, cabin: 'economy', flexDates: true,
    });

    expect(out.flights.length).toBe(2); // dup collapsed
    const keys = out.flights.map(f => `${f.carrier}${f.flightNo}@${f.departureTime}`);
    expect(keys).toEqual(expect.arrayContaining([
      'BA178@2099-01-15T09:55:00Z',
      'VS3@2099-01-16T11:30:00Z',
    ]));
  });

  test('flexDates=true source label uses most-authoritative result', async () => {
    google.search.mockResolvedValue([{ carrier: 'BA', flightNo: '178', departureTime: '2099-01-15T09:55:00Z' }]);
    const out = await orchestrator.search({
      departure: 'LHR', arrival: 'JFK', date: '2099-01-15',
      passengers: 1, cabin: 'economy', flexDates: true,
    });
    expect(out.source).toBe('google');
  });

  test('flexDates=true caches the merged result by flex cache key', async () => {
    google.search
      .mockResolvedValueOnce([{ carrier: 'BA', flightNo: '178', departureTime: '2099-01-15T09:55:00Z' }])
      .mockResolvedValue([]);

    // First call — runs fan-out
    const r1 = await orchestrator.search({
      departure: 'LHR', arrival: 'JFK', date: '2099-01-15',
      passengers: 1, cabin: 'economy', flexDates: true,
    });
    expect(google.search).toHaveBeenCalledTimes(7);
    expect(r1.flights.length).toBe(1);

    // Second identical flex call — should hit cache, no more google calls
    google.search.mockClear();
    const r2 = await orchestrator.search({
      departure: 'LHR', arrival: 'JFK', date: '2099-01-15',
      passengers: 1, cabin: 'economy', flexDates: true,
    });
    expect(r2.flights.length).toBe(1);
    expect(r2.source).toBe('cache');
    expect(google.search).not.toHaveBeenCalled();
  });
});
