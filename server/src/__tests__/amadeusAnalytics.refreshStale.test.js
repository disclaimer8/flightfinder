jest.mock('../services/amadeusClient', () => ({
  isEnabled: jest.fn(() => true),
  getClient: jest.fn(() => ({
    airport:  { directDestinations: { get: jest.fn().mockResolvedValue({ data: [{ iataCode: 'LHR' }] }) } },
    airline:  { destinations:       { get: jest.fn().mockResolvedValue({ data: [{ iataCode: 'JFK' }] }) } },
  })),
}));

jest.mock('../models/db', () => {
  const real = jest.requireActual('../models/db');
  return {
    ...real,
    getTopAirportsByObservedActivity: () => [{ iata: 'JFK' }, { iata: 'LHR' }],
    getTopAirlinesByObservedActivity: () => [{ iata: 'BA' }],
  };
});

const { db } = require('../models/db');
const cache = require('../models/amadeusCache');
const svc = require('../services/amadeusAnalyticsService');

beforeEach(() => {
  db.exec('DELETE FROM amadeus_cache; DELETE FROM amadeus_budget;');
  delete process.env.NODE_APP_INSTANCE;
  delete process.env.AMADEUS_DAILY_BUDGET_CALLS;
  svc._resetCircuitForTests();
});

test('refreshStale fetches enumerated keys when cache is cold', async () => {
  const result = await svc.refreshStale({ airportLimit: 2, airlineLimit: 1 });
  expect(result.refreshed).toBeGreaterThan(0);
  expect(cache.get('airport_direct_dest', 'JFK')).not.toBeNull();
  expect(cache.get('airline_routes', 'BA')).not.toBeNull();
});

test('refreshStale on follower is a no-op', async () => {
  process.env.NODE_APP_INSTANCE = '1';
  const result = await svc.refreshStale({ airportLimit: 2 });
  expect(result.refreshed).toBe(0);
  expect(cache.get('airport_direct_dest', 'JFK')).toBeNull();
});

test('refreshStale respects daily budget cap', async () => {
  process.env.AMADEUS_DAILY_BUDGET_CALLS = '1';
  await svc.refreshStale({ airportLimit: 5, airlineLimit: 5 });
  // At most 1 successful fetch before budget halts further calls.
  const dayBudget = cache.todayBudget();
  expect(dayBudget.calls).toBeLessThanOrEqual(1);
});
