'use strict';

// Verifies that:
//  1. observed_routes has a `source` column (additive migration, plan 7e).
//  2. upsertObservedRoute stores source correctly (defaults to 'live').
//  3. The COALESCE logic: once a row has a source, a subsequent upsert with a
//     different source doesn't overwrite it.

describe('observed_routes source column (plan 7e)', () => {
  let db;
  let upsertObservedRoute;
  let observedStats;

  beforeAll(() => {
    jest.resetModules();
    process.env.NODE_ENV = 'test';
    const dbModule = require('../models/db');
    db = dbModule.db;
    upsertObservedRoute = dbModule.upsertObservedRoute;
    observedStats = dbModule.observedStats;
  });

  test('observed_routes table has source column', () => {
    const cols = db.prepare("PRAGMA table_info(observed_routes)").all().map(c => c.name);
    expect(cols).toContain('source');
  });

  test('upsertObservedRoute defaults source to live', () => {
    upsertObservedRoute({ depIata: 'AAA', arrIata: 'BBB', aircraftIcao: 'B738' });
    const row = db.prepare(
      "SELECT source FROM observed_routes WHERE dep_iata='AAA' AND arr_iata='BBB' AND aircraft_icao='B738'"
    ).get();
    expect(row).toBeTruthy();
    expect(row.source).toBe('live');
  });

  test('upsertObservedRoute stores historical source', () => {
    upsertObservedRoute({ depIata: 'CCC', arrIata: 'DDD', aircraftIcao: 'A320', source: 'historical' });
    const row = db.prepare(
      "SELECT source FROM observed_routes WHERE dep_iata='CCC' AND arr_iata='DDD' AND aircraft_icao='A320'"
    ).get();
    expect(row).toBeTruthy();
    expect(row.source).toBe('historical');
  });

  test('source is preserved once set (COALESCE: existing source wins)', () => {
    // First insert with 'historical'
    upsertObservedRoute({ depIata: 'EEE', arrIata: 'FFF', aircraftIcao: 'A380', source: 'historical' });
    // Second upsert with 'live' — existing source should NOT be overwritten
    upsertObservedRoute({ depIata: 'EEE', arrIata: 'FFF', aircraftIcao: 'A380', source: 'live' });
    const row = db.prepare(
      "SELECT source FROM observed_routes WHERE dep_iata='EEE' AND arr_iata='FFF' AND aircraft_icao='A380'"
    ).get();
    expect(row.source).toBe('historical');
  });

  test('observedStats still returns total', () => {
    const stats = observedStats();
    expect(typeof stats.total).toBe('number');
    expect(stats.total).toBeGreaterThan(0);
  });
});
