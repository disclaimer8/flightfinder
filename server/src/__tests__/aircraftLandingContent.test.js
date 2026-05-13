// server/src/__tests__/aircraftLandingContent.test.js
//
// SSR tests for the enriched aircraft landing pages (boeing-737 and
// airbus-a320-family). Uses the same db mock harness as seoContentBuilders.test.js.
'use strict';

const { build } = require('../services/seoContentBuilders');

// ---------------------------------------------------------------------------
// Minimal db mock — mirrors what the existing seoContentBuilders tests use.
// bAircraft calls: getAircraftFacts, getAircraftTopRoutes.
// We return enough data to pass the "haveFacts" guard so the builder runs.
// ---------------------------------------------------------------------------
const mockDb = {
  getAircraftFacts: () => ({ airlineCount: 3, routeCount: 5 }),
  getAircraftTopRoutes: () => [
    { from: 'LHR', to: 'JFK', count: 10 },
    { from: 'CDG', to: 'DXB', count: 8 },
  ],
  getTopRoutesByObservedFrequency: () => [],
};

// ---------------------------------------------------------------------------
// Helper: extract all <script type="application/ld+json"> blocks from HTML
// and return a flat array of parsed JSON objects.
// ---------------------------------------------------------------------------
function extractJsonLd(html) {
  const results = [];
  const re = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    try {
      results.push(JSON.parse(m[1]));
    } catch {
      // skip unparseable blocks
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Base metas for the two enriched slugs and one control slug
// ---------------------------------------------------------------------------
const b737Meta = {
  kind: 'aircraft',
  slug: 'boeing-737',
  aircraftLabel: 'Boeing 737',
  icaoList: ['B737', 'B38M'],
  colorBand: { bucket: 'orange', label: 'Last fatal hull loss: 2022', lastFatalDate: '2022-03-21' },
  topEvents: [],
  variants: [],
  fr24Stats: null,
};

const a320Meta = {
  kind: 'aircraft',
  slug: 'airbus-a320-family',
  aircraftLabel: 'Airbus A320 family',
  icaoList: ['A319', 'A320', 'A321'],
  colorBand: { bucket: 'orange', label: 'Last fatal hull loss: 2015', lastFatalDate: '2015-03-24' },
  topEvents: [],
  variants: [],
  fr24Stats: null,
};

const b787Meta = {
  kind: 'aircraft',
  slug: 'boeing-787',
  aircraftLabel: 'Boeing 787',
  icaoList: ['B788', 'B789'],
  colorBand: { bucket: 'green', label: 'No fatal hull losses on record', lastFatalDate: null },
  topEvents: [],
  variants: [],
  fr24Stats: null,
};

// ---------------------------------------------------------------------------
// Test 1: boeing-737 enriched output
// ---------------------------------------------------------------------------
describe('aircraftLandingContent — boeing-737', () => {
  let html;
  beforeAll(() => {
    html = build(b737Meta, mockDb);
  });

  it('HTML contains "Variants and specifications" h2', () => {
    expect(html).toMatch(/Variants and specifications/);
  });

  it('variant table has 7 rows (one per variant)', () => {
    // Count <tr> elements inside <tbody> — each variant gets one <tr>.
    // We look for the variant names as a proxy since row counting via regex is fragile.
    const variantNames = ['737-700', '737-800', '737-900', 'MAX 7', 'MAX 8', 'MAX 9', 'MAX 10'];
    for (const name of variantNames) {
      expect(html).toContain(name);
    }
    // Count <tr> in the variants table — should be 7 data rows + 1 header = 8 total,
    // but we count only tbody rows by checking for the variant name occurrences.
    const trCount = (html.match(/<tr>/g) || []).length;
    // header row (1) + 7 data rows = 8; allow for additional rows from other sections
    expect(trCount).toBeGreaterThanOrEqual(7);
  });

  it('HTML contains "About the 737 MAX" callout heading', () => {
    expect(html).toContain('About the 737 MAX');
  });

  it('HTML contains "Notable accidents and incidents" h2', () => {
    expect(html).toMatch(/Notable accidents and incidents/);
  });

  it('all 6 FAQ questions appear in HTML', () => {
    const questions = [
      'Is the Boeing 737 safe?',
      'How many fatal Boeing 737 accidents have there been?',
      'Which airline has the largest 737 fleet?',
      "What's the difference between the 737-800 and 737 MAX 8?",
      'How many seats does a Boeing 737 have?',
      'When was the Boeing 737 introduced?',
    ];
    for (const q of questions) {
      expect(html).toContain(q);
    }
  });

  it('4 notable incidents are present (Lion Air, Air India Express, Ethiopian, China Eastern)', () => {
    expect(html).toContain('Lion Air 610');
    expect(html).toContain('Air India Express 812');
    expect(html).toContain('Ethiopian Airlines 302');
    expect(html).toContain('China Eastern 5735');
  });
});

// ---------------------------------------------------------------------------
// Test 2: airbus-a320-family enriched output
// ---------------------------------------------------------------------------
describe('aircraftLandingContent — airbus-a320-family', () => {
  let html;
  beforeAll(() => {
    html = build(a320Meta, mockDb);
  });

  it('HTML contains "Variants and specifications" h2', () => {
    expect(html).toMatch(/Variants and specifications/);
  });

  it('variant table has 8 rows (one per variant)', () => {
    const variantNames = ['A319', 'A319neo', 'A320', 'A320neo', 'A321', 'A321neo', 'A321LR', 'A321XLR'];
    for (const name of variantNames) {
      expect(html).toContain(name);
    }
    const trCount = (html.match(/<tr>/g) || []).length;
    expect(trCount).toBeGreaterThanOrEqual(8);
  });

  it('HTML contains "About the A320neo family" callout heading', () => {
    expect(html).toContain('About the A320neo family');
  });

  it('HTML contains "Notable accidents and incidents" h2', () => {
    expect(html).toMatch(/Notable accidents and incidents/);
  });

  it('all 6 FAQ questions appear in HTML', () => {
    const questions = [
      'Is the Airbus A320 family safe?',
      'How many fatal A320 family accidents have there been?',
      'Which airline has the largest A320 family fleet?',
      "What's the difference between the A320 and A321?",
      'How many seats does an A320 have?',
      'When was the A320 family introduced?',
    ];
    for (const q of questions) {
      expect(html).toContain(q);
    }
  });

  it('4 notable incidents present (TAM, AirAsia, Germanwings, US Airways)', () => {
    expect(html).toContain('TAM 3054');
    expect(html).toContain('Indonesia AirAsia 8501');
    expect(html).toContain('Germanwings 9525');
    expect(html).toContain('US Airways 1549');
  });
});

// ---------------------------------------------------------------------------
// Test 3: boeing-787 control — no enrichment blocks present
// ---------------------------------------------------------------------------
describe('aircraftLandingContent — boeing-787 (control, no enrichment)', () => {
  let html;
  beforeAll(() => {
    html = build(b787Meta, mockDb);
  });

  it('HTML does NOT contain "Variants and specifications"', () => {
    expect(html).not.toMatch(/Variants and specifications/);
  });

  it('HTML does NOT contain "Notable accidents and incidents"', () => {
    expect(html).not.toMatch(/Notable accidents and incidents/);
  });

  it('HTML does NOT contain "About the 737 MAX" or "About the A320neo family"', () => {
    expect(html).not.toContain('About the 737 MAX');
    expect(html).not.toContain('About the A320neo family');
  });

  it('standard chrome still wraps output (nav + footer)', () => {
    expect(html).toMatch(/<nav class="seo-nav"/);
    expect(html).toMatch(/<footer class="seo-footer"/);
  });
});

// ---------------------------------------------------------------------------
// Test 4: slug rendering — null slug → plain text; non-null slug → anchor
// ---------------------------------------------------------------------------
describe('aircraftLandingContent — incident slug rendering', () => {
  const {
    renderNotableIncidents,
  } = require('../services/aircraftLandingEnrichment');

  it('incident with slug: null renders as <span> (no anchor)', () => {
    const html = renderNotableIncidents([
      {
        date: '2019-03-10',
        flight: 'Ethiopian Airlines 302',
        operator: 'Ethiopian Airlines',
        variant: '737 MAX 8',
        fatalities: 157,
        summary: 'MCAS-related crash.',
        slug: null,
      },
    ]);
    expect(html).toContain('<span>Ethiopian Airlines 302</span>');
    expect(html).not.toMatch(/<a[^>]*href[^>]*>Ethiopian Airlines 302<\/a>/);
  });

  it('incident with a non-null slug renders as <a href="/accidents/{slug}">', () => {
    const html = renderNotableIncidents([
      {
        date: '2019-03-10',
        flight: 'Ethiopian Airlines 302',
        operator: 'Ethiopian Airlines',
        variant: '737 MAX 8',
        fatalities: 157,
        summary: 'MCAS-related crash.',
        slug: 'ethiopian-airlines-302',
      },
    ]);
    expect(html).toContain('<a href="/accidents/ethiopian-airlines-302">Ethiopian Airlines 302</a>');
  });

  it('incident slug with unsafe characters (e.g. javascript: script) is rejected → plain text', () => {
    const html = renderNotableIncidents([
      {
        date: '2019-03-10',
        flight: 'Test Flight',
        operator: 'Test Airline',
        variant: '737',
        fatalities: 10,
        summary: 'Test.',
        slug: 'javascript:alert(1)',
      },
    ]);
    expect(html).not.toMatch(/href="javascript:/);
    expect(html).toContain('<span>Test Flight</span>');
  });
});

// ---------------------------------------------------------------------------
// Test 5: Schema — FAQPage + ItemList in JSON-LD output
// ---------------------------------------------------------------------------
describe('aircraftLandingContent — JSON-LD schema', () => {
  it('boeing-737: @graph has a FAQPage with all 6 hand-authored questions', () => {
    const html = build(b737Meta, mockDb);
    const blocks = extractJsonLd(html);
    // Find the block containing a FAQPage
    const graphBlock = blocks.find((b) => b['@context'] === 'https://schema.org' && b['@graph']);
    expect(graphBlock).toBeDefined();
    const faqPage = graphBlock['@graph'].find((n) => n['@type'] === 'FAQPage');
    expect(faqPage).toBeDefined();
    expect(Array.isArray(faqPage.mainEntity)).toBe(true);
    expect(faqPage.mainEntity).toHaveLength(6);
    const questions = faqPage.mainEntity.map((q) => q.name);
    expect(questions).toContain('Is the Boeing 737 safe?');
    expect(questions).toContain('When was the Boeing 737 introduced?');
  });

  it('boeing-737: @graph has an ItemList with 7 variant entries', () => {
    const html = build(b737Meta, mockDb);
    const blocks = extractJsonLd(html);
    const graphBlock = blocks.find((b) => b['@context'] === 'https://schema.org' && b['@graph']);
    expect(graphBlock).toBeDefined();
    const itemList = graphBlock['@graph'].find((n) => n['@type'] === 'ItemList');
    expect(itemList).toBeDefined();
    expect(Array.isArray(itemList.itemListElement)).toBe(true);
    expect(itemList.itemListElement).toHaveLength(7);
    // Each item should be a Product
    for (const item of itemList.itemListElement) {
      expect(item.item['@type']).toBe('Product');
      expect(item.item.additionalType).toBe('AircraftModel');
    }
  });

  it('airbus-a320-family: @graph has a FAQPage with 6 questions and ItemList with 8 entries', () => {
    const html = build(a320Meta, mockDb);
    const blocks = extractJsonLd(html);
    const graphBlock = blocks.find((b) => b['@context'] === 'https://schema.org' && b['@graph']);
    expect(graphBlock).toBeDefined();
    const faqPage = graphBlock['@graph'].find((n) => n['@type'] === 'FAQPage');
    expect(faqPage).toBeDefined();
    expect(faqPage.mainEntity).toHaveLength(6);
    const itemList = graphBlock['@graph'].find((n) => n['@type'] === 'ItemList');
    expect(itemList).toBeDefined();
    expect(itemList.itemListElement).toHaveLength(8);
  });

  it('boeing-787 (control): no enriched JSON-LD block in baked output', () => {
    const html = build(b787Meta, mockDb);
    const blocks = extractJsonLd(html);
    // Control page should not have any body-embedded JSON-LD (only head JSON-LD via inject())
    // We confirm by checking no block has an @graph with FAQPage or ItemList from enrichment
    const enrichedBlock = blocks.find((b) =>
      b['@context'] === 'https://schema.org' &&
      b['@graph'] &&
      b['@graph'].some((n) => n['@type'] === 'ItemList' || n['@type'] === 'FAQPage')
    );
    expect(enrichedBlock).toBeUndefined();
  });
});
