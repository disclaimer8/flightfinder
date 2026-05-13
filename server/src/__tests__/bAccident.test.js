'use strict';

jest.mock('../services/sidecarAccidentsClient', () => ({
  getAccidentById: jest.fn(),
  getAccidentIdBySourceEventId: jest.fn(),
  findRelatedByAircraft: jest.fn(() => []),
  findRelatedByOperator: jest.fn(() => []),
}));
const sidecar  = require('../services/sidecarAccidentsClient');
const { db } = require('../models/db');
const model = require('../models/accidentNarratives');
const builders = require('../services/seoContentBuilders');
const seoMeta  = require('../services/seoMetaService');

const NOW = 1715500000;

beforeEach(() => {
  db.exec(`DELETE FROM accident_narratives`);
  jest.clearAllMocks();
});

function seed({ slug, score = 100, accidentId = 42, aircraftModel = 'BEECH F33A' } = {}) {
  model.upsert({
    accident_id: accidentId, source: 'ntsb', source_event_id: `E${accidentId}`,
    source_url: `https://carol.ntsb.gov/event/E${accidentId}`, slug,
    narrative_text: 'x'.repeat(400),
    probable_cause: 'Failure of carb heat during cruise. ' + 'y'.repeat(120),
    factors_json: '["Loss of power","Pilot fatigue"]',
    phase_of_flight: 'CRUISE', weather_summary: 'VMC, wind 270/09kt',
    fetched_at: NOW, ingested_at: NOW, updated_at: NOW,
  });
  sidecar.getAccidentById.mockReturnValue({
    id: accidentId, aircraft_model: aircraftModel, operator: 'Private',
    fatalities: '2', location: 'Minneapolis, MN', date: '25 Apr 2026',
    lat: 44.97, lon: -93.26, source_url: `https://carol.ntsb.gov/event/E${accidentId}`,
  });
}

// ---------------------------------------------------------------------------
// bAccident HTML builder
// ---------------------------------------------------------------------------
describe('bAccident', () => {
  it('returns HTML with hero, probable cause, narrative, factors, attribution', async () => {
    seed({ slug: 'test', score: 100 });
    const html = await builders.bAccident('test');
    expect(html).toMatch(/<h1>[^<]*BEECH F33A[^<]*Private[^<]*<\/h1>/);
    expect(html).toMatch(/Probable cause/);
    expect(html).toMatch(/Failure of carb heat/);
    expect(html).toMatch(/Loss of power/);
    expect(html).toMatch(/wind 270\/09kt/);
    expect(html).toMatch(/carol\.ntsb\.gov\/event\/E42/);
  });

  it('returns null when indexable=0', async () => {
    model.upsert({
      accident_id: 1, source: 'ntsb', source_event_id: 'E1',
      source_url: 'http://x', slug: 'low',
      narrative_text: null, probable_cause: null, factors_json: null,
      phase_of_flight: null, weather_summary: null,
      fetched_at: NOW, ingested_at: NOW, updated_at: NOW,
    });
    sidecar.getAccidentById.mockReturnValue({ id: 1, aircraft_model: 'X' });
    expect(await builders.bAccident('low')).toBeNull();
  });

  // -----------------------------------------------------------------------
  // Related section — similar accidents
  // -----------------------------------------------------------------------
  it('renders related section when similar accidents exist', async () => {
    // Seed two indexable narratives for the same aircraft model.
    // Narrative 1 (the page being viewed):
    seed({ slug: 'test', accidentId: 42, aircraftModel: 'BEECH F33A' });
    // Narrative 2 (the similar one):
    model.upsert({
      accident_id: 99, source: 'ntsb', source_event_id: 'E99',
      source_url: 'https://carol.ntsb.gov/event/E99', slug: 'similar-slug',
      narrative_text: 'z'.repeat(400),
      probable_cause: 'Other cause. ' + 'y'.repeat(120),
      factors_json: '[]',
      phase_of_flight: 'LANDING', weather_summary: null,
      fetched_at: NOW, ingested_at: NOW, updated_at: NOW,
    });

    // sidecar.findRelatedByAircraft returns rows for similar accidents.
    // getAccidentById is called for accident_id=42 (the page) then for others
    // if needed. We only need to mock findRelatedByAircraft here.
    sidecar.findRelatedByAircraft.mockReturnValue([
      { id: 99, date: '10 Jan 2025', aircraft_model: 'BEECH F33A', operator: 'Charter' },
    ]);

    const html = await builders.bAccident('test');
    expect(html).toMatch(/accident__related/);
    expect(html).toMatch(/similar-slug/);
    expect(html).toMatch(/10 Jan 2025/);
  });

  it('gracefully renders when zero similar accidents exist', async () => {
    seed({ slug: 'test' });
    // findRelatedByAircraft returns [] (no similar)
    sidecar.findRelatedByAircraft.mockReturnValue([]);

    const html = await builders.bAccident('test');
    // No related cluster section since there are also no aircraft cross-links
    // for BEECH F33A (not in aircraftFamilies).
    expect(html).not.toMatch(/accident__related/);
  });

  it('renders aircraft cross-link when model resolves to a known family', async () => {
    // "Boeing 737" resolves to family 'Boeing 737' → slug 'boeing-737'.
    // Free-text like "Boeing 737-800" does NOT resolve (variant suffix not in families);
    // test with the exact family display name that resolveFamily recognises.
    seed({ slug: 'test-737', accidentId: 42, aircraftModel: 'Boeing 737' });
    sidecar.findRelatedByAircraft.mockReturnValue([]);

    const html = await builders.bAccident('test-737');
    expect(html).toMatch(/accident__related/);
    expect(html).toMatch(/href="\/aircraft\/boeing-737\/safety"/);
    expect(html).toMatch(/Boeing 737 safety records/);
  });

  it('omits aircraft cross-link when model does not resolve to a family', async () => {
    // BEECH F33A is not in aircraftFamilies → no cross-link.
    seed({ slug: 'test', accidentId: 42, aircraftModel: 'BEECH F33A' });
    sidecar.findRelatedByAircraft.mockReturnValue([]);

    const html = await builders.bAccident('test');
    expect(html).not.toMatch(/\/aircraft\/.*\/safety/);
  });
});

