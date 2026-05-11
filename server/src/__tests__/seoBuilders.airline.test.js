jest.mock('../services/amadeusAnalyticsService', () => ({
  getAirlineRoutes: jest.fn(),
  getAirportDirectDestinations: jest.fn(),
}));

const amadeus = require('../services/amadeusAnalyticsService');
const builders = require('../services/seoContentBuilders');

const stubDb = {};

beforeEach(() => { Object.values(amadeus).forEach(fn => fn?.mockReset?.()); });

describe('bAirline', () => {
  test('renders destinations from Amadeus', async () => {
    amadeus.getAirlineRoutes.mockResolvedValue(['JFK', 'LAX', 'CDG']);
    const html = await builders.buildAsync({ kind: 'airline', iata: 'BA' }, stubDb);
    expect(html).toMatch(/BA/);
    expect(html).toMatch(/JFK/);
    expect(html).toMatch(/LAX/);
  });

  test('renders without destinations block when Amadeus returns null', async () => {
    amadeus.getAirlineRoutes.mockResolvedValue(null);
    const html = await builders.buildAsync({ kind: 'airline', iata: 'BA' }, stubDb);
    expect(html).not.toBeNull();
    expect(html).toMatch(/BA/);
  });

  test('includes Airline (Organization) JSON-LD with iataCode', async () => {
    amadeus.getAirlineRoutes.mockResolvedValue([]);
    const html = await builders.buildAsync({ kind: 'airline', iata: 'BA' }, stubDb);
    expect(html).toMatch(/"@type"\s*:\s*"Airline"/);
    expect(html).toMatch(/"iataCode"\s*:\s*"BA"/);
  });
});
