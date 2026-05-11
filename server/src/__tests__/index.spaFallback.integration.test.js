/**
 * End-to-end integration test: spaFallback injects baked SEO content.
 *
 * index.js only mounts the spaFallback block when IS_DEV is false
 * (i.e. NODE_ENV === 'production'). We switch NODE_ENV to 'production'
 * for the duration of this test file, then restore it after so other
 * test files are unaffected.
 *
 * client/dist/ is gitignored (build artifact). This test creates a minimal
 * index.html fixture at that path before requiring index.js and removes it
 * in afterAll, so the test is fully self-contained with no committed dist.
 *
 * Path note: index.js computes clientBuild as
 *   path.join(__dirname, '../../client/dist')
 * where __dirname = server/src. So the fixture must live at
 *   <worktree-root>/client/dist/index.html
 * which is path.resolve(__dirname, '../../../client/dist') from __tests__.
 */

const fs   = require('fs');
const path = require('path');
const request = require('supertest');

// The path that index.js resolves to for clientBuild:
//   server/src/__dirname = <worktree>/server/src
//   path.join(__dirname, '../../client/dist') = <worktree>/client/dist
// From this test file (__dirname = <worktree>/server/src/__tests__):
//   path.resolve(__dirname, '../../../client/dist') = <worktree>/client/dist
const distDir     = path.resolve(__dirname, '../../../client/dist');
const fixtureFile = path.join(distDir, 'index.html');

// Minimal index.html that satisfies seoMetaService.inject()'s string
// searches (title, description, canonical, og:*, h1, p#subtitle markers).
// The h1/p markers must match the exact prefix strings used in inject().
const FIXTURE_HTML = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>FlightFinder — Search Flights by Aircraft Type | Boeing, Airbus &amp; More</title>
    <meta name="description" content="Search flights worldwide filtered by aircraft type." />
    <meta name="robots" content="index, follow" />
    <link rel="canonical" href="https://himaxym.com/" />
    <meta property="og:type" content="website" />
    <meta property="og:url" content="https://himaxym.com/" />
    <meta property="og:title" content="FlightFinder" />
    <meta property="og:description" content="The only flight search filtered by aircraft model." />
    <meta property="og:image" content="https://himaxym.com/og-image.png" />
    <meta property="og:image:alt" content="FlightFinder" />
    <meta name="twitter:title" content="FlightFinder" />
    <meta name="twitter:description" content="The only flight search filtered by aircraft model." />
    <meta name="twitter:image" content="https://himaxym.com/og-image.png" />
    <meta name="twitter:image:alt" content="FlightFinder" />
    <style>section[data-seo-bake="true"]{display:none}</style>
  </head>
  <body>
    <div id="root">
      <div style="min-height:100vh;">
        <h1 style="font-size:clamp(32px,6vw,56px);line-height:1.1;margin:0 0 16px;font-weight:800;">Find flights by aircraft type</h1>
        <p style="font-size:clamp(16px,2.2vw,20px);color:#94a3b8;margin:0 0 32px;">Search routes worldwide, filtered by aircraft model — Boeing 737, Airbus A320, turboprops, wide-body jets and more.</p>
      </div>
    </div>
  </body>
