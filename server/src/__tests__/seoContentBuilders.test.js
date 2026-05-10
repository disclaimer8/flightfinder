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
  });

  it('returns null when meta.variant is missing', () => {
    expect(build({ kind: 'aircraft-variant' })).toBeNull();
  });
});
