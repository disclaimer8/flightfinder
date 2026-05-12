'use strict';

const seoMeta = require('../services/seoMetaService');
const builders = require('../services/seoContentBuilders');
const safety   = require('../models/safetyEvents');
const db       = require('../models/db');

// Helper to fetch the seeded row's id (assigned by SQLite AUTOINCREMENT).
function getId(sourceEventId) {
  return db.db
    .prepare("SELECT id FROM safety_events WHERE source = 'test-sev' AND source_event_id = ?")
    .get(sourceEventId).id;
}

const SEED_ROW = (overrides = {}) => ({
  source: 'test-sev',
  source_event_id: 'sev-stub',
  occurred_at: Date.parse('2026-03-29'),
  severity: 'incident',
  fatalities: 0,
  injuries: 0,
  hull_loss: 0,
  cictt_category: null,
  phase_of_flight: null,
  operator_iata: null,
  operator_icao: null,
  operator_name: null,
  aircraft_icao_type: 'B789',
  registration: null,
  dep_iata: null,
  arr_iata: null,
  location_country: null,
  location_lat: null,
  location_lon: null,
  narrative: null,
  report_url: null,
  ingested_at: Date.now(),
  updated_at: Date.now(),
  ...overrides,
});

beforeAll(() => {
  db.db.exec("DELETE FROM safety_events WHERE source = 'test-sev'");

  // Stub event — matches the production breakage on /safety/events/84:
  // operator unknown, no airport, no narrative. Severity = incident
  // (this is the case that produced "Incident accident:" tautology).
  safety.upsertEvent(SEED_ROW());

  // Fatal-with-narrative event — severity word is meaningful here, so
  // "Fatal accident:" remains acceptable phrasing.
  safety.upsertEvent(SEED_ROW({
    source_event_id: 'sev-fatal',
    occurred_at: Date.parse('2025-09-10'),
    severity: 'fatal',
    hull_loss: 1,
    fatalities: 5,
    operator_name: 'United',
    operator_icao: 'UAL',
    aircraft_icao_type: 'B789',
    dep_iata: 'NRT',
    location_country: 'JP',
    narrative: 'Probable cause was X. ' + 'Lorem ipsum '.repeat(20),
    report_url: 'https://example.com/case/42',
  }));
});

afterAll(() => {
  db.db.exec("DELETE FROM safety_events WHERE source = 'test-sev'");
});

describe('seoMetaService.resolve — safety-event titles', () => {
  it('drops the redundant "accident" word when severity is Incident', () => {
    const id = getId('sev-stub');
    const meta = seoMeta.resolve(`/safety/events/${id}`);
    expect(meta.kind).toBe('safety-event');
    // The pre-fix output was "Incident accident: ..." — a tautology.
    expect(meta.title).not.toMatch(/Incident accident/);
    expect(meta.h1).not.toMatch(/Incident accident/);
    expect(meta.description).not.toMatch(/Incident aviation accident/);
  });

  it('keeps "accident" wording when severity carries weight (Fatal)', () => {
    const id = getId('sev-fatal');
    const meta = seoMeta.resolve(`/safety/events/${id}`);
    expect(meta.kind).toBe('safety-event');
    expect(meta.title).toMatch(/Fatal accident:/);
  });

  it('renders aircraft as a human-readable family label, not raw ICAO code', () => {
    const id = getId('sev-stub');
    const meta = seoMeta.resolve(`/safety/events/${id}`);
    // B789 should resolve to the Boeing 787 family — never the raw 4-char code.
    expect(meta.title).toMatch(/Boeing 787/);
    expect(meta.h1).toMatch(/Boeing 787/);
    expect(meta.title).not.toMatch(/\bB789\b/);
    expect(meta.h1).not.toMatch(/\bB789\b/);
  });
});

describe('seoContentCache.getOrBuild — lazy bake for safety-event', () => {
  const cache = require('../services/seoContentCache');

  beforeEach(() => cache._clearForTests());

  it('lazily bakes /safety/events/:id and returns HTML', async () => {
    const id = getId('sev-fatal');
    const html = await cache.getOrBuild(`/safety/events/${id}`);
    expect(html).not.toBeNull();
    expect(typeof html).toBe('string');
    expect(html).toContain('2025-09-10');
    expect(html).toContain('Boeing 787');
  });

  it('returns null for non-existent event id', async () => {
    const html = await cache.getOrBuild('/safety/events/9999999');
    expect(html).toBeNull();
  });
});

describe('seoContentBuilders — bSafetyEvent', () => {
  it('produces non-null bake HTML for safety-event kind', () => {
    const id = getId('sev-fatal');
    const meta = seoMeta.resolve(`/safety/events/${id}`);
    const html = builders.build(meta);
    expect(html).not.toBeNull();
    expect(typeof html).toBe('string');
  });

  it('includes the date, operator, and aircraft family in the bake', () => {
    const id = getId('sev-fatal');
    const meta = seoMeta.resolve(`/safety/events/${id}`);
    const html = builders.build(meta);
    expect(html).toContain('2025-09-10');
    expect(html).toContain('United');
    expect(html).toContain('Boeing 787');
  });

  it('includes the narrative when present', () => {
    const id = getId('sev-fatal');
    const meta = seoMeta.resolve(`/safety/events/${id}`);
    const html = builders.build(meta);
    expect(html).toMatch(/Probable cause/);
  });

  it('bakes minimal content even for stub events (no operator/narrative)', () => {
    const id = getId('sev-stub');
    const meta = seoMeta.resolve(`/safety/events/${id}`);
    const html = builders.build(meta);
    // Even with sparse data we must emit *something* — otherwise the React
    // shell wins and the bot sees the home-page FAQ as the page content.
    expect(html).not.toBeNull();
    expect(html).toContain('2026-03-29');
  });
});
