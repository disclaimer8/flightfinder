// server/src/__tests__/co2.test.js
const { co2PerPax, greatCircleKm } = require('../services/co2Service');

describe('co2Service', () => {
  test('greatCircleKm LHR→JFK ≈ 5541 km (±30)', () => {
    const km = greatCircleKm(51.4700, -0.4543, 40.6413, -73.7781);
    expect(km).toBeGreaterThan(5510);
    expect(km).toBeLessThan(5575);
  });

  test('co2PerPax A320 @ 1000km ~ 80–180 kg/pax', () => {
    const kg = co2PerPax({ icaoType: 'A320', distanceKm: 1000 });
    expect(kg).toBeGreaterThan(80);
    expect(kg).toBeLessThan(180);
  });

  test('co2PerPax returns null for unknown icaoType', () => {
    expect(co2PerPax({ icaoType: 'ZZZZ', distanceKm: 500 })).toBeNull();
  });

  test('co2PerPax rejects invalid distance', () => {
    expect(co2PerPax({ icaoType: 'A320', distanceKm: 0 })).toBeNull();
    expect(co2PerPax({ icaoType: 'A320', distanceKm: -50 })).toBeNull();
  });
});
