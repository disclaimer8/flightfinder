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
    expect(meta.colorBand.bucket).toBe('orange');
    expect(meta.topEvents.length).toBeGreaterThan(0);
    expect(meta.topEvents[0].source_event_id).toBe('vmt1');
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
    expect(meta.colorBand.bucket).toBe('orange');
    expect(Array.isArray(meta.topEvents)).toBe(true);
    expect(meta.topEvents.some((e) => e.source_event_id === 'vmt1')).toBe(true);
    expect(Array.isArray(meta.variants)).toBe(true);
    expect(meta.variants.length).toBeGreaterThan(0);
  });
});

describe('seoMetaService — enriched aircraftSafetyMeta', () => {
  it('populates colorBand and allEvents for /aircraft/boeing-787/safety', () => {
    const meta = seoMeta.resolve('/aircraft/boeing-787/safety');
    expect(meta.colorBand).toBeTruthy();
    expect(meta.colorBand.bucket).toBe('orange');
    expect(Array.isArray(meta.allEvents)).toBe(true);
    expect(Array.isArray(meta.topEvents)).toBe(true);
    expect(meta.topEvents.some((e) => e.source_event_id === 'vmt1')).toBe(true);
  });
});

const fr24Cache = require('../services/fr24CacheService');

describe('seoMetaService — fr24Stats enrichment', () => {
  beforeEach(() => fr24Cache.clear());
  afterAll(() => fr24Cache.clear());

  it('aircraftMeta returns fr24Stats: null when cache empty', () => {
    const meta = seoMeta.resolve('/aircraft/boeing-787');
    expect(meta.fr24Stats).toBeNull();
  });

  it('aircraftMeta populates fr24Stats from family cache key', () => {
    const stats = { totalFlights: 5000, uniqueOperators: 12, topOperators: [], topRoutes: [], yearlyBreakdown: null, windowDays: 365, fetchedAt: Date.now() };
    fr24Cache.set('family:boeing-787', stats);
    const meta = seoMeta.resolve('/aircraft/boeing-787');
    expect(meta.fr24Stats).toEqual(stats);
  });

  it('aircraftVariantMeta populates fr24Stats from variant cache key', () => {
    const stats = { totalFlights: 1000, uniqueOperators: 5, topOperators: [], topRoutes: [], yearlyBreakdown: null, windowDays: 365, fetchedAt: Date.now() };
    fr24Cache.set('variant:B789', stats);
    const meta = seoMeta.resolve('/aircraft/boeing-787/variants/787-9');
    expect(meta.fr24Stats).toEqual(stats);
  });

  it('routeMeta populates fr24Stats from canonical route cache key', () => {
    const stats = { totalFlights: 100, uniqueOperators: 3, topOperators: [], yearlyBreakdown: null, windowDays: 365, fetchedAt: Date.now() };
    // Set under canonical (sorted) form
    fr24Cache.set('route:JFK-LHR', stats);
    // Both directions should resolve to it
    expect(seoMeta.resolve('/routes/JFK-LHR').fr24Stats).toEqual(stats);
    expect(seoMeta.resolve('/routes/LHR-JFK').fr24Stats).toEqual(stats);
  });
});

describe('structuredData — BreadcrumbList for indexable kinds', () => {
  // structuredData() returns a parsed object (not a JSON string) — callers
  // serialize it before injecting into the <script> tag. Tolerate both forms
  // so the tests survive a future refactor to string output.
  function asJson(sd) {
    return typeof sd === 'string' ? JSON.parse(sd) : sd;
  }

  it('emits BreadcrumbList for aircraft-variant kind', () => {
    const meta = seoMeta.resolve('/aircraft/boeing-787/variants/787-9');
    const sd = seoMeta.structuredData(meta);
    const json = asJson(sd);
    const bc = (json['@graph'] || [json]).find((x) => x['@type'] === 'BreadcrumbList');
    expect(bc).toBeTruthy();
    const itemNames = bc.itemListElement.map((i) => i.name);
    expect(itemNames).toContain('Home');
    expect(itemNames).toContain('Aircraft');
    expect(itemNames.some((n) => /Boeing 787/.test(n))).toBe(true);
    expect(itemNames.some((n) => /787-9/.test(n))).toBe(true);
  });

  it('emits BreadcrumbList for route kind', () => {
    const meta = seoMeta.resolve('/routes/jfk-lhr');
    const sd = seoMeta.structuredData(meta);
    const json = asJson(sd);
    const bc = (json['@graph'] || [json]).find((x) => x['@type'] === 'BreadcrumbList');
    expect(bc).toBeTruthy();
    expect(bc.itemListElement.some((i) => /JFK/.test(i.name))).toBe(true);
  });
});

describe('inject() — bake injection survives CSS rule in template', () => {
  it('injects bake section even when template contains CSS selector matching the attribute', () => {
    // Template includes the production CSS rule that hides bake from JS users.
    // Pre-fix bug: the substring `data-seo-bake="true"` matched the CSS selector,
    // so the idempotency check incorrectly skipped injection.
    const template = `<html><head>
      <style>section[data-seo-bake="true"]{display:none}</style>
      <meta name="description" content="orig" />
      <meta name="robots" content="index" />
      <link rel="canonical" href="https://example.com/" />
    </head><body>
      <div id="root">
        <h1 style="font-size:clamp(32px,6vw,56px)">Title</h1>
        <p style="font-size:clamp(16px,2.2vw,20px)">Subtitle</p>
      </div>
    </body></html>`;
    const meta = { title: 't', description: 'd', canonical: 'https://example.com/', h1: 'h', subtitle: 's', kind: 'home' };
    const bodyContent = '<p>baked-content-marker</p>';
    const out = seoMeta.inject(template, meta, bodyContent);
    expect(out).toMatch(/<section data-seo-bake="true">/);
    expect(out).toMatch(/baked-content-marker/);
  });
});
