jest.mock('../services/amadeusAnalyticsService', () => ({
  getMostTraveled: jest.fn(),
  getAirportDirectDestinations: jest.fn(),
  getAirlineRoutes: jest.fn(),
  getTravelRecommendations: jest.fn(),
}));

const amadeus = require('../services/amadeusAnalyticsService');
const builders = require('../services/seoContentBuilders');

const stubDb = {
  getRouteFacts: () => ({
    airlineCount: 3, aircraftCount: 2,
    topAirlines: ['BA', 'AA', 'VS'],
    topAircraft: ['B789', 'A380'],
  }),
};

beforeEach(() => {
  Object.values(amadeus).forEach(fn => fn?.mockReset?.());
  // applyChromeAsync for route also calls getTravelRecommendations — give a
  // default so tests that only mock getMostTraveled don't blow up.
  amadeus.getTravelRecommendations.mockResolvedValue(null);
});

test('bRoute via buildAsync appends Most Traveled block when present', async () => {
  amadeus.getMostTraveled.mockResolvedValue([
    { destination: 'CDG', analytics: { travelers: { score: 90 } } },
    { destination: 'MAD', analytics: { travelers: { score: 70 } } },
  ]);

  const meta = { kind: 'route', fromIata: 'JFK', toIata: 'LHR', fromName: 'New York', toName: 'London' };
  const html = await builders.buildAsync(meta, stubDb);
  expect(html).toMatch(/Top destinations.+from JFK/i);
  expect(html).toMatch(/CDG/);
});

test('bRoute via buildAsync omits Amadeus blocks when service returns null', async () => {
  amadeus.getMostTraveled.mockResolvedValue(null);

  const meta = { kind: 'route', fromIata: 'JFK', toIata: 'LHR', fromName: 'New York', toName: 'London' };
  const html = await builders.buildAsync(meta, stubDb);
  expect(html).not.toBeNull();
  expect(html).not.toMatch(/Top destinations/);
});
