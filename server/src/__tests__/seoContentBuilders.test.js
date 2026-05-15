// server/src/__tests__/seoContentBuilders.test.js
const { build } = require('../services/seoContentBuilders');

describe('seoContentBuilders.build — static kinds', () => {
  it('returns null for unknown kind', () => {
    expect(build({ kind: 'never-heard-of-this' })).toBeNull();
  });

  it('returns HTML containing pricing tier names for kind=pricing', () => {
    const html = build({ kind: 'pricing' });
    expect(html).toMatch(/Pro Monthly|monthly/i);
    expect(html).toMatch(/Pro Annual|annual|yearly/i);
  });

  it('returns HTML mentioning the team for kind=about', () => {
    const html = build({ kind: 'about' });
    expect(html).toMatch(/<p>/);
    expect(html.length).toBeGreaterThan(200);
  });

  it('returns HTML describing the map for kind=map', () => {
    const html = build({ kind: 'map' });
    expect(html).toMatch(/airport|route|map/i);
  });

  it('returns HTML listing aircraft families for kind=by-aircraft', () => {
    const html = build({ kind: 'by-aircraft' });
    expect(html).toMatch(/<li>/);
  });
});

describe('seoContentBuilders.build — route', () => {
  beforeAll(() => {
    const db = require('../models/db');
    function seed(dep, arr, icao, airline) {
      db.upsertObservedRoute({
        depIata: dep, arrIata: arr, aircraftIcao: icao, airlineIata: airline, source: 'test',
      });
    }
    // 3 distinct (dep,arr,icao) tuples on LHR-JFK -> 3 airlines, 3 aircraft
    seed('LHR', 'JFK', 'B77W', 'BA');
    seed('LHR', 'JFK', 'A359', 'AA');
    seed('LHR', 'JFK', 'B789', 'VS');
  });

  it('returns HTML mentioning airline count and aircraft for a route', () => {
    const { build } = require('../services/seoContentBuilders');
    const meta = {
      kind: 'route',
      fromIata: 'LHR', toIata: 'JFK',
      fromName: 'London Heathrow', toName: 'John F Kennedy',
    };
    const html = build(meta);
    expect(html).toMatch(/airline/i);
    expect(html).toMatch(/B77W|A359|B789/);
  });

  it('returns null for a route with no observed flights', () => {
    const { build } = require('../services/seoContentBuilders');
    const meta = {
      kind: 'route',
      fromIata: 'AAA', toIata: 'BBB',
      fromName: 'X', toName: 'Y',
    };
    expect(build(meta)).toBeNull();
  });
});

describe('seoContentBuilders.build — aircraft + aircraft-specs', () => {
  beforeAll(() => {
    const db = require('../models/db');
    function seed(dep, arr, icao, airline) {
      db.upsertObservedRoute({
        depIata: dep, arrIata: arr, aircraftIcao: icao, airlineIata: airline, source: 'test',
      });
    }
    seed('JFK', 'LHR', 'B77W', 'BA');
    seed('LAX', 'NRT', 'B77W', 'JL');
  });

  it('returns HTML mentioning operator count and a top route for kind=aircraft', () => {
    const { build } = require('../services/seoContentBuilders');
    const meta = {
      kind: 'aircraft',
      slug: 'boeing-777',
      aircraftLabel: 'Boeing 777',
      icaoList: ['B77W'],
    };
    const html = build(meta);
    expect(html).toMatch(/airline/i);
    expect(html).toMatch(/Boeing 777|B77W/);
  });

  it('returns HTML with specs for kind=aircraft-specs', () => {
    const { build } = require('../services/seoContentBuilders');
    const meta = {
      kind: 'aircraft-specs',
      aircraftLabel: 'Boeing 777',
      slug: 'boeing-777',
      icaoList: ['B77W'],
      family: { range_km: 14490, capacity: '301-368', engines: '2 × GE90', mtow_kg: 351500 },
    };
    const html = build(meta);
    expect(html).toMatch(/14490|range/i);
  });

  it('returns null for aircraft with no icaoList', () => {
    const { build } = require('../services/seoContentBuilders');
    expect(build({ kind: 'aircraft', aircraftLabel: 'X' })).toBeNull();
  });
});

