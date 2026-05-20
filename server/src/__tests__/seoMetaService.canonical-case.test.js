// Force the jonty path in airlineMeta so the L616 canonical bug is exercised.
// Without this mock, jonty.db is absent in Jest and the fallback path (L632)
// runs instead — masking the uppercase-canonical bug in production.
jest.mock('../services/jontyRouteService', () => ({
  getCarrierMeta: jest.fn((iata) =>
    iata === 'LH' ? { carrier_name: 'Lufthansa', routeCount: 200 } : null
  ),
}));

const seoMetaService = require('../services/seoMetaService');

describe('seoMetaService canonical URLs are lowercase', () => {
  const cases = [
    { url: '/airline/lh',                 kind: 'airline' },
    { url: '/flights-from/lhr',           kind: 'airport-departures' },
    { url: '/flights-to/jfk',             kind: 'airport-arrivals' },
    { url: '/airline/dlh/from/fra',       kind: 'airline-airport' },
    { url: '/country/de',                 kind: 'country' },
  ];

  for (const { url, kind } of cases) {
    test(`${url} (${kind}) → canonical path has no uppercase letters`, () => {
      const meta = seoMetaService.resolve(url);
      expect(meta).toBeTruthy();
      const path = new URL(meta.canonical).pathname;
      expect(path).toBe(path.toLowerCase());
    });
  }
});
