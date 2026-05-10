'use strict';

const db = require('../models/db');
const safety = require('../models/safetyEvents');

beforeAll(() => {
  // Clean any leftover rows from prior runs sharing this source tag.
  db.db.exec("DELETE FROM safety_events WHERE source = 'test-fatalq'");

  // Seed via prod path (safetyEvents.upsertEvent). The schema's prepared INSERT
  // requires hull_loss / cictt_category / phase_of_flight / ingested_at /
  // updated_at, so they're filled with neutral defaults beyond what the plan's
  // verbatim seed listed.
  function seed(over) {
    const now = Date.now();
    safety.upsertEvent({
      source: 'test-fatalq',
      source_event_id: over.id,
      occurred_at: over.occurred_at,
      severity: over.severity,
      fatalities: over.fatalities || 0,
      injuries: 0,
      hull_loss: over.severity === 'hull_loss' ? 1 : 0,
      cictt_category: null,
      phase_of_flight: null,
      operator_iata: null,
      operator_icao: null,
      operator_name: over.operator || 'Test Operator',
      aircraft_icao_type: over.icao,
      registration: over.reg || null,
      dep_iata: null,
      arr_iata: null,
      location_country: 'US',
      location_lat: null,
      location_lon: null,
      narrative: over.narrative || null,
      report_url: over.url || null,
      ingested_at: now,
      updated_at: now,
    });
  }

  seed({ id: 'tev1', icao: 'B789', occurred_at: Date.parse('2024-01-15'), severity: 'fatal',            fatalities: 3 });
  seed({ id: 'tev2', icao: 'B789', occurred_at: Date.parse('2020-06-10'), severity: 'incident',         fatalities: 0 });
  seed({ id: 'tev3', icao: 'B788', occurred_at: Date.parse('2018-09-20'), severity: 'hull_loss',        fatalities: 5 });
  seed({ id: 'tev4', icao: 'B739', occurred_at: Date.parse('2022-04-01'), severity: 'serious_incident', fatalities: 0 });
});

afterAll(() => {
  db.db.exec("DELETE FROM safety_events WHERE source = 'test-fatalq'");
});

describe('getFatalEventsByIcaoList', () => {
  it('returns only events with severity in (fatal, hull_loss) and fatalities > 0', () => {
    const out = db.getFatalEventsByIcaoList(['B789', 'B788']);
    const ids = out.map((e) => e.source_event_id).sort();
    expect(ids).toEqual(['tev1', 'tev3']);
  });

  it('orders by occurred_at DESC', () => {
    const out = db.getFatalEventsByIcaoList(['B789', 'B788']);
    expect(out[0].source_event_id).toBe('tev1'); // 2024-01
    expect(out[1].source_event_id).toBe('tev3'); // 2018-09
  });

  it('returns [] for empty icao list', () => {
    expect(db.getFatalEventsByIcaoList([])).toEqual([]);
  });

  it('returns [] for unknown icao', () => {
    expect(db.getFatalEventsByIcaoList(['ZZZZ'])).toEqual([]);
  });
});

describe('getAllEventsByIcaoList', () => {
  it('returns all severities for given icaos', () => {
    const out = db.getAllEventsByIcaoList(['B789']);
    const ids = out.map((e) => e.source_event_id).sort();
    expect(ids).toEqual(['tev1', 'tev2']);
  });

  it('respects the limit parameter', () => {
    const out = db.getAllEventsByIcaoList(['B789'], 1);
    expect(out).toHaveLength(1);
  });

  it('orders by occurred_at DESC', () => {
    const out = db.getAllEventsByIcaoList(['B789']);
    expect(out[0].source_event_id).toBe('tev1');
  });

  it('returns [] for empty icao list', () => {
    expect(db.getAllEventsByIcaoList([])).toEqual([]);
  });
});
