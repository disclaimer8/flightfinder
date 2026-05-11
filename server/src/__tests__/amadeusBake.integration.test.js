// End-to-end: meta.resolve → buildAsync (uses bAirport/bAirline + applyChromeAsync)
// → fully wrapped HTML containing Amadeus facts. The `data-seo-bake` wrapper
// is added downstream by seoMetaService.inject() at SPA fallback time; we test
// it separately by running inject() over the produced HTML.

jest.mock('../services/amadeusClient', () => ({
  isEnabled: () => true,
  getClient: () => ({
    airport: { directDestinations: { get: jest.fn().mockResolvedValue({ data: [{ iataCode: 'LHR' }, { iataCode: 'CDG' }] }) } },
    airline: { destinations:       { get: jest.fn().mockResolvedValue({ data: [{ iataCode: 'JFK' }] }) } },
  }),
}));

jest.mock('../models/db', () => {
  const real = jest.requireActual('../models/db');
  return {
    ...real,
    getTopAirportsByObservedActivity: () => [{ iata: 'JFK' }],
    getTopAirlinesByObservedActivity: () => [{ iata: 'BA' }],
    getHubNetwork: () => ({ edges: [] }),
  };
});

const builders = require('../services/seoContentBuilders');
const meta = require('../services/seoMetaService');
const cache = require('../models/amadeusCache');
const { db } = require('../models/db');

beforeEach(() => {
  db.exec('DELETE FROM amadeus_cache; DELETE FROM amadeus_budget;');
});

test('end-to-end: /airport/jfk → meta → buildAsync → HTML contains airport facts', async () => {
  const m = meta.resolve('/airport/jfk');
  expect(m.kind).toBe('airport');
  const html = await builders.buildAsync(m);
  expect(html).not.toBeNull();
  expect(html).toMatch(/JFK/);
  expect(html).toMatch(/LHR|CDG/);
  // Amadeus cache was written by the leader fetch path
  expect(cache.get('airport_direct_dest', 'JFK')).not.toBeNull();
});

test('end-to-end: /airline/ba → HTML contains network destinations', async () => {
  const m = meta.resolve('/airline/ba');
  expect(m.kind).toBe('airline');
  const html = await builders.buildAsync(m);
  expect(html).toMatch(/BA/);
  expect(html).toMatch(/JFK/);
  expect(cache.get('airline_routes', 'BA')).not.toBeNull();
});

test('seoMetaService.inject wraps baked HTML in <section data-seo-bake="true">', async () => {
  const m = meta.resolve('/airport/jfk');
  const baked = await builders.buildAsync(m);
  // The SPA fallback hands `baked` to inject() as bodyContent. The shell must
  // contain the subtitle anchor — inject() inserts the bake section right
  // after it (mirrors client/index.html structure).
  const shell = `<html><head><title>x</title></head><body><div id="root">
    <h1 style="font-size:clamp(32px,6vw,56px);font-weight:800;">heading</h1>
    <p style="font-size:clamp(16px,2.2vw,20px);">subtitle</p>
  </div></body></html>`;
  const final = meta.inject(shell, m, baked);
  expect(final).toMatch(/<section data-seo-bake="true">/);
  expect(final).toMatch(/JFK/);
});
