const db = require('../models/db');

describe('getTopRoutesByObservedFrequency', () => {
  beforeAll(() => {
    db.db.prepare("DELETE FROM observed_routes WHERE source = 'test-toproutes'").run();
    const seed = (from, to, icao, n) => {
      for (let i = 0; i < n; i++) {
        db.upsertObservedRoute({
          depIata: from, arrIata: to, aircraftIcao: icao, airlineIata: 'XX',
          source: 'test-toproutes',
        });
      }
    };
    // Seed three routes with different frequencies.
    seed('AAA', 'BBB', 'B789', 5);  // most popular
    seed('CCC', 'DDD', 'B738', 3);
    seed('EEE', 'FFF', 'A320', 1);  // least popular
  });

  afterAll(() => {
    db.db.prepare("DELETE FROM observed_routes WHERE source = 'test-toproutes'").run();
  });

  it('returns routes ordered by occurrence count desc', () => {
    const out = db.getTopRoutesByObservedFrequency(10);
    const triplet = out
      .filter((r) => ['AAA-BBB', 'CCC-DDD', 'EEE-FFF'].includes(`${r.from}-${r.to}`))
      .map((r) => `${r.from}-${r.to}`);
    expect(triplet).toEqual(['AAA-BBB', 'CCC-DDD', 'EEE-FFF']);
  });

  it('respects the limit parameter', () => {
    const out = db.getTopRoutesByObservedFrequency(2);
    expect(out.length).toBeLessThanOrEqual(2);
  });

  it('returns objects with from/to/count', () => {
    const out = db.getTopRoutesByObservedFrequency(1);
    if (out.length > 0) {
      expect(out[0]).toHaveProperty('from');
      expect(out[0]).toHaveProperty('to');
      expect(out[0]).toHaveProperty('count');
      expect(typeof out[0].count).toBe('number');
    }
  });

  it('returns [] for limit <= 0', () => {
    expect(db.getTopRoutesByObservedFrequency(0)).toEqual([]);
    expect(db.getTopRoutesByObservedFrequency(-1)).toEqual([]);
  });
});
