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

function seed({ slug, score = 100 }) {
  model.upsert({
    accident_id: 42, source: 'ntsb', source_event_id: 'E42',
    source_url: 'https://carol.ntsb.gov/event/E42', slug,
    narrative_text: 'x'.repeat(400),
    probable_cause: 'Failure of carb heat during cruise. ' + 'y'.repeat(120),
    factors_json: '["Loss of power","Pilot fatigue"]',
    phase_of_flight: 'CRUISE', weather_summary: 'VMC, wind 270/09kt',
    fetched_at: NOW, ingested_at: NOW, updated_at: NOW,
  });
  sidecar.getAccidentById.mockReturnValue({
    id: 42, aircraft_model: 'BEECH F33A', operator: 'Private',
    fatalities: '2', location: 'Minneapolis, MN', date: '25 Apr 2026',
    lat: 44.97, lon: -93.26, source_url: 'https://carol.ntsb.gov/event/E42',
  });
}

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
});

describe('seoMeta for /accidents/:slug', () => {
  it('emits canonical + JSON-LD Event schema', async () => {
    seed({ slug: 'test' });
    // The real export is `resolve`, not `metaFor`
    const meta = seoMeta.resolve('/accidents/test');
    expect(meta.canonical).toBe('https://himaxym.com/accidents/test');
    const ld = JSON.parse(meta.jsonLd);
    expect(ld['@type']).toBe('Event');
    expect(ld.startDate).toBeTruthy();
    expect(ld.location.geo.latitude).toBe(44.97);
  });

  it('inject() includes JSON-LD Event script tag', async () => {
    seed({ slug: 'test' });
    // Simulate full pipeline: resolve builds meta (with jsonLd), inject applies
    // structured-data to the HTML template. buildAsync produces the bake fragment
    // but inject operates on the full index.html template — simulate with a
    // minimal template that has the required </head> anchor.
    const meta = seoMeta.resolve('/accidents/test');
    const template = '<html><head><title>T</title></head><body></body></html>';
    const injected = seoMeta.inject(template, meta);
    expect(injected).toMatch(/<script type="application\/ld\+json">/);
    expect(injected).toMatch(/"@type":"Event"/);
  });
});
