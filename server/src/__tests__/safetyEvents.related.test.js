'use strict';
const safety = require('../models/safetyEvents');
const { db } = require('../models/db');

describe('safetyEvents related-events queries', () => {
  beforeAll(() => {
    // Seed minimal test data — assumes DB schema is already set up by migrations.
    db.exec(`DELETE FROM safety_events WHERE source = 'test'`);
    const now = Date.now();
    const rows = [
      { source: 'test', source_event_id: 't1', occurred_at: now,           severity: 'fatal',     hull_loss: 1, aircraft_icao_type: 'B789', operator_icao: 'UAL', operator_name: 'United', dep_iata: 'NRT', location_country: 'JP', narrative: 'Probable cause was X. ' + 'Lorem ipsum '.repeat(10) },
      { source: 'test', source_event_id: 't2', occurred_at: now - 1000,    severity: 'fatal',     hull_loss: 1, aircraft_icao_type: 'B789', operator_icao: 'AAL', operator_name: 'American', dep_iata: 'JFK', location_country: 'US', narrative: null },
      { source: 'test', source_event_id: 't3', occurred_at: now - 2000,    severity: 'incident', hull_loss: 0, aircraft_icao_type: 'B789', operator_icao: 'UAL', operator_name: 'United', dep_iata: 'JFK', location_country: 'US', narrative: null },
      { source: 'test', source_event_id: 't4', occurred_at: now - 3000,    severity: 'fatal',     hull_loss: 0, aircraft_icao_type: 'A320', operator_icao: 'UAL', operator_name: 'United', dep_iata: 'NRT', location_country: 'JP', narrative: null },
      { source: 'test', source_event_id: 't5', occurred_at: now - 4000,    severity: 'fatal',     hull_loss: 1, aircraft_icao_type: 'A320', operator_icao: 'DAL', operator_name: 'Delta', dep_iata: 'NRT', location_country: 'JP', narrative: null },
    ];
    for (const r of rows) {
      r.fatalities = 0; r.injuries = 0;
      r.cictt_category = null; r.phase_of_flight = null;
      r.operator_iata = null;
      r.registration = null; r.arr_iata = null;
      r.location_lat = null; r.location_lon = null;
      r.report_url = null; r.ingested_at = Date.now(); r.updated_at = Date.now();
    }
    safety.upsertMany(rows);
  });

  afterAll(() => {
    db.exec(`DELETE FROM safety_events WHERE source = 'test'`);
  });

  test('getByAircraftType returns events on same aircraft, excluding self', () => {
    const seed = db.prepare("SELECT id FROM safety_events WHERE source = 'test' AND source_event_id = 't1'").get();
    const result = safety.getByAircraftType('B789', { exclude: [seed.id], limit: 5 });
    expect(result.length).toBe(2); // t2 + t3
    expect(result.map(r => r.source_event_id).sort()).toEqual(['t2', 't3']);
  });

  test('getByAirport returns events at same dep_iata, excluding self', () => {
    const seed = db.prepare("SELECT id FROM safety_events WHERE source = 'test' AND source_event_id = 't1'").get();
    const result = safety.getByAirport('NRT', { exclude: [seed.id], limit: 5 });
    // t4, t5 also at NRT — t1 excluded
    expect(result.length).toBe(2);
    expect(result.map(r => r.source_event_id).sort()).toEqual(['t4', 't5']);
  });

  test('listIndexable returns only fatal/hull_loss with narrative or ≥3 related', () => {
    // t1: fatal + hull_loss + has narrative → indexable ✓
    // t2: fatal + hull_loss + no narrative — only same-aircraft (t1, t3) = 2; same-operator (t3, t4) = 2; total related: depends on query def
    //     For simplicity: indexable if narrative.length>50 OR same-aircraft-count >= 3 OR same-operator-count >= 3
    // Implementer can adapt query; below tests only the obvious case.
    const result = safety.listIndexable({ limit: 100 });
    const ids = result.map(r => r.source_event_id);
    expect(ids).toContain('t1'); // narrative qualifies
    // t3 is incident (not fatal) → excluded
    expect(ids).not.toContain('t3');
  });

  test('getRelatedEventsCount sums same-aircraft + same-operator + same-airport (excluding self)', () => {
    const seed = db.prepare("SELECT id FROM safety_events WHERE source = 'test' AND source_event_id = 't1'").get();
    // For t1: same-aircraft = 2 (t2, t3), same-operator UAL = 2 (t3, t4), same-airport NRT = 2 (t4, t5)
    // Sum = 6, but we want unique-ish count — implementer chooses semantics. Test just checks > 0.
    expect(safety.getRelatedEventsCount(seed.id)).toBeGreaterThan(0);
  });
});
