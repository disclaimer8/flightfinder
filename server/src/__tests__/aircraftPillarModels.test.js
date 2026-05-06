'use strict';
const obr = require('../models/observedRoutes');
const safety = require('../models/safetyEvents');
const { db } = require('../models/db');

describe('observedRoutes.getRowsByAircraftCodes', () => {
  beforeAll(() => {
    db.exec(`DELETE FROM observed_routes WHERE source = 'test-spec-d'`);
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO observed_routes
        (dep_iata, arr_iata, aircraft_icao, airline_iata, seen_at, first_seen_at, source)
      VALUES (?, ?, ?, ?, ?, ?, 'test-spec-d')
    `);
    stmt.run('LHR', 'JFK', 'B789', 'BA', now - day, now - 30 * day);
    stmt.run('CDG', 'JFK', 'B789', 'AF', now - 2 * day, now - 30 * day);
    stmt.run('LHR', 'JFK', 'B788', 'BA', now - 3 * day, now - 30 * day);
    stmt.run('JFK', 'LAX', 'A359', 'AA', now - 5 * day, now - 30 * day);
    // Stale row (200 days ago) — should be excluded
    stmt.run('LHR', 'NRT', 'B789', 'BA', now - 200 * day, now - 200 * day);
  });

  afterAll(() => {
    db.exec(`DELETE FROM observed_routes WHERE source = 'test-spec-d'`);
  });

  test('returns rows for any of the codes within window', () => {
    const sinceMs = Date.now() - 90 * 24 * 60 * 60 * 1000;
    const rows = obr.getRowsByAircraftCodes(['B788', 'B789'], sinceMs);
    // 3 rows: LHR-JFK B789 BA, CDG-JFK B789 AF, LHR-JFK B788 BA. Stale LHR-NRT excluded.
    expect(rows.length).toBe(3);
    expect(new Set(rows.map(r => r.aircraft_icao))).toEqual(new Set(['B788', 'B789']));
  });

  test('returns empty for empty codes', () => {
    expect(obr.getRowsByAircraftCodes([], Date.now() - 90 * 86400000)).toEqual([]);
  });

  test('handles lowercase input by normalizing', () => {
    const rows = obr.getRowsByAircraftCodes(['b789'], Date.now() - 90 * 86400000);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every(r => r.aircraft_icao === 'B789')).toBe(true);
  });
});

describe('safetyEvents.getByAircraftCodes', () => {
  beforeAll(() => {
    db.exec(`DELETE FROM safety_events WHERE source = 'test-spec-d'`);
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    const rows = [
      { source: 'test-spec-d', source_event_id: 'd1', occurred_at: now - day, severity: 'fatal', hull_loss: 1, aircraft_icao_type: 'B789', operator_icao: 'BA', operator_name: 'BA' },
      { source: 'test-spec-d', source_event_id: 'd2', occurred_at: now - 2 * day, severity: 'incident', hull_loss: 0, aircraft_icao_type: 'B789', operator_icao: 'AA', operator_name: 'AA' },
      { source: 'test-spec-d', source_event_id: 'd3', occurred_at: now - 3 * day, severity: 'fatal', hull_loss: 1, aircraft_icao_type: 'B788', operator_icao: 'AC', operator_name: 'Air Canada' },
      { source: 'test-spec-d', source_event_id: 'd4', occurred_at: now - 4 * day, severity: 'minor', hull_loss: 0, aircraft_icao_type: 'A359', operator_icao: 'EK', operator_name: 'Emirates' },
    ];
    for (const r of rows) {
      r.fatalities = r.severity === 'fatal' ? 1 : 0;
      r.injuries = 0;
      r.cictt_category = null;
      r.phase_of_flight = null;
      r.operator_iata = null;
      r.registration = null;
      r.dep_iata = null;
      r.arr_iata = null;
      r.location_country = null;
      r.location_lat = null;
      r.location_lon = null;
      r.narrative = null;
      r.report_url = null;
      r.ingested_at = Date.now();
      r.updated_at = Date.now();
    }
    safety.upsertMany(rows);
  });

  afterAll(() => {
    db.exec(`DELETE FROM safety_events WHERE source = 'test-spec-d'`);
  });

  test('returns events for any of the codes', () => {
    const events = safety.getByAircraftCodes(['B788', 'B789'], { limit: 100 });
    const ids = events.filter(e => e.source === 'test-spec-d').map(e => e.source_event_id).sort();
    expect(ids).toEqual(['d1', 'd2', 'd3']);
  });

  test('returns empty for empty codes', () => {
    expect(safety.getByAircraftCodes([], {})).toEqual([]);
  });

  test('respects limit', () => {
    const events = safety.getByAircraftCodes(['B789'], { limit: 1 });
    const own = events.filter(e => e.source === 'test-spec-d');
    expect(own.length).toBeLessThanOrEqual(1);
  });
});
