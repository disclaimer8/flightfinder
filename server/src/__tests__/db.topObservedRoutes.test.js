const db = require('../models/db');

describe('getTopRoutesByObservedFrequency', () => {
  beforeAll(() => {
    db.db.prepare("DELETE FROM observed_routes WHERE source = 'test-toproutes'").run();
    const seed = (from, to, n) => {
      for (let i = 0; i < n; i++) {
        db.upsertObservedRoute({
          depIata: from, arrIata: to, aircraftIcao: `T${i.toString().padStart(3, '0')}`,
          airlineIata: 'XX', source: 'test-toproutes',
        });
      }
    };
    // Seed three routes with different frequencies.
    seed('AAA', 'BBB', 5);  // most popular
    seed('CCC', 'DDD', 3);
    seed('EEE', 'FFF', 1);  // least popular
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
    const top = out.find((r) => r.from === 'AAA' && r.to === 'BBB');
    expect(top.count).toBe(5);
    const mid = out.find((r) => r.from === 'CCC' && r.to === 'DDD');
    expect(mid.count).toBe(3);
    const bottom = out.find((r) => r.from === 'EEE' && r.to === 'FFF');
    expect(bottom.count).toBe(1);
  });

  it('respects the limit parameter', () => {
    const out = db.getTopRoutesByObservedFrequency(2);
    expect(out.length).toBeLessThanOrEqual(2);
  });

  it('returns objects with from/to/count', () => {
    const out = db.getTopRoutesByObservedFrequency(1);
    expect(out.length).toBeGreaterThan(0);
    expect(out[0]).toHaveProperty('from');
    expect(out[0]).toHaveProperty('to');
    expect(out[0]).toHaveProperty('count');
    expect(typeof out[0].count).toBe('number');
  });

  it('returns [] for invalid limit (non-number or <= 0)', () => {
    expect(db.getTopRoutesByObservedFrequency(0)).toEqual([]);
    expect(db.getTopRoutesByObservedFrequency(-1)).toEqual([]);
    expect(db.getTopRoutesByObservedFrequency('10')).toEqual([]);
    expect(db.getTopRoutesByObservedFrequency(undefined)).toEqual([]);
    expect(db.getTopRoutesByObservedFrequency(null)).toEqual([]);
  });
});
