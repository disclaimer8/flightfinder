// Stub aircraftRouteService.listQualifying so it doesn't hit real DB
jest.mock('../services/aircraftRouteService', () => ({ listQualifying: () => [] }));
jest.mock('../models/aircraftVariants', () => ({ getAllVariants: () => [] }));
jest.mock('../models/aircraftFamilies', () => ({ getFamilyList: () => [] }));

const { enumerateSeoUrls } = require('../services/seoUrlEnumerator');

const stubDb = {
  getHubNetwork: () => ({ edges: [] }),
  getTopAirportsByObservedActivity: ({ limit }) => [
    { iata: 'JFK', activity: 1000 },
    { iata: 'LHR', activity: 800 },
  ].slice(0, limit),
  getTopAirlinesByObservedActivity: ({ limit }) => [
    { iata: 'BA', count: 500 },
    { iata: 'AA', count: 400 },
  ].slice(0, limit),
};

test('emits /airport/{iata} for each top airport', () => {
  const urls = enumerateSeoUrls({ db: stubDb });
  expect(urls).toContain('/airport/jfk');
  expect(urls).toContain('/airport/lhr');
});

test('emits /airline/{iata} for each top airline', () => {
  const urls = enumerateSeoUrls({ db: stubDb });
  expect(urls).toContain('/airline/ba');
  expect(urls).toContain('/airline/aa');
});

test('gracefully handles missing db helpers (empty DB)', () => {
  const emptyDb = { getHubNetwork: () => ({ edges: [] }) };
  expect(() => enumerateSeoUrls({ db: emptyDb })).not.toThrow();
});
