'use strict';

const seoMeta = require('../services/seoMetaService');
const safety  = require('../models/safetyEvents');
const db      = require('../models/db');

beforeAll(() => {
  // Clean any leftover rows from prior runs sharing this source tag.
  db.db.exec("DELETE FROM safety_events WHERE source = 'test-vmt'");

  // Schema-adapted seed: safetyEvents.upsertEvent's prepared INSERT requires
  // hull_loss / cictt_category / phase_of_flight / ingested_at / updated_at,
  // so they're filled with neutral defaults beyond what the plan listed.
  const now = Date.now();
  safety.upsertEvent({
    source: 'test-vmt',
    source_event_id: 'vmt1',
    occurred_at: Date.parse('2024-03-01'),
    severity: 'fatal',
    fatalities: 2,
    injuries: 0,
    hull_loss: 0,
    cictt_category: null,
    phase_of_flight: null,
    operator_iata: null,
    operator_icao: null,
    operator_name: 'Test Op',
    aircraft_icao_type: 'B789',
    registration: null,
    dep_iata: null,
    arr_iata: null,
    location_country: 'US',
    location_lat: null,
    location_lon: null,
    narrative: null,
    report_url: null,
    ingested_at: now,
    updated_at: now,
  });
});

afterAll(() => {
  db.db.exec("DELETE FROM safety_events WHERE source = 'test-vmt'");
});

describe('seoMetaService — aircraft variant kind', () => {
  it('resolves /aircraft/boeing-787/variants/787-9 to kind aircraft-variant', () => {
    const meta = seoMeta.resolve('/aircraft/boeing-787/variants/787-9');
    expect(meta.kind).toBe('aircraft-variant');
    expect(meta.canonical).toBe('https://himaxym.com/aircraft/boeing-787/variants/787-9');
    expect(meta.variant).toMatchObject({ icao: 'B789', shortName: '787-9' });
    expect(meta.family).toMatchObject({ name: 'Boeing 787' });
    expect(meta.icaoList).toEqual(['B789']);
    expect(meta.colorBand).toBeTruthy();
    expect(meta.colorBand.bucket).toMatch(/^(green|light-green|yellow|orange|red)$/);
  });

  it('returns not-found when variant slug is unknown', () => {
    const meta = seoMeta.resolve('/aircraft/boeing-787/variants/does-not-exist');
    expect(meta.kind).toBe('not-found');
  });

  it('returns not-found when family slug is unknown', () => {
    const meta = seoMeta.resolve('/aircraft/no-such-family/variants/787-9');
    expect(meta.kind).toBe('not-found');
  });
});

describe('seoMetaService — enriched aircraftMeta', () => {
  it('populates colorBand for /aircraft/boeing-787', () => {
    const meta = seoMeta.resolve('/aircraft/boeing-787');
    expect(meta.colorBand).toBeTruthy();
    expect(meta.colorBand.bucket).toMatch(/^(green|light-green|yellow|orange|red)$/);
    expect(Array.isArray(meta.topEvents)).toBe(true);
    expect(Array.isArray(meta.variants)).toBe(true);
    expect(meta.variants.length).toBeGreaterThan(0);
  });
});

describe('seoMetaService — enriched aircraftSafetyMeta', () => {
  it('populates colorBand and allEvents for /aircraft/boeing-787/safety', () => {
    const meta = seoMeta.resolve('/aircraft/boeing-787/safety');
    expect(meta.colorBand).toBeTruthy();
    expect(Array.isArray(meta.allEvents)).toBe(true);
    expect(Array.isArray(meta.topEvents)).toBe(true);
  });
});