describe('seoContentBuilders.build — aircraft subpages', () => {
  const baseMeta = {
    aircraftLabel: 'Boeing 777',
    slug: 'boeing-777',
    icaoList: ['B77W'],
  };

  it('aircraft-airlines lists operators with frequency counts', () => {
    const { build } = require('../services/seoContentBuilders');
    const html = build({ ...baseMeta, kind: 'aircraft-airlines' });
    expect(html).toMatch(/<li>/);
    expect(html).toMatch(/[A-Z]{2}\b/); // some IATA airline code
  });

  it('aircraft-routes lists top city pairs', () => {
    const { build } = require('../services/seoContentBuilders');
    const html = build({ ...baseMeta, kind: 'aircraft-routes' });
    expect(html).toMatch(/<li>/);
  });

  it('aircraft-safety returns null when no safety data is available', () => {
    const { build } = require('../services/seoContentBuilders');
    // No safety fixture seeded — builder should degrade gracefully.
    const html = build({ ...baseMeta, kind: 'aircraft-safety' });
    expect(html).toBeNull();
  });
});

describe('seoContentBuilders.build — home and safety', () => {
  it('home includes a route count', () => {
    const { build } = require('../services/seoContentBuilders');
    const html = build({ kind: 'home' });
    expect(html).toMatch(/route|airport|aircraft/i);
  });

  it('safety-global describes the dataset', () => {
    const { build } = require('../services/seoContentBuilders');
    const html = build({ kind: 'safety-global' });
    expect(html).toMatch(/Aviation Safety Network|NTSB|dataset/i);
  });

  it('safety-feed returns null when no recent incidents are available', () => {
    const { build } = require('../services/seoContentBuilders');
    const html = build({ kind: 'safety-feed' });
    expect(html).toBeNull();
  });
});