// ---------------------------------------------------------------------------
// seoMeta JSON-LD — @graph with NewsArticle + Event + BreadcrumbList
// ---------------------------------------------------------------------------
describe('seoMeta for /accidents/:slug', () => {
  it('emits canonical + @graph JSON-LD with NewsArticle, Event, BreadcrumbList', () => {
    seed({ slug: 'test' });
    const meta = seoMeta.resolve('/accidents/test');
    expect(meta.canonical).toBe('https://himaxym.com/accidents/test');
    const ld = JSON.parse(meta.jsonLd);
    // Top-level must be @graph now.
    expect(ld['@graph']).toBeDefined();
    expect(Array.isArray(ld['@graph'])).toBe(true);
    expect(ld['@graph']).toHaveLength(3);

    const types = ld['@graph'].map(n => n['@type']);
    expect(types).toContain('NewsArticle');
    expect(types).toContain('Event');
    expect(types).toContain('BreadcrumbList');
  });

  it('NewsArticle.headline matches the H1 string', () => {
    seed({ slug: 'test' });
    const meta = seoMeta.resolve('/accidents/test');
    const ld = JSON.parse(meta.jsonLd);
    const article = ld['@graph'].find(n => n['@type'] === 'NewsArticle');
    // The headline is the raw (pre-escHtml) title string used for H1.
    // seed produces: "25 Apr 2026: BEECH F33A — Private | FlightFinder"
    expect(article.headline).toMatch(/BEECH F33A/);
    expect(article.headline).toMatch(/Private/);
  });

  it('NewsArticle.datePublished is ISO 8601 format', () => {
    seed({ slug: 'test' });
    const meta = seoMeta.resolve('/accidents/test');
    const ld = JSON.parse(meta.jsonLd);
    const article = ld['@graph'].find(n => n['@type'] === 'NewsArticle');
    expect(article.datePublished).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // Verify it's a valid date.
    expect(isNaN(new Date(article.datePublished).getTime())).toBe(false);
  });

  it('BreadcrumbList has exactly 4 items', () => {
    seed({ slug: 'test' });
    const meta = seoMeta.resolve('/accidents/test');
    const ld = JSON.parse(meta.jsonLd);
    const crumbs = ld['@graph'].find(n => n['@type'] === 'BreadcrumbList');
    expect(crumbs.itemListElement).toHaveLength(4);
    // Position 1 = Home, 4 = current page (no `item:` key).
    expect(crumbs.itemListElement[0].position).toBe(1);
    expect(crumbs.itemListElement[0].item).toBe('https://himaxym.com');
    expect(crumbs.itemListElement[3].position).toBe(4);
    expect(crumbs.itemListElement[3].item).toBeUndefined();
  });

  it('Event node preserves startDate and geo coordinates', () => {
    seed({ slug: 'test' });
    const meta = seoMeta.resolve('/accidents/test');
    const ld = JSON.parse(meta.jsonLd);
    const event = ld['@graph'].find(n => n['@type'] === 'Event');
    expect(event.startDate).toBeTruthy();
    expect(event.location.geo.latitude).toBe(44.97);
  });

  it('inject() includes JSON-LD script tag containing both Event and NewsArticle', () => {
    seed({ slug: 'test' });
    const meta = seoMeta.resolve('/accidents/test');
    const template = '<html><head><title>T</title></head><body></body></html>';
    const injected = seoMeta.inject(template, meta);
    expect(injected).toMatch(/<script type="application\/ld\+json">/);
    expect(injected).toMatch(/"@type":"Event"/);
    expect(injected).toMatch(/"@type":"NewsArticle"/);
    expect(injected).toMatch(/"@type":"BreadcrumbList"/);
  });
});
