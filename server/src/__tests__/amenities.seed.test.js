// server/src/__tests__/amenities.seed.test.js
const amenitiesService = require('../services/amenitiesService');
const { db } = require('../models/db');

describe('amenities seed', () => {
  beforeAll(() => {
    db.exec("DELETE FROM airline_amenities");
    amenitiesService.loadSeedIntoDb();
  });

  test('loads at least 25 airlines', () => {
    const n = db.prepare("SELECT COUNT(*) AS c FROM airline_amenities").get().c;
    expect(n).toBeGreaterThanOrEqual(25);
  });

  test('Lufthansa has wifi and meal', () => {
    const a = amenitiesService.getAmenities('LH', 'A320');
    expect(a.wifi).toBe(true);
    expect(a.meal).toBe(true);
  });

  test('Ryanair has no wifi', () => {
    const a = amenitiesService.getAmenities('FR', 'B738');
    expect(a.wifi).toBe(false);
  });

  test('unknown airline returns null', () => {
    expect(amenitiesService.getAmenities('XX', 'A320')).toBeNull();
  });
});
