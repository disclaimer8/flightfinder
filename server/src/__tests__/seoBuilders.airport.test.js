jest.mock('../services/amadeusAnalyticsService', () => ({
  getAirportDirectDestinations: jest.fn(),
  getAirlineRoutes: jest.fn(),
}));

const amadeus = require('../services/amadeusAnalyticsService');
const builders = require('../services/seoContentBuilders');

const stubDb = {
  getRouteFacts: () => ({ airlineCount: 0, aircraftCount: 0, topAirlines: [], topAircraft: [] }),
};

beforeEach(() => { Object.values(amadeus).forEach(fn => fn?.mockReset?.()); });

describe('bAirport', () => {
  test('renders direct destinations when present', async () => {
    amadeus.getAirportDirectDestinations.mockResolvedValue(['LHR', 'CDG']);

    const meta = { kind: 'airport', iata: 'JFK' };
    const html = await builders.buildAsync(meta, stubDb);
    expect(html).toMatch(/JFK/);
    expect(html).toMatch(/LHR/);
    expect(html).toMatch(/CDG/);
  });

  test('renders without Amadeus block when service returns null (degrade gracefully)', async () => {
    amadeus.getAirportDirectDestinations.mockResolvedValue(null);

    const meta = { kind: 'airport', iata: 'JFK' };
    const html = await builders.buildAsync(meta, stubDb);
    expect(html).not.toBeNull();
    expect(html).toMatch(/JFK/);
  });

  test('includes Airport JSON-LD with iataCode', async () => {
    amadeus.getAirportDirectDestinations.mockResolvedValue(['LHR']);

    const html = await builders.buildAsync({ kind: 'airport', iata: 'JFK' }, stubDb);
    expect(html).toMatch(/"@type"\s*:\s*"Airport"/);
    expect(html).toMatch(/"iataCode"\s*:\s*"JFK"/);
  });
});
