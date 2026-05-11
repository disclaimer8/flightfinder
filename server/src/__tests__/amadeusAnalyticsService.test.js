const mockSdk = {
  airport: { directDestinations: { get: jest.fn() } },
  airline:  { destinations:       { get: jest.fn() } },
  travel: {
    analytics: {
      airTraffic: {
        traveled:      { get: jest.fn() },
        booked:        { get: jest.fn() },
      },
    },
  },
  referenceData: { recommendedLocations: { get: jest.fn() } },
};

jest.mock('../services/amadeusClient', () => ({
  isEnabled: jest.fn(() => true),
  getClient: jest.fn(() => mockSdk),
}));

const { db } = require('../models/db');
const cache = require('../models/amadeusCache');
const svc = require('../services/amadeusAnalyticsService');

beforeEach(() => {
  db.exec('DELETE FROM amadeus_cache; DELETE FROM amadeus_budget;');
  Object.values(mockSdk.airport).forEach(m => m.get.mockReset());
  Object.values(mockSdk.airline).forEach(m => m.get.mockReset());
  Object.values(mockSdk.travel.analytics.airTraffic).forEach(m => m.get.mockReset());
  mockSdk.referenceData.recommendedLocations.get.mockReset();
  delete process.env.NODE_APP_INSTANCE;
  delete process.env.AMADEUS_DAILY_BUDGET_CALLS;
  svc._resetCircuitForTests();
});

describe('getAirportDirectDestinations', () => {
  test('returns cached payload when fresh; does not hit SDK', async () => {
    cache.put('airport_direct_dest', 'JFK', ['LHR', 'CDG'], 60_000);
    const r = await svc.getAirportDirectDestinations('JFK');
    expect(r).toEqual(['LHR', 'CDG']);
    expect(mockSdk.airport.directDestinations.get).not.toHaveBeenCalled();
  });

  test('follower (NODE_APP_INSTANCE=1) never originates a fetch — returns stale or null', async () => {
    process.env.NODE_APP_INSTANCE = '1';
    const r1 = await svc.getAirportDirectDestinations('UNK');
    expect(r1).toBeNull();
    expect(mockSdk.airport.directDestinations.get).not.toHaveBeenCalled();
    const past = Date.now() - 1000;
    db.prepare(`INSERT INTO amadeus_cache(endpoint,key,payload_json,fetched_at,expires_at)
                VALUES (?,?,?,?,?)`).run('airport_direct_dest', 'JFK', JSON.stringify(['STALE']), 0, past);
    const r2 = await svc.getAirportDirectDestinations('JFK');
    expect(r2).toEqual(['STALE']);
    expect(mockSdk.airport.directDestinations.get).not.toHaveBeenCalled();
  });

  test('leader + cache miss + SDK success → writes to cache and returns', async () => {
    mockSdk.airport.directDestinations.get.mockResolvedValue({
      data: [{ iataCode: 'LHR' }, { iataCode: 'CDG' }],
    });
    const r = await svc.getAirportDirectDestinations('JFK');
    expect(r).toEqual(['LHR', 'CDG']);
    expect(mockSdk.airport.directDestinations.get).toHaveBeenCalledWith({ departureAirportCode: 'JFK' });
    expect(cache.get('airport_direct_dest', 'JFK').payload).toEqual(['LHR', 'CDG']);
  });

  test('budget cap reached → returns stale-or-null without SDK call', async () => {
    process.env.AMADEUS_DAILY_BUDGET_CALLS = '2';
    cache.incrementBudget(2, 0);
    mockSdk.airport.directDestinations.get.mockResolvedValue({ data: [{ iataCode: 'XXX' }] });
    const r = await svc.getAirportDirectDestinations('JFK');
    expect(r).toBeNull();
    expect(mockSdk.airport.directDestinations.get).not.toHaveBeenCalled();
  });

  test('SDK 429 → records error, returns stale (or null), increments errors counter', async () => {
    mockSdk.airport.directDestinations.get.mockRejectedValue(
      Object.assign(new Error('Quota exceeded'), { response: { statusCode: 429 } })
    );
    const r = await svc.getAirportDirectDestinations('JFK');
    expect(r).toBeNull();
    expect(cache.todayBudget().errors).toBe(1);
  });

  test('SDK 401 → opens circuit, second call returns null without SDK', async () => {
    mockSdk.airport.directDestinations.get.mockRejectedValue(
      Object.assign(new Error('Unauthorized'), { response: { statusCode: 401 } })
    );
    await svc.getAirportDirectDestinations('JFK');
    expect(mockSdk.airport.directDestinations.get).toHaveBeenCalledTimes(1);
    await svc.getAirportDirectDestinations('LHR');
    expect(mockSdk.airport.directDestinations.get).toHaveBeenCalledTimes(1); // still 1 — circuit open
  });
});

describe('getAirlineRoutes', () => {
  test('leader fetches, parses, caches', async () => {
    mockSdk.airline.destinations.get.mockResolvedValue({
      data: [{ iataCode: 'JFK' }, { iataCode: 'LAX' }],
    });
    const r = await svc.getAirlineRoutes('BA');
    expect(r).toEqual(['JFK', 'LAX']);
    expect(mockSdk.airline.destinations.get).toHaveBeenCalledWith({ airlineCode: 'BA' });
  });
});

describe('getMostTraveled / getMostBooked', () => {
  test('keyed by origin:period', async () => {
    mockSdk.travel.analytics.airTraffic.traveled.get.mockResolvedValue({
      data: [{ destination: 'LHR', analytics: { travelers: { score: 50 } } }],
    });
    const r = await svc.getMostTraveled('MAD', '2025');
    expect(r).toEqual([{ destination: 'LHR', analytics: { travelers: { score: 50 } } }]);
    expect(cache.get('most_traveled', 'MAD:2025').payload).toEqual(r);
  });
});

describe('getTravelRecommendations', () => {
  test('keyed by sorted city list', async () => {
    mockSdk.referenceData.recommendedLocations.get.mockResolvedValue({
      data: [{ name: 'Lisbon', iataCode: 'LIS' }],
    });
    const r = await svc.getTravelRecommendations(['PAR'], 'US');
    expect(r).toEqual([{ name: 'Lisbon', iataCode: 'LIS' }]);
    expect(cache.get('travel_recs', 'PAR|US').payload).toEqual(r);
  });
});
