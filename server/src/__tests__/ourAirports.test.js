// server/src/__tests__/ourAirports.test.js
const path = require('path');
const ourAirports = require('../services/ourAirportsService');

describe('ourAirportsService', () => {
  beforeAll(() => {
    ourAirports.loadFromCsv(path.join(__dirname, '../../data/ourairports-fixture.csv'));
  });

  test('getAirport by IATA returns coords + ICAO + country', () => {
    const a = ourAirports.getAirport('LHR');
    expect(a).toEqual(expect.objectContaining({
      iata: 'LHR',
      icao: 'EGLL',
      name: 'London Heathrow',
      city: 'London',
      country: 'GB',
      lat: expect.any(Number),
      lon: expect.any(Number),
    }));
    expect(a.lat).toBeCloseTo(51.47, 1);
    expect(a.lon).toBeCloseTo(-0.46, 1);
  });

  test('getAirport with unknown IATA returns null', () => {
    expect(ourAirports.getAirport('XXX')).toBeNull();
  });

  test('size() reports the loaded row count', () => {
    expect(ourAirports.size()).toBe(5);
  });
});
