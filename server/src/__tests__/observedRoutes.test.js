'use strict';
const obr = require('../models/observedRoutes');
const { db } = require('../models/db');

describe('observedRoutes queries', () => {
  beforeAll(() => {
    db.exec(`DELETE FROM observed_routes WHERE source = 'test-spec-c'`);
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO observed_routes
        (dep_iata, arr_iata, aircraft_icao, airline_iata, seen_at, first_seen_at, source)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    // LHR-JFK on B789 (787 family) flown by BA, AA, VS — within 90d
    stmt.run('LHR', 'JFK', 'B789', 'BA', now - day,    now - 60 * day, 'test-spec-c');
    stmt.run('LHR', 'JFK', 'B789', 'AA', now - 2 * day, now - 30 * day, 'test-spec-c');
    stmt.run('LHR', 'JFK', 'B789', 'VS', now - 3 * day, now - 80 * day, 'test-spec-c');
    // LHR-JFK on B788 (also 787 family) flown by BA — within 90d
    stmt.run('LHR', 'JFK', 'B788', 'BA', now - 5 * day, now - 70 * day, 'test-spec-c');
    // LHR-JFK on A359 (A350 family) flown by VS — within 90d
    stmt.run('LHR', 'JFK', 'A359', 'VS', now - day,    now - 50 * day, 'test-spec-c');
    // LHR-CDG on B789 — different route, should be excluded
    stmt.run('LHR', 'CDG', 'B789', 'BA', now - day,    now - 30 * day, 'test-spec-c');
    // Stale combo (200d ago) — should be excluded by 90d threshold
    stmt.run('LHR', 'NRT', 'B789', 'BA', now - 200 * day, now - 200 * day, 'test-spec-c');
  });

  afterAll(() => {
    db.exec(`DELETE FROM observed_routes WHERE source = 'test-spec-c'`);
  });

  test('countComboByPairAndFamily counts distinct ICAO codes for the family within window', () => {
    const sinceMs = Date.now() - 90 * 24 * 60 * 60 * 1000;
    // Boeing 787 family includes B788 and B789 — 2 model variants observed on LHR-JFK
    const n = obr.countComboByPairAndFamily('lhr', 'jfk', 'boeing-787', sinceMs);
    expect(n).toBe(2);
  });

  test('getByPairAndFamily returns rows joined with family', () => {
    const sinceMs = Date.now() - 90 * 24 * 60 * 60 * 1000;
    const rows = obr.getByPairAndFamily('lhr', 'jfk', 'boeing-787', sinceMs);
    // PRIMARY KEY is (dep_iata, arr_iata, aircraft_icao) — INSERT OR REPLACE collapses
    // 3 inserts of B789 into 1 row (last-writer wins: VS). B788 is 1 row (BA).
    // So 2 rows total: one for B789 (VS), one for B788 (BA).
    expect(rows.length).toBe(2);
    const icaos = [...new Set(rows.map(r => r.aircraft_icao))].sort();
    expect(icaos).toEqual(['B788', 'B789']);
  });

  test('listQualifyingCombos returns (pair, slug) tuples observed in window', () => {
    const sinceMs = Date.now() - 90 * 24 * 60 * 60 * 1000;
    const combos = obr.listQualifyingCombos(sinceMs, 100);
    // Should include LHR-JFK / boeing-787 (4 rows), LHR-JFK / airbus-a350 (1 row),
    // LHR-CDG / boeing-787 (1 row). Should NOT include LHR-NRT / boeing-787 (stale).
    const keys = combos.map(c => `${c.from_iata}-${c.to_iata}-${c.slug}`).sort();
    expect(keys).toContain('lhr-jfk-boeing-787');
    expect(keys).not.toContain('lhr-nrt-boeing-787');
  });

  test('topFamiliesForPair ranks families by combo count', () => {
    const sinceMs = Date.now() - 90 * 24 * 60 * 60 * 1000;
    const list = obr.topFamiliesForPair('lhr', 'jfk', sinceMs, 10);
    // PRIMARY KEY collapses duplicates: boeing-787 = 2 rows (B789 last=VS, B788=BA),
    // airbus-a350 = 1 row (A359=VS). Boeing-787 still ranks first with count=2.
    expect(list[0].slug).toBe('boeing-787');
    expect(list[0].combo_count).toBe(2);
  });
});
