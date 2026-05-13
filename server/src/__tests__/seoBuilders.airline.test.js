jest.mock('../services/amadeusAnalyticsService', () => ({
  getAirlineRoutes: jest.fn(),
  getAirportDirectDestinations: jest.fn(),
}));

// Mock airlineAircraftService so tests are pure (no real SQLite needed here)
jest.mock('../services/airlineAircraftService', () => ({
  getTopAircraftForAirline:     jest.fn(() => []),
  listValidCombinations:        jest.fn(() => []),
  buildValidComboSet:           jest.fn(() => new Set()),
  getTopHubsForAirline:         jest.fn(() => []),
  getTopDestinationsForAirline: jest.fn(() => []),
}));

const amadeus           = require('../services/amadeusAnalyticsService');
const airlineAircraftService = require('../services/airlineAircraftService');
const builders          = require('../services/seoContentBuilders');

const stubDb = {};

beforeEach(() => {
  Object.values(amadeus).forEach(fn => fn?.mockReset?.());
  Object.values(airlineAircraftService).forEach(fn => fn?.mockReset?.());
  // Restore safe defaults after reset
  airlineAircraftService.getTopAircraftForAirline.mockReturnValue([]);
  airlineAircraftService.listValidCombinations.mockReturnValue([]);
  airlineAircraftService.buildValidComboSet.mockReturnValue(new Set());
  airlineAircraftService.getTopHubsForAirline.mockReturnValue([]);
  airlineAircraftService.getTopDestinationsForAirline.mockReturnValue([]);
});

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

  // ── New sections ─────────────────────────────────────────────────────────────

  test('Hub airports section renders 5 airport rows', async () => {
    amadeus.getAirlineRoutes.mockResolvedValue([]);
    airlineAircraftService.getTopHubsForAirline.mockReturnValue([
      { iata: 'LHR', city: 'London',    country: 'GB', pair_count: 87 },
      { iata: 'JFK', city: 'New York',  country: 'US', pair_count: 52 },
      { iata: 'CDG', city: 'Paris',     country: 'FR', pair_count: 41 },
      { iata: 'FRA', city: 'Frankfurt', country: 'DE', pair_count: 33 },
      { iata: 'AMS', city: 'Amsterdam', country: 'NL', pair_count: 28 },
    ]);

    const html = await builders.buildAsync({ kind: 'airline', iata: 'BA' }, stubDb);

    expect(html).toMatch(/Hub airports/);
    expect(html).toMatch(/LHR/);
    expect(html).toMatch(/JFK/);
    expect(html).toMatch(/CDG/);
    expect(html).toMatch(/FRA/);
    expect(html).toMatch(/AMS/);
    // Confirm 5 <li> entries are present in hub section
    const hubSection = html.match(/<section><h2>Hub airports<\/h2>([\s\S]*?)<\/section>/)?.[0] || '';
    expect((hubSection.match(/<li>/g) || []).length).toBe(5);
  });

  test('Top destinations section renders 5 airport rows', async () => {
    amadeus.getAirlineRoutes.mockResolvedValue([]);
    airlineAircraftService.getTopDestinationsForAirline.mockReturnValue([
      { iata: 'DXB', city: 'Dubai',       country: 'AE', pair_count: 65 },
      { iata: 'SIN', city: 'Singapore',   country: 'SG', pair_count: 58 },
      { iata: 'BKK', city: 'Bangkok',     country: 'TH', pair_count: 47 },
      { iata: 'SYD', city: 'Sydney',      country: 'AU', pair_count: 39 },
      { iata: 'HKG', city: 'Hong Kong',   country: 'HK', pair_count: 31 },
    ]);

    const html = await builders.buildAsync({ kind: 'airline', iata: 'BA' }, stubDb);

    expect(html).toMatch(/Top destinations/);
    expect(html).toMatch(/DXB/);
    expect(html).toMatch(/SIN/);
    expect(html).toMatch(/SYD/);
    const destSection = html.match(/<section><h2>Top destinations<\/h2>([\s\S]*?)<\/section>/)?.[0] || '';
    expect((destSection.match(/<li>/g) || []).length).toBe(5);
  });

  test('Safety record section renders with cross-link to /safety/global?op=', async () => {
    amadeus.getAirlineRoutes.mockResolvedValue([]);
    const html = await builders.buildAsync({ kind: 'airline', iata: 'BA' }, stubDb);

    expect(html).toMatch(/Safety record/);
    expect(html).toMatch(/\/safety\/global\?op=BA/);
    expect(html).toMatch(/View safety database/);
  });

  test('three new sections appear after Top aircraft block and before JSON-LD', async () => {
    amadeus.getAirlineRoutes.mockResolvedValue([]);
    airlineAircraftService.getTopAircraftForAirline.mockReturnValue([
      { icao_aircraft: 'B77W', name: 'Boeing 777-300ER', n_pairs: 10 },
    ]);
    airlineAircraftService.buildValidComboSet.mockReturnValue(new Set());
    airlineAircraftService.getTopHubsForAirline.mockReturnValue([
      { iata: 'LHR', city: 'London', country: 'GB', pair_count: 87 },
    ]);
    airlineAircraftService.getTopDestinationsForAirline.mockReturnValue([
      { iata: 'JFK', city: 'New York', country: 'US', pair_count: 52 },
    ]);

    const html = await builders.buildAsync({ kind: 'airline', iata: 'BA' }, stubDb);

    const posTopAircraft = html.indexOf('Top aircraft flown');
    const posHubs        = html.indexOf('Hub airports');
    const posDest        = html.indexOf('Top destinations');
    const posSafety      = html.indexOf('Safety record');
    const posJsonLd      = html.indexOf('application/ld+json');

    expect(posTopAircraft).toBeGreaterThan(-1);
    expect(posHubs).toBeGreaterThan(posTopAircraft);
    expect(posDest).toBeGreaterThan(posHubs);
    expect(posSafety).toBeGreaterThan(posDest);
    expect(posJsonLd).toBeGreaterThan(posSafety);
  });

  test('page renders gracefully when airline has 0 observed routes', async () => {
    amadeus.getAirlineRoutes.mockResolvedValue([]);
    airlineAircraftService.getTopAircraftForAirline.mockReturnValue([]);
    airlineAircraftService.getTopHubsForAirline.mockReturnValue([]);
    airlineAircraftService.getTopDestinationsForAirline.mockReturnValue([]);

    const html = await builders.buildAsync({ kind: 'airline', iata: 'BA' }, stubDb);

    expect(html).not.toBeNull();
    expect(html).toMatch(/BA/);
    // Sections with empty data should be absent (no crash)
    expect(html).not.toMatch(/Hub airports/);
    expect(html).not.toMatch(/Top destinations/);
    // Safety record always renders (it's a static cross-link)
    expect(html).toMatch(/Safety record/);
  });
});
