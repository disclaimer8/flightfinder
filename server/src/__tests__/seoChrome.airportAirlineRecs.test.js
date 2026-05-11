jest.mock('../services/amadeusAnalyticsService', () => ({
  getAirportDirectDestinations: jest.fn(),
  getAirlineRoutes: jest.fn(),
}));

const amadeus = require('../services/amadeusAnalyticsService');
const chrome = require('../services/seoChrome');

const stubDb = {};

beforeEach(() => { Object.values(amadeus).forEach(fn => fn?.mockReset?.()); });

test('applyChromeAsync airport shows direct destinations sidebar', async () => {
  amadeus.getAirportDirectDestinations.mockResolvedValue(['LHR', 'CDG']);
  const html = await chrome.applyChromeAsync(
    { kind: 'airport', iata: 'JFK', canonical: 'https://himaxym.com/airport/jfk', h1: 'JFK', title: 't' },
    '<p>inner</p>',
    stubDb
  );
  expect(html).toMatch(/inner/);
  expect(html).toMatch(/LHR|CDG/);
});

test('applyChromeAsync airline shows network destinations sidebar', async () => {
  amadeus.getAirlineRoutes.mockResolvedValue(['JFK', 'LAX']);
  const html = await chrome.applyChromeAsync(
    { kind: 'airline', iata: 'BA', canonical: 'https://himaxym.com/airline/ba', h1: 'BA', title: 't' },
    '<p>inner</p>',
    stubDb
  );
  expect(html).toMatch(/JFK|LAX/);
});

test('applyChromeAsync returns sync chrome for non-Amadeus kinds (no extra fetches)', async () => {
  const html = await chrome.applyChromeAsync(
    { kind: 'aircraft', slug: 'boeing-787', canonical: 'x', h1: 'h', title: 't' },
    '<p>inner</p>',
    stubDb
  );
  expect(html).toMatch(/inner/);
  expect(amadeus.getAirportDirectDestinations).not.toHaveBeenCalled();
  expect(amadeus.getAirlineRoutes).not.toHaveBeenCalled();
});

test('applyChromeAsync route falls through to sync (no Amadeus extras — endpoints deprecated)', async () => {
  const html = await chrome.applyChromeAsync(
    { kind: 'route', fromIata: 'JFK', toIata: 'LHR', canonical: 'x', h1: 'h', title: 't' },
    '<p>inner</p>',
    stubDb
  );
  expect(html).toMatch(/inner/);
  expect(html).not.toMatch(/Similar destinations/i);
  expect(amadeus.getAirportDirectDestinations).not.toHaveBeenCalled();
});