describe('seoContentBuilders.build — bAircraft enriched', () => {
  beforeAll(() => {
    const db = require('../models/db');
    db.upsertObservedRoute({
      depIata: 'LHR', arrIata: 'JFK', aircraftIcao: 'B789', airlineIata: 'VS', source: 'test',
    });
  });

  it('renders color band and disclaimer when meta.colorBand is set', () => {
    const meta = {
      kind: 'aircraft',
      slug: 'boeing-787',
      aircraftLabel: 'Boeing 787',
      icaoList: ['B789'],
      colorBand: { bucket: 'yellow', label: 'Last fatal hull loss: 2018', lastFatalDate: '2018-09-20' },
      topEvents: [
        { occurred_at: Date.parse('2018-09-20'), fatalities: 5, operator_name: 'Test Op',
          aircraft_icao_type: 'B789', registration: 'N999', dep_iata: 'JFK', arr_iata: 'LHR',
          report_url: 'https://example.test/report' },
      ],
      variants: [{ familySlug: 'boeing-787', slug: '787-9', shortName: '787-9', description: 'desc one. more.' }],
    };
    const html = build(meta);
    expect(html).toMatch(/safety-band--yellow/);
    expect(html).toMatch(/Last fatal hull loss/);
    expect(html).toMatch(/safety-disclaimer/);
    expect(html).toMatch(/not a commercial safety rating/);
    expect(html).toMatch(/2018-09-20/);
    expect(html).toMatch(/787-9/);
  });

  it('still renders the operator + route paragraph from before', () => {
    const meta = {
      kind: 'aircraft',
      slug: 'boeing-787', aircraftLabel: 'Boeing 787',
      icaoList: ['B789'],
      colorBand: { bucket: 'green', label: 'No fatal hull losses on record', lastFatalDate: null },
      topEvents: [],
      variants: [],
    };
    const html = build(meta);
    expect(html).toMatch(/operated by/i);
    expect(html).toMatch(/safety-band--green/);
  });

  it('renders notable events with missing fields without producing broken HTML', () => {
    const meta = {
      kind: 'aircraft',
      slug: 'boeing-787', aircraftLabel: 'Boeing 787',
      icaoList: ['B789'],
      colorBand: { bucket: 'orange', label: 'Last fatal: 2018', lastFatalDate: '2018-09-20' },
      topEvents: [
        { occurred_at: Date.parse('2018-09-20'), fatalities: 5, aircraft_icao_type: 'B789' },
        { occurred_at: Date.parse('2020-06-10'), operator_name: 'Other Op', aircraft_icao_type: 'B789' },
        { occurred_at: Date.parse('2024-01-15'), operator_name: 'Bad Op', aircraft_icao_type: 'B789',
          report_url: 'javascript:alert(1)' },
      ],
      variants: [],
    };
    const html = build(meta);
    expect(html).not.toMatch(/\(\)/);
    expect(html).not.toMatch(/\(, /);
    expect(html).not.toMatch(/— \(/);
    expect(html).not.toMatch(/href="javascript:/);
    expect(html).toMatch(/Bad Op/);
  });
});

describe('seoContentBuilders.build — bAircraftSafety enriched', () => {
  it('renders color band, top events, and decade-grouped full timeline', () => {
    const meta = {
      kind: 'aircraft-safety',
      slug: 'boeing-787',
      aircraftLabel: 'Boeing 787',
      icaoList: ['B789'],
      colorBand: { bucket: 'orange', label: 'Last fatal hull loss: 2024', lastFatalDate: '2024-03-01' },
      topEvents: [
        { occurred_at: Date.parse('2024-03-01'), fatalities: 2, operator_name: 'Op A', aircraft_icao_type: 'B789' },
      ],
      allEvents: [
        { occurred_at: Date.parse('2024-03-01'), fatalities: 2, operator_name: 'Op A', aircraft_icao_type: 'B789', severity: 'fatal' },
        { occurred_at: Date.parse('2018-09-20'), fatalities: 0, operator_name: 'Op B', aircraft_icao_type: 'B788', severity: 'incident' },
      ],
    };
    const html = build(meta);
    expect(html).toMatch(/safety-band--orange/);
    expect(html).toMatch(/safety-disclaimer/);
    expect(html).toMatch(/<h3>2020s<\/h3>/);
    expect(html).toMatch(/<h3>2010s<\/h3>/);
    expect(html.indexOf('2020s')).toBeLessThan(html.indexOf('2010s'));
    expect(html).toMatch(/Op A/);
  });

  it('renders by-variant breakdown when variants and allEvents are present', () => {
    const meta = {
      kind: 'aircraft-safety',
      slug: 'boeing-787',
      aircraftLabel: 'Boeing 787',
      icaoList: ['B788', 'B789'],
      colorBand: { bucket: 'orange', label: 'Last fatal: 2024', lastFatalDate: '2024-03-01' },
      topEvents: [],
      allEvents: [
        { occurred_at: Date.parse('2024-03-01'), aircraft_icao_type: 'B789', severity: 'fatal' },
        { occurred_at: Date.parse('2018-09-20'), aircraft_icao_type: 'B788', severity: 'incident' },
        { occurred_at: Date.parse('2010-04-15'), aircraft_icao_type: 'B788', severity: 'incident' },
      ],
      variants: [
        { icao: 'B788', shortName: '787-8' },
        { icao: 'B789', shortName: '787-9' },
        { icao: 'B78X', shortName: '787-10' },
      ],
    };
    const html = build(meta);
    expect(html).toMatch(/By variant:/);
    expect(html).toMatch(/787-8 \(2 events\)/);
    expect(html).toMatch(/787-9 \(1 event\)/);
    expect(html).toMatch(/787-10 \(0 events\)/);
  });

  it('renders timeline events with missing fields without producing broken HTML', () => {
    const meta = {
      kind: 'aircraft-safety',
      slug: 'boeing-787',
      aircraftLabel: 'Boeing 787',
      icaoList: ['B789'],
      colorBand: { bucket: 'green', label: 'No fatal hull losses on record', lastFatalDate: null },
      topEvents: [],
      allEvents: [
        // All fields missing except occurred_at
        { occurred_at: Date.parse('2015-01-01') },
        // Operator only
        { occurred_at: Date.parse('2010-06-15'), operator_name: 'Solo Op' },
      ],
    };
    const html = build(meta);
    // No empty <li>
    expect(html).not.toMatch(/<li>\s*<\/li>/);
    // No double em-dash separator
    expect(html).not.toMatch(/— —/);
    // No empty parens
    expect(html).not.toMatch(/\(\)/);
    // Solo Op event still renders the operator
    expect(html).toMatch(/Solo Op/);
    // Decade headers still render even when events are sparse
    expect(html).toMatch(/<h3>2010s<\/h3>/);
  });
});

describe('seoContentBuilders.build — bAircraftVariant', () => {
  beforeAll(() => {
    const { db } = require('../models/db');
    // Clear all observed_routes to ensure empty operators list for this test block
    db.prepare('DELETE FROM observed_routes').run();
  });

  it('renders description, operators, top routes, color band, top-5, and family link', () => {
    const meta = {
      kind: 'aircraft-variant',
      variant: {
        familySlug: 'boeing-787', slug: '787-9',
        icao: 'B789', shortName: '787-9', fullName: 'Boeing 787-9 Dreamliner',
        firstFlight: '2013-09-17', capacity: '290 pax', range_km: 14140,
        engines: ['GE GEnx-1B', 'Rolls-Royce Trent 1000'],
        description: 'Stretched variant of the 787 family. Six metres longer than the 787-8.',
      },
      family: { name: 'Boeing 787', label: 'Boeing 787 Dreamliner', slug: 'boeing-787' },
      icaoList: ['B789'],
      colorBand: { bucket: 'green', label: 'No fatal hull losses on record', lastFatalDate: null },
      topEvents: [],
      allEvents: [],
    };
    const html = build(meta);
    expect(html).toMatch(/Stretched variant/);
    expect(html).toMatch(/safety-band--green/);
    expect(html).toMatch(/safety-disclaimer/);
    // Family link wraps the label in an <a>, so the text is split by markup.
    expect(html).toMatch(/Part of the\s*<a[^>]*href="\/aircraft\/boeing-787"[^>]*>Boeing 787 Dreamliner<\/a>\s*family/);
    expect(html).toMatch(/14140|range/i);
    expect(html).toMatch(/No observed flights for this variant/);
  });

  it('returns null when meta.variant is missing', () => {
    expect(build({ kind: 'aircraft-variant' })).toBeNull();
  });

  it('renders full per-variant decade timeline when allEvents has rows', () => {
    const meta = {
      kind: 'aircraft-variant',
      variant: {
        familySlug: 'boeing-787', slug: '787-9',
        icao: 'B789', shortName: '787-9', fullName: 'Boeing 787-9 Dreamliner',
        firstFlight: '2013-09-17', capacity: '290 pax', range_km: 14140,
        engines: ['GE GEnx-1B'],
        description: 'Stretched variant of the 787 family.',
      },
      family: { name: 'Boeing 787', label: 'Boeing 787 Dreamliner', slug: 'boeing-787' },
      icaoList: ['B789'],
      colorBand: { bucket: 'orange', label: 'Last fatal: 2024', lastFatalDate: '2024-03-01' },
      topEvents: [],
      allEvents: [
        { occurred_at: Date.parse('2024-03-01'), aircraft_icao_type: 'B789', severity: 'fatal', operator_name: 'Op A', fatalities: 2 },
        { occurred_at: Date.parse('2015-06-10'), aircraft_icao_type: 'B789', severity: 'incident', operator_name: 'Op B' },
      ],
    };
    const html = build(meta);
    expect(html).toMatch(/<h3>2020s<\/h3>/);
    expect(html).toMatch(/<h3>2010s<\/h3>/);
    expect(html.indexOf('2020s')).toBeLessThan(html.indexOf('2010s'));
    expect(html).toMatch(/Op A/);
    expect(html).toMatch(/Op B/);
  });
});

describe('seoContentBuilders — _renderFr24Stats', () => {
  // The helpers are private — exercise them via build() with a synthetic kind.
  // Or expose them through module.exports for testing.
  const { _renderFr24Stats, _renderYearlyBreakdown } = require('../services/seoContentBuilders');

  it('returns "" for null stats', () => {
    expect(_renderFr24Stats(null)).toBe('');
  });

  it('returns "" when totalFlights is 0', () => {
    expect(_renderFr24Stats({ totalFlights: 0, fetchedAt: Date.now() })).toBe('');
  });

  it('renders aircraft-context HTML in sample mode (Explorer tier reality)', () => {
    // Explorer tier returns at most 20 records per query — block phrases this
    // as a sample, not as worldwide stats.
    const stats = {
      totalFlights: 20,
      uniqueOperators: 6,
      topOperators: [{ icao: 'ANA', count: 5 }, { icao: 'UAL', count: 4 }],
      topRoutes: [{ from: 'RJTT', to: 'KLAX', count: 2 }],
      yearlyBreakdown: null,
      windowDays: 14,
      fetchedAt: Date.parse('2026-05-10T00:00:00Z'),
    };
    const html = _renderFr24Stats(stats, { context: 'aircraft' });
    expect(html).toMatch(/Recent flights \(Flightradar24 sample\)/);
    expect(html).toMatch(/Sampled <strong>20<\/strong>/);
    expect(html).toMatch(/by 6 airlines/);
    expect(html).toMatch(/last 14 days/);
    expect(html).toMatch(/Operators in this sample:/);
    expect(html).toMatch(/ANA/);
    expect(html).toMatch(/Routes in this sample:/);
    expect(html).toMatch(/RJTT/);
    expect(html).toMatch(/Sample data via Flightradar24, as of 2026-05-10/);
  });

  it('renders route-context HTML and skips routes block (the page IS the route)', () => {
    const stats = {
      totalFlights: 20,
      uniqueOperators: 4,
      topOperators: [{ icao: 'BAW', count: 8 }],
      yearlyBreakdown: null,
      windowDays: 14,
      fetchedAt: Date.parse('2026-05-10T00:00:00Z'),
    };
    const html = _renderFr24Stats(stats, { context: 'route' });
    expect(html).toMatch(/Recent flights on this route/);
    expect(html).toMatch(/Sampled <strong>20<\/strong>/);
    expect(html).toMatch(/by 4 airlines/);
    expect(html).not.toMatch(/Routes in this sample:/);
  });

  it('escapes operator/route ICAO codes', () => {
    const stats = {
      totalFlights: 5,
      uniqueOperators: 1,
      topOperators: [{ icao: '<script>', count: 5 }],
      topRoutes: [{ from: '<x>', to: '<y>', count: 5 }],
      yearlyBreakdown: null,
      windowDays: 14,
      fetchedAt: Date.now(),
    };
    const html = _renderFr24Stats(stats, { context: 'aircraft' });
    expect(html).not.toMatch(/<script>/);
    expect(html).toMatch(/&lt;script&gt;/);
  });
});

describe('seoContentBuilders — FR24 wiring in builders', () => {
  it('bAircraft renders FR24 sample block when meta.fr24Stats is populated', () => {
    const meta = {
      kind: 'aircraft',
      slug: 'boeing-787',
      aircraftLabel: 'Boeing 787',
      icaoList: ['B788', 'B789'],
      colorBand: { bucket: 'green', label: 'No fatal hull losses on record', lastFatalDate: null },
      topEvents: [],
      variants: [],
      fr24Stats: {
        totalFlights: 20,
        uniqueOperators: 6,
        topOperators: [{ icao: 'ANA', count: 5 }],
        topRoutes: [{ from: 'RJTT', to: 'KLAX', count: 2 }],
        yearlyBreakdown: null,
        windowDays: 14,
        fetchedAt: Date.parse('2026-05-10T00:00:00Z'),
      },
    };
    const html = build(meta);
    expect(html).toMatch(/Recent flights \(Flightradar24 sample\)/);
    expect(html).toMatch(/Sampled <strong>20<\/strong>/);
    expect(html).toMatch(/Sample data via Flightradar24/);
  });

  it('bAircraft skips FR24 section when meta.fr24Stats is null', () => {
    const meta = {
      kind: 'aircraft', slug: 'boeing-787', aircraftLabel: 'Boeing 787',
      icaoList: ['B789'],
      colorBand: { bucket: 'green', label: 'No fatal hull losses on record', lastFatalDate: null },
      topEvents: [], variants: [],
      fr24Stats: null,
    };
    const html = build(meta);
    expect(html).not.toMatch(/Recent flights \(Flightradar24 sample\)/);
  });

  it('bAircraftVariant renders FR24 sample block', () => {
    const meta = {
      kind: 'aircraft-variant',
      variant: { familySlug: 'boeing-787', slug: '787-9', icao: 'B789', shortName: '787-9', fullName: 'Boeing 787-9 Dreamliner', firstFlight: '2013-09-17', capacity: '290 pax', range_km: 14140, engines: ['GE'], description: 'Stretched variant.' },
      family: { name: 'Boeing 787', label: 'Boeing 787 Dreamliner', slug: 'boeing-787' },
      icaoList: ['B789'],
      colorBand: { bucket: 'green', label: 'No fatal hull losses on record', lastFatalDate: null },
      topEvents: [], allEvents: [],
      fr24Stats: {
        totalFlights: 15, uniqueOperators: 5, topOperators: [], topRoutes: [],
        yearlyBreakdown: null, windowDays: 14,
        fetchedAt: Date.now(),
      },
    };
    const html = build(meta);
    expect(html).toMatch(/Recent flights \(Flightradar24 sample\)/);
    expect(html).toMatch(/Sampled <strong>15<\/strong>/);
  });

  it('bRoute renders route-context FR24 sample block without routes list', () => {
    const meta = {
      kind: 'route',
      pair: 'JFK-LHR',
      from: 'JFK', to: 'LHR',
      fr24Stats: {
        totalFlights: 12, uniqueOperators: 4,
        topOperators: [{ icao: 'BAW', count: 6 }],
        yearlyBreakdown: null, windowDays: 14,
        fetchedAt: Date.now(),
      },
    };
    const html = build(meta);
    expect(html).toMatch(/Recent flights on this route/);
    expect(html).toMatch(/Sampled <strong>12<\/strong>/);
    expect(html).not.toMatch(/Routes in this sample:/);
  });

  it('bRoute renders both observed facts AND FR24 sample using production field names', () => {
    const meta = {
      kind: 'route',
      pair: 'JFK-LHR',
      fromIata: 'JFK',
      toIata: 'LHR',
      fromName: 'New York',
      toName: 'London',
      fr24Stats: {
        totalFlights: 12,
        uniqueOperators: 4,
        topOperators: [{ icao: 'BAW', count: 6 }],
        yearlyBreakdown: null, windowDays: 14,
        fetchedAt: Date.now(),
      },
    };
    const html = build(meta);
    expect(html).toMatch(/Recent flights on this route/);
    expect(html).toMatch(/Sampled <strong>12<\/strong>/);
    expect(html).not.toMatch(/Routes in this sample:/);
  });

  it('bAircraft renders when only fr24Stats present (relaxed guard)', () => {
    const meta = {
      kind: 'aircraft',
      slug: 'boeing-787',
      aircraftLabel: 'Boeing 787',
      icaoList: ['B789'],
      fr24Stats: {
        totalFlights: 18,
        uniqueOperators: 7,
        topOperators: [],
        topRoutes: [],
        yearlyBreakdown: null, windowDays: 14,
        fetchedAt: Date.now(),
      },
    };
    const html = build(meta);
    expect(html).not.toBeNull();
    expect(html).toMatch(/Recent flights \(Flightradar24 sample\)/);
    expect(html).toMatch(/Sampled <strong>18<\/strong>/);
  });
});

describe('build() — chrome wrapping', () => {
  it('build for aircraft kind wraps with site nav + footer', () => {
    const meta = {
      kind: 'aircraft',
      slug: 'boeing-787',
      aircraftLabel: 'Boeing 787',
      icaoList: ['B789'],
      family: { manufacturer: 'Boeing' },
      colorBand: { bucket: 'green', label: 'No fatal hull losses on record', lastFatalDate: null },
      topEvents: [],
      variants: [],
    };
    const html = build(meta);
    expect(html).toMatch(/<nav class="seo-nav"/);
    expect(html).toMatch(/<footer class="seo-footer"/);
  });

  it('build for unknown/null inner returns null (no chrome wrap)', () => {
    const meta = { kind: 'aircraft', slug: 'no-such-family', icaoList: [] };
    expect(build(meta)).toBeNull();
  });

  it('build for variant kind includes breadcrumbs', () => {
    const meta = {
      kind: 'aircraft-variant',
      variant: { familySlug: 'boeing-787', slug: '787-9', icao: 'B789', shortName: '787-9', fullName: 'Boeing 787-9 Dreamliner', firstFlight: '2013-09-17', capacity: '290 pax', range_km: 14140, engines: ['GE'], description: 'Stretched variant.' },
      family: { name: 'Boeing 787', label: 'Boeing 787 Dreamliner', slug: 'boeing-787' },
      icaoList: ['B789'],
      colorBand: { bucket: 'green', label: 'No fatal hull losses on record', lastFatalDate: null },
      topEvents: [], allEvents: [],
    };
    const html = build(meta);
    expect(html).toMatch(/<nav class="breadcrumbs"/);
    expect(html).toMatch(/Boeing 787/);
    expect(html).toMatch(/787-9/);
  });
});

describe('bHome — rich grid', () => {
  beforeAll(() => {
    const db = require('../models/db');
    function seed(dep, arr, icao, airline) {
      db.upsertObservedRoute({
        depIata: dep, arrIata: arr, aircraftIcao: icao, airlineIata: airline, source: 'test',
      });
    }
    // Seed observed routes so getTopRoutesByObservedFrequency returns rows.
    seed('LHR', 'JFK', 'B77W', 'BA');
    seed('JFK', 'LHR', 'B789', 'VS');
    seed('LAX', 'NRT', 'B77W', 'JL');
  });

  it('renders all sections: intro + family grid + popular routes + safety', () => {
    const meta = { kind: 'home' };
    const html = build(meta);
    expect(html).toMatch(/Search.*observed routes worldwide/);
    expect(html).toMatch(/<h2>Aircraft families<\/h2>/);
    expect(html).toMatch(/<h2>Popular routes<\/h2>/);
    expect(html).toMatch(/<h2>Safety<\/h2>/);
  });

  it('family grid renders family cards with manufacturer + link', () => {
    const html = build({ kind: 'home' });
    expect(html).toMatch(/<article class="family-card"/);
    expect(html).toMatch(/href="\/aircraft\/boeing-787"/);
    expect(html).toMatch(/Boeing/);
  });

  it('popular routes section links to baked routes', () => {
    const html = build({ kind: 'home' });
    expect(html).toMatch(/<ul class="popular-routes"/);
  });

  it('safety section links to global + feed', () => {
    const html = build({ kind: 'home' });
    expect(html).toMatch(/href="\/safety\/global"/);
    expect(html).toMatch(/href="\/safety\/feed"/);
  });
});

describe('bAircraftRoute — aircraft × route combo pages', () => {
  const db = require('../models/db');

  beforeAll(() => {
    db.db.prepare("DELETE FROM observed_routes WHERE source = 'test-ac-route'").run();
    db.upsertObservedRoute({
      depIata: 'JFK', arrIata: 'LHR', aircraftIcao: 'B789',
      airlineIata: 'BA', source: 'test-ac-route',
    });
    db.upsertObservedRoute({
      depIata: 'JFK', arrIata: 'LHR', aircraftIcao: 'B788',
      airlineIata: 'VS', source: 'test-ac-route',
    });
  });

  afterAll(() => {
    db.db.prepare("DELETE FROM observed_routes WHERE source = 'test-ac-route'").run();
  });

  it('returns null when essential fields missing', () => {
    expect(build({ kind: 'aircraft-route', fromIata: 'JFK', toIata: 'LHR' })).toBeNull();
    expect(build({ kind: 'aircraft-route', slug: 'boeing-787' })).toBeNull();
  });

  it('renders rich landing page when route has observations', () => {
    const meta = {
      kind: 'aircraft-route',
      fromIata: 'JFK', toIata: 'LHR',
      fromName: 'New York', toName: 'London',
      aircraftLabel: 'Boeing 787 Dreamliner',
      slug: 'boeing-787',
    };
    const html = build(meta);
    // Rich page must include hero section, airport section, FAQ, and JSON-LD
    expect(html).toMatch(/variant-route-hero-metrics/);
    expect(html).toMatch(/variant-route-airports/);
    expect(html).toMatch(/variant-route-faq/);
    expect(html).toMatch(/FAQPage/);
    expect(html).toMatch(/BreadcrumbList/);
    // Must link back to parent pair page and aircraft page
    expect(html).toMatch(/href="\/routes\/jfk-lhr"/);
    expect(html).toMatch(/href="\/aircraft\/boeing-787"/);
  });

  it('renders explain + cross-links when no observations for combo', () => {
    const meta = {
      kind: 'aircraft-route',
      fromIata: 'ZZZ', toIata: 'YYY',
      fromName: 'Nowhere', toName: 'Elsewhere',
      aircraftLabel: 'Boeing 787 Dreamliner',
      slug: 'boeing-787',
    };
    const html = build(meta);
    expect(html).toMatch(/No recent observations/);
    expect(html).toMatch(/href="\/routes\/zzz-yyy"/);
    expect(html).toMatch(/href="\/aircraft\/boeing-787"/);
  });

  it('chrome wraps the output (site nav + footer)', () => {
    const meta = {
      kind: 'aircraft-route',
      fromIata: 'JFK', toIata: 'LHR',
      fromName: 'New York', toName: 'London',
      aircraftLabel: 'Boeing 787',
      slug: 'boeing-787',
    };
    const html = build(meta);
    expect(html).toMatch(/<nav class="seo-nav"/);
    expect(html).toMatch(/<footer class="seo-footer"/);
    expect(html).toMatch(/<nav class="breadcrumbs"/);
  });
});