</html>`;

let createdDir  = false;
let createdFile = false;

const _savedNodeEnv = process.env.NODE_ENV;

describe('SPA fallback bakes content for known SEO URLs', () => {
  let app;

  beforeAll(() => {
    // Create client/dist/index.html fixture if it doesn't already exist.
    // (In a real CI with a built client it would already be present.)
    if (!fs.existsSync(distDir)) {
      fs.mkdirSync(distDir, { recursive: true });
      createdDir = true;
    }
    if (!fs.existsSync(fixtureFile)) {
      fs.writeFileSync(fixtureFile, FIXTURE_HTML, 'utf8');
      createdFile = true;
    }

    jest.resetModules();

    // Seed the DB under test mode so it stays in-memory.
    process.env.NODE_ENV = 'test';
    const db = require('../models/db');
    db.upsertObservedRoute({
      depIata: 'LHR', arrIata: 'JFK', aircraftIcao: 'B77W', airlineIata: 'BA', source: 'test',
    });
    db.upsertObservedRoute({
      depIata: 'JFK', arrIata: 'LHR', aircraftIcao: 'B789', airlineIata: 'BA', source: 'test',
    });

    // Now load index.js under production mode so the spaFallback + warm
    // branches activate. db.js was already loaded under 'test' and the
    // module cache returns the in-memory instance — index.js's transitive
    // require sees the same DB that we just seeded.
    process.env.NODE_ENV = 'production';
    app = require('../index');

    // index.js no longer warms inline; warm explicitly for the test.
    const cache = require('../services/seoContentCache');
    cache.warm({ schedule: false });
  });

  afterAll(() => {
    try {
      // Clean up the fixture files we created so the repo stays tidy.
      if (createdFile && fs.existsSync(fixtureFile)) fs.unlinkSync(fixtureFile);
      if (createdDir && fs.existsSync(distDir)) {
        try { fs.rmdirSync(distDir); } catch {}
      }
    } finally {
      // Restore NODE_ENV so subsequent test files run under 'test'.
      process.env.NODE_ENV = _savedNodeEnv;
      jest.resetModules();
    }
  });

  it('GET /pricing includes the baked Pro paragraph', async () => {
    const res = await request(app).get('/pricing');
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/data-seo-bake/);
    expect(res.text).toMatch(/Pro Monthly|Pro Annual/);
  });

  it('GET /about includes baked about copy inside #root', async () => {
    const res = await request(app).get('/about');
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/data-seo-bake/);
  });

  it('GET /aircraft/boeing-787/variants/787-9 includes baked variant content + color band', async () => {
    // Pre-warm the cache after seeding inside beforeAll already ran.
    const cache = require('../services/seoContentCache');
    cache.warm({ schedule: false });

    const res = await request(app).get('/aircraft/boeing-787/variants/787-9');
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/data-seo-bake/);
    expect(res.text).toMatch(/787-9/);
    expect(res.text).toMatch(/safety-band--/);
    expect(res.text).toMatch(/safety-disclaimer/);
    expect(res.text).toMatch(/Part of the/);
  });

  it('GET /unknown-path returns HTML with no bake section', async () => {
    const res = await request(app).get('/this-does-not-exist');
    // Unknown paths resolve to meta.kind === 'not-found', which the spaFallback
    // responds to with HTTP 404 (preserving crawl-budget for bot-fuzz typos)
    // while still serving the React shell so human visitors see the in-app
    // "not found" screen. No bake section is emitted for unknown paths.
    expect(res.status).toBe(404);
    // The CSS hide rule (selector substring) is in the template, but no
    // bake <section> start tag should be injected for unknown paths.
    expect(res.text).not.toMatch(/<section data-seo-bake="true"/);
  });

  it('GET /aircraft/boeing-787 includes FR24 worldwide activity when cache populated', async () => {
    const fr24Cache = require('../services/fr24CacheService');
    fr24Cache.set('family:boeing-787', {
      totalFlights: 47200,
      uniqueOperators: 84,
      topOperators: [{ icao: 'ANA', count: 3200 }],
      topRoutes: [{ from: 'RJTT', to: 'KLAX', count: 340 }],
      yearlyBreakdown: [{ year: 2025, count: 47200 }, { year: 2024, count: 38400 }],
      fetchedAt: Date.now(),
    });
    require('../services/seoContentCache').warm({ schedule: false });

    const res = await request(app).get('/aircraft/boeing-787');
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/Worldwide activity \(last 12 months\)/);
    expect(res.text).toMatch(/47,200/);
    expect(res.text).toMatch(/5-year trend/);
  });

  it('GET /aircraft/boeing-787/variants/787-9 includes FR24 + 5-year trend', async () => {
    const fr24Cache = require('../services/fr24CacheService');
    fr24Cache.set('variant:B789', {
      totalFlights: 12000,
      uniqueOperators: 25,
      topOperators: [{ icao: 'UAL', count: 1500 }],
      topRoutes: [],
      yearlyBreakdown: [{ year: 2025, count: 12000 }, { year: 2024, count: 10000 }],
      fetchedAt: Date.now(),
    });
    require('../services/seoContentCache').warm({ schedule: false });

    const res = await request(app).get('/aircraft/boeing-787/variants/787-9');
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/Worldwide activity/);
    expect(res.text).toMatch(/5-year trend/);
  });

  it('GET /routes/JFK-LHR includes FR24 route-context section when cache populated', async () => {
    // Seed enough observed_routes that JFK and LHR both qualify as hubs
    // (≥15 distinct destinations each) so /routes/jfk-lhr appears in
    // enumerateSeoUrls()'s hub-network edges and the warm pass bakes it.
    const db = require('../models/db');
    const PAD = ['ATL','BOS','CDG','DFW','EWR','FRA','HKG','IST','LAX','MAD','MIA','MUC','NRT','ORD','SEA','SFO','SIN','SYD','YYZ','ZRH'];
    for (const a of PAD) {
      db.upsertObservedRoute({ depIata: 'JFK', arrIata: a, aircraftIcao: 'B789', airlineIata: 'BA', source: 'test' });
      db.upsertObservedRoute({ depIata: 'LHR', arrIata: a, aircraftIcao: 'B789', airlineIata: 'BA', source: 'test' });
    }

    const fr24Cache = require('../services/fr24CacheService');
    fr24Cache.set('route:JFK-LHR', {
      totalFlights: 847,
      uniqueOperators: 12,
      topOperators: [{ icao: 'BAW', count: 340 }],
      yearlyBreakdown: null,
      fetchedAt: Date.now(),
    });
    require('../services/seoContentCache').warm({ schedule: false });

    const res = await request(app).get('/routes/jfk-lhr');
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/Worldwide activity on this route/);
    expect(res.text).toMatch(/Flown.*847/);
    expect(res.text).not.toMatch(/Top routes:/);
  });

  it('GET /aircraft/boeing-787 omits FR24 section when cache empty', async () => {
    const fr24Cache = require('../services/fr24CacheService');
    fr24Cache.clear();
    require('../services/seoContentCache').warm({ schedule: false });

    const res = await request(app).get('/aircraft/boeing-787');
    expect(res.status).toBe(200);
    expect(res.text).not.toMatch(/Worldwide activity/);
  });

  it('GET / includes family grid + popular routes + safety section + chrome', async () => {
    require('../services/seoContentCache').warm({ schedule: false });
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/<nav class="seo-nav"/);
    expect(res.text).toMatch(/<footer class="seo-footer"/);
    expect(res.text).toMatch(/<h2>Aircraft families<\/h2>/);
    expect(res.text).toMatch(/<h2>Popular routes<\/h2>/);
    expect(res.text).toMatch(/<h2>Safety<\/h2>/);
  });

  it('GET /aircraft/boeing-787 includes breadcrumbs + cross-refs + chrome', async () => {
    require('../services/seoContentCache').warm({ schedule: false });
    const res = await request(app).get('/aircraft/boeing-787');
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/<nav class="breadcrumbs"/);
    expect(res.text).toMatch(/Boeing 787/);
    // Family-page cross-ref ("Other Boeing families") now wired via
    // seoMetaService._bakeFamilyFields propagating manufacturer.
    expect(res.text).toMatch(/Other Boeing families/);
    expect(res.text).toMatch(/<h3>Variants<\/h3>/);
    expect(res.text).toMatch(/<footer class="seo-footer"/);
  });

  it('GET /aircraft/boeing-787/variants/787-9 includes variant breadcrumbs + sibling cross-refs', async () => {
    require('../services/seoContentCache').warm({ schedule: false });
    const res = await request(app).get('/aircraft/boeing-787/variants/787-9');
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/<nav class="breadcrumbs"/);
    expect(res.text).toMatch(/787-9/);
    expect(res.text).toMatch(/Other variants in this family/);
    expect(res.text).toMatch(/787-8/);
    expect(res.text).toMatch(/787-10/);
  });

  it('GET /aircraft/boeing-787/safety includes "More about" cross-ref excluding self', async () => {
    require('../services/seoContentCache').warm({ schedule: false });
    const res = await request(app).get('/aircraft/boeing-787/safety');
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/More about Boeing 787/);
    expect(res.text).toMatch(/href="\/aircraft\/boeing-787\/airlines"/);
    expect(res.text).toMatch(/href="\/aircraft\/boeing-787\/routes"/);
  });

  it('served HTML contains both CSS hide rule AND bake section', async () => {
    const res = await request(app).get('/aircraft/boeing-787');
    expect(res.text).toMatch(/section\[data-seo-bake="true"\]\{display:none\}/);
    expect(res.text).toMatch(/<section data-seo-bake="true">/);
  });
});
