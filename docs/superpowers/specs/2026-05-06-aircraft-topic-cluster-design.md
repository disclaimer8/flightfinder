# Aircraft Topic-Cluster Pillar Architecture — Design Spec

**Date:** 2026-05-06
**Owner:** Solo (denyskolomiiets)
**Status:** Approved
**Scope:** SEO Growth roadmap, Spec D (final spec of A–D)

---

## 1. Goal

Convert each `/aircraft/{slug}` from a single mixed-depth page into a topic-cluster pillar: parent hub + 4 dedicated sub-pages (`/airlines`, `/routes`, `/safety`, `/specs`) capturing long-tail "{aircraft} {dimension}" queries. Bidirectional internal linking between hub and leaves; cross-spec wiring to Spec B (safety events) and Spec C (aircraft × route grid) for compounding PageRank.

**Coverage:** 19 families × 4 sub-pages = **76 new programmatic pages**.

**Success criterion:** Google indexes ≥50 of the 76 sub-page URLs within 8 weeks of deploy. Each sub-page passes Google's Rich Results Test for BreadcrumbList + Vehicle. Templated prose paragraphs ≥150 words per page (avoids thin-content penalty).

---

## 2. Background

The 2026-05-06 SEO audit's Strategic Recommendation E1 ("Topic-cluster architecture around aircraft pillars") explicitly proposed this:

> Each `/aircraft/{slug}` becomes the pillar. Spawn supporting cluster:
> - `/aircraft/boeing-787/airlines` — every operator
> - `/aircraft/boeing-787/routes` — top 50 routes
> - `/aircraft/boeing-787/safety` — incident history pulled from accident DB
> - `/aircraft/boeing-787/specs` — range, capacity, engines
>
> Bidirectional internal links + breadcrumbs.
> Targets long-tail "Boeing 787 airlines list", "787 safety record" — high-intent, low-competition.

This spec is the implementation. Decisions made during brainstorm:

- **Q1 (D):** full pillar — all 4 sub-pages + parent restructured as hub.
- **Q2 (A):** specs data hardcoded in `aircraftSpecs.json` (no Wikidata API).
- **Q3 (B):** templated prose + data on each sub-page (~250 words prose).

---

## 3. Architecture

**URL structure:**

```
/aircraft/boeing-787              ← parent hub (existing, restructured)
  ├─ /airlines                    ← NEW: full operator list
  ├─ /routes                      ← NEW: top 50 routes (deep-link to Spec C pages)
  ├─ /safety                      ← NEW: full incident history
  └─ /specs                       ← NEW: technical specifications
```

**Files added:**

Client:
- `client/src/components/AircraftAirlines.jsx`
- `client/src/components/AircraftRoutes.jsx`
- `client/src/components/AircraftSafety.jsx`
- `client/src/components/AircraftSpecs.jsx`
- `client/src/components/AircraftPillar.css` — shared CSS for all 4 sub-pages

Server:
- `server/src/data/aircraftSpecs.json` — 19 families × ~15 spec fields
- `server/src/services/aircraftPillarService.js` — orchestrates queries across observed_routes + safety_events + specs JSON

**Files modified:**

Client:
- `client/src/index.jsx` — register 4 new lazy routes
- `client/src/components/AircraftLandingPage.jsx` — restructure into 4 hub cards with "View full X →" CTAs

Server:
- `server/src/models/observedRoutes.js` — add `getRowsByAircraftCodes(codes, sinceMs)`
- `server/src/models/safetyEvents.js` — add `getByAircraftCodes(codes, { limit })`
- `server/src/services/seoMetaService.js` — 4 new resolver branches + 4 JSON-LD branches
- `server/src/routes/seo.js` — sitemap appends 76 URLs
- `server/src/routes/landingRoutes.js` — 4 new endpoints

**Branch:** `feat/aircraft-topic-cluster` from main (after PR #81 merges).

**Cross-spec ecosystem:**
- Spec B: `/safety/events/{slug-id}` ← linked from `/aircraft/{slug}/safety` rows
- Spec C: `/routes/{pair}/{slug}` ← linked from `/aircraft/{slug}/routes` rows
- Spec D ↔ existing parent `/aircraft/{slug}`: bidirectional via "View full" CTAs

---

## 4. Specs data — `aircraftSpecs.json`

19 families × ~15 fields. Sources: Wikipedia infoboxes + manufacturer official spec sheets. ~150 lines total.

```json
{
  "_doc": "Manually compiled aircraft specifications. Sources: Wikipedia, manufacturer spec sheets. One entry per family slug. Updated manually when new variants ship.",
  "families": {
    "boeing-787": {
      "manufacturer": "Boeing",
      "first_flight": "2009-12-15",
      "in_service_since": "2011-10-26",
      "variants": ["787-8", "787-9", "787-10"],
      "passenger_capacity_typical": "242–330",
      "max_range_km": 14140,
      "max_takeoff_weight_kg": 254000,
      "wingspan_m": 60.1,
      "length_m": 56.7,
      "height_m": 16.9,
      "max_speed_kmh": 954,
      "service_ceiling_m": 13100,
      "engines": ["Rolls-Royce Trent 1000", "GE GEnx-1B"],
      "cabin_width_m": 5.49,
      "fuselage_material": "Carbon-fibre composite (~50%)"
    },
    "airbus-a320": { /* ... 14 more fields ... */ },
    "...": "..."  // 17 more families
  }
}
```

⚠️ Implementer compiles full 19-family sheet during execution. If a field is genuinely unknown for a particular family (e.g. `cabin_width_m` for ATR turboprops), use `null` — client renders `—` for null fields.

---

## 5. Backend service + endpoints

### 5.1 Model extensions

**`server/src/models/observedRoutes.js`** — add prepared statement + export:

```js
getRowsByAircraftCodes: db.prepare(`
  SELECT dep_iata, arr_iata, aircraft_icao, airline_iata, seen_at, first_seen_at
  FROM observed_routes
  WHERE UPPER(aircraft_icao) IN (/* dynamic placeholders */)
    AND seen_at >= ?
  ORDER BY seen_at DESC
`),
```

⚠️ Dynamic IN-list: build placeholders at call time since SQLite doesn't support array binding. Pattern:
```js
function getRowsByAircraftCodes(codes, sinceMs) {
  if (!codes || codes.length === 0) return [];
  const placeholders = codes.map(() => '?').join(',');
  const sql = `SELECT ... WHERE UPPER(aircraft_icao) IN (${placeholders}) AND seen_at >= ? ORDER BY seen_at DESC`;
  return db.prepare(sql).all(...codes.map(c => c.toUpperCase()), sinceMs);
}
```

**`server/src/models/safetyEvents.js`** — add `getByAircraftCodes(codes, { limit })`:

```js
function getByAircraftCodes(codes, { limit = 100 } = {}) {
  if (!codes || codes.length === 0) return [];
  const placeholders = codes.map(() => '?').join(',');
  const sql = `
    SELECT * FROM safety_events
    WHERE aircraft_icao_type IN (${placeholders})
    ORDER BY occurred_at DESC
    LIMIT ?
  `;
  return db.prepare(sql).all(...codes.map(c => c.toUpperCase()), Math.min(Math.max(Number(limit) || 100, 1), 500));
}
```

### 5.2 `aircraftPillarService.js`

```js
'use strict';
const obr = require('../models/observedRoutes');
const safety = require('../models/safetyEvents');
const openFlights = require('./openFlightsService');
const { getFamilyBySlug } = require('../models/aircraftFamilies');
const aircraftSpecs = require('../data/aircraftSpecs.json');

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

function getSpecsForSlug(slug) {
  return aircraftSpecs.families?.[slug] || null;
}

function getOperatorsForAircraft(slug, { limit = 50 } = {}) {
  const fam = getFamilyBySlug(slug);
  if (!fam) return [];
  const codes = (fam.icaoTypes || []).map(c => c.toUpperCase());
  if (codes.length === 0) return [];

  const rows = obr.getRowsByAircraftCodes(codes, Date.now() - NINETY_DAYS_MS);
  const byAirline = new Map();
  for (const r of rows) {
    if (!r.airline_iata) continue;
    if (!byAirline.has(r.airline_iata)) {
      byAirline.set(r.airline_iata, {
        airline_iata: r.airline_iata,
        airline_name: openFlights.getAirline(r.airline_iata)?.name || r.airline_iata,
        route_count: 0,
        models: new Set(),
        last_seen_at: r.seen_at,
        sample_routes: [],
      });
    }
    const a = byAirline.get(r.airline_iata);
    a.route_count += 1;
    a.models.add(r.aircraft_icao);
    if (r.seen_at > a.last_seen_at) a.last_seen_at = r.seen_at;
    if (a.sample_routes.length < 3) {
      a.sample_routes.push(`${r.dep_iata}-${r.arr_iata}`);
    }
  }
  return [...byAirline.values()]
    .map(a => ({ ...a, models: [...a.models].sort() }))
    .sort((a, b) => b.route_count - a.route_count)
    .slice(0, limit);
}

function getRoutesForAircraft(slug, { limit = 50 } = {}) {
  const fam = getFamilyBySlug(slug);
  if (!fam) return [];
  const codes = (fam.icaoTypes || []).map(c => c.toUpperCase());
  if (codes.length === 0) return [];

  const rows = obr.getRowsByAircraftCodes(codes, Date.now() - NINETY_DAYS_MS);
  const byPair = new Map();
  for (const r of rows) {
    const key = `${r.dep_iata}-${r.arr_iata}`;
    if (!byPair.has(key)) {
      byPair.set(key, {
        dep_iata: r.dep_iata,
        arr_iata: r.arr_iata,
        operators: new Set(),
        models: new Set(),
        last_seen_at: r.seen_at,
      });
    }
    const p = byPair.get(key);
    if (r.airline_iata) p.operators.add(r.airline_iata);
    p.models.add(r.aircraft_icao);
    if (r.seen_at > p.last_seen_at) p.last_seen_at = r.seen_at;
  }
  return [...byPair.values()]
    .map(p => ({
      dep_iata: p.dep_iata,
      arr_iata: p.arr_iata,
      operator_count: p.operators.size,
      operators: [...p.operators].sort(),
      models: [...p.models].sort(),
      last_seen_at: p.last_seen_at,
    }))
    .sort((a, b) => b.operator_count - a.operator_count || b.last_seen_at - a.last_seen_at)
    .slice(0, limit);
}

function getSafetyForAircraft(slug, { limit = 100 } = {}) {
  const fam = getFamilyBySlug(slug);
  if (!fam) return [];
  const codes = (fam.icaoTypes || []).map(c => c.toUpperCase());
  if (codes.length === 0) return [];
  return safety.getByAircraftCodes(codes, { limit });
}

module.exports = {
  getSpecsForSlug,
  getOperatorsForAircraft,
  getRoutesForAircraft,
  getSafetyForAircraft,
};
```

### 5.3 Endpoints

`server/src/routes/landingRoutes.js`:

```js
const aircraftPillarService = require('../services/aircraftPillarService');

router.get('/aircraft/:slug/airlines', (req, res) => {
  const slug = String(req.params.slug || '').toLowerCase();
  res.json({ success: true, data: aircraftPillarService.getOperatorsForAircraft(slug) });
});

router.get('/aircraft/:slug/routes', (req, res) => {
  const slug = String(req.params.slug || '').toLowerCase();
  res.json({ success: true, data: aircraftPillarService.getRoutesForAircraft(slug) });
});

router.get('/aircraft/:slug/safety', (req, res) => {
  const slug = String(req.params.slug || '').toLowerCase();
  res.json({ success: true, data: aircraftPillarService.getSafetyForAircraft(slug) });
});

router.get('/aircraft/:slug/specs', (req, res) => {
  const slug = String(req.params.slug || '').toLowerCase();
  const data = aircraftPillarService.getSpecsForSlug(slug);
  if (!data) return res.status(404).json({ success: false, message: 'specs not available' });
  res.json({ success: true, data });
});
```

⚠️ Mount path: existing route landing endpoints likely already at `/api/aircraft/...`. Match the existing prefix.

---

## 6. seoMetaService — 4 resolvers + JSON-LD

### 6.1 Resolver branches in `resolve()`

After existing `aircraftMeta` (line ~159 of current file), BEFORE existing `routeMeta` regex match. Order is critical — sub-page regex MUST match before parent's `\/aircraft\/([^/?#]+)\/?$`:

```js
const acAirlinesMatch = /^\/aircraft\/([^/?#]+)\/airlines\/?$/.exec(pathname);
if (acAirlinesMatch) return aircraftAirlinesMeta(acAirlinesMatch[1].toLowerCase());

const acRoutesMatch = /^\/aircraft\/([^/?#]+)\/routes\/?$/.exec(pathname);
if (acRoutesMatch) return aircraftRoutesMeta(acRoutesMatch[1].toLowerCase());

const acSafetyMatch = /^\/aircraft\/([^/?#]+)\/safety\/?$/.exec(pathname);
if (acSafetyMatch) return aircraftSafetyMeta(acSafetyMatch[1].toLowerCase());

const acSpecsMatch = /^\/aircraft\/([^/?#]+)\/specs\/?$/.exec(pathname);
if (acSpecsMatch) return aircraftSpecsMeta(acSpecsMatch[1].toLowerCase());
```

### 6.2 Resolver functions

```js
function aircraftAirlinesMeta(slug) {
  const fam = getFamilyBySlug(slug);
  if (!fam) return notFoundMeta();
  const label = fam.family?.label || fam.name || slug;
  return {
    title: `Airlines that operate the ${label} | FlightFinder`,
    description: `Airlines worldwide operating the ${label}: route count per carrier, model variants flown, last observed dates. Sourced from open ADS-B data, refreshed nightly.`,
    canonical: `${BASE}/aircraft/${slug}/airlines`,
    h1: `Airlines that operate the ${label}`,
    subtitle: `Operators of the ${label} worldwide`,
    robots: 'index, follow',
    ogType: 'article',
    ogImage: `${BASE}/og/aircraft-default.png`,
    kind: 'aircraft-airlines',
    slug,
    aircraftLabel: label,
  };
}

function aircraftRoutesMeta(slug) {
  const fam = getFamilyBySlug(slug);
  if (!fam) return notFoundMeta();
  const label = fam.family?.label || fam.name || slug;
  return {
    title: `Top routes flown by the ${label} | FlightFinder`,
    description: `Top 50 city pairs operated by the ${label} worldwide: which airlines fly each route, how many model variants observed. Sourced from open ADS-B data.`,
    canonical: `${BASE}/aircraft/${slug}/routes`,
    h1: `Top routes flown by the ${label}`,
    subtitle: `City pairs the ${label} operates worldwide`,
    robots: 'index, follow',
    ogType: 'article',
    ogImage: `${BASE}/og/aircraft-default.png`,
    kind: 'aircraft-routes',
    slug,
    aircraftLabel: label,
  };
}

function aircraftSafetyMeta(slug) {
  const fam = getFamilyBySlug(slug);
  if (!fam) return notFoundMeta();
  const label = fam.family?.label || fam.name || slug;
  return {
    title: `${label} safety record — accidents and incidents | FlightFinder`,
    description: `Aviation safety events involving the ${label}: hull losses, fatal accidents, and serious incidents from NTSB CAROL, Aviation Safety Network, B3A, and Wikidata.`,
    canonical: `${BASE}/aircraft/${slug}/safety`,
    h1: `${label} safety record`,
    subtitle: `Accidents and incidents from public aviation safety datasets`,
    robots: 'index, follow',
    ogType: 'article',
    ogImage: `${BASE}/og/aircraft-default.png`,
    kind: 'aircraft-safety',
    slug,
    aircraftLabel: label,
  };
}

function aircraftSpecsMeta(slug) {
  const fam = getFamilyBySlug(slug);
  if (!fam) return notFoundMeta();
  const label = fam.family?.label || fam.name || slug;
  return {
    title: `${label} specifications — range, capacity, engines | FlightFinder`,
    description: `${label} technical specifications: range, passenger capacity, maximum takeoff weight, wingspan, length, height, max speed, ceiling, engine options, variants.`,
    canonical: `${BASE}/aircraft/${slug}/specs`,
    h1: `${label} specifications`,
    subtitle: `Range, capacity, engines, dimensions`,
    robots: 'index, follow',
    ogType: 'article',
    ogImage: `${BASE}/og/aircraft-default.png`,
    kind: 'aircraft-specs',
    slug,
    aircraftLabel: label,
  };
}
```

### 6.3 Structured data branch

In `structuredData()`, add a single branch covering all 4 sub-page kinds:

```js
} else if (
  meta.kind === 'aircraft-airlines'
  || meta.kind === 'aircraft-routes'
  || meta.kind === 'aircraft-safety'
  || meta.kind === 'aircraft-specs'
) {
  const subPageName = {
    'aircraft-airlines': 'Airlines',
    'aircraft-routes':   'Routes',
    'aircraft-safety':   'Safety',
    'aircraft-specs':    'Specifications',
  }[meta.kind];
  graph.push({
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home',        item: `${BASE}/` },
      { '@type': 'ListItem', position: 2, name: 'By aircraft', item: `${BASE}/by-aircraft` },
      {
        '@type': 'ListItem',
        position: 3,
        name: meta.aircraftLabel,
        item: `${BASE}/aircraft/${meta.slug}`,
      },
      { '@type': 'ListItem', position: 4, name: subPageName, item: meta.canonical },
    ],
  });
  graph.push({
    '@type': 'Vehicle',
    name: meta.aircraftLabel,
    vehicleConfiguration: 'Commercial aircraft',
    url: meta.canonical,
  });
}
```

⚠️ No FAQPage on sub-pages — those are table-heavy data surfaces, FAQ would be synthetic. Parent `/aircraft/{slug}` keeps its FAQ (existing).

---

## 7. Sitemap

In `seo.js`, after the aircraft-route grid block (Spec C):

```js
try {
  const { getFamilyList } = require('../models/aircraftFamilies');
  for (const fam of getFamilyList()) {
    for (const sub of ['airlines', 'routes', 'safety', 'specs']) {
      urls.push({
        loc: `${BASE}/aircraft/${fam.slug}/${sub}`,
        changefreq: 'monthly',
        priority: '0.6',
        lastmod: deployDay,
      });
    }
  }
} catch (err) {
  console.warn('[seo] aircraft pillar sub-pages unavailable for sitemap:', err.message);
}
```

`priority: 0.6` — between parent (0.7) and Spec C aircraft-route grid (0.5). Total: 19 × 4 = 76 URLs.

---

## 8. Client — 4 sub-page components

All 4 components share `AircraftPillar.css`. Common structure:

1. `<nav>` breadcrumb (Home > By aircraft > {aircraft} > {sub-page name})
2. Templated `<p>` intro paragraph (~80 words, dynamic counts from data)
3. Main data section (table/list)
4. `<section>` cross-links to sibling sub-pages + parent

### 8.1 AircraftAirlines.jsx

```jsx
import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import './AircraftPillar.css';

const API = (import.meta.env.VITE_API_BASE || '');

function fmtDate(ms) { return new Date(ms).toISOString().slice(0, 10); }

export default function AircraftAirlines() {
  const { slug } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let active = true;
    fetch(`${API}/api/aircraft/${slug}/airlines`)
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then(j => { if (active) setData(j.data); })
      .catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [slug]);

  if (error) return <main className="ac-pillar"><h1>Not found</h1></main>;
  if (!data) return <main className="ac-pillar"><p>Loading…</p></main>;

  return (
    <main className="ac-pillar">
      <nav className="ac-pillar__breadcrumb" aria-label="Breadcrumb">
        <Link to="/">Home</Link>{' › '}
        <Link to="/by-aircraft">By aircraft</Link>{' › '}
        <Link to={`/aircraft/${slug}`}>{slug}</Link>{' › '}
        <span>Airlines</span>
      </nav>
      <p className="ac-pillar__intro">
        Airlines worldwide operating this aircraft type, compiled from open
        ADS-B observed-flights data over the last 90 days. {data.length}{' '}
        {data.length === 1 ? 'operator' : 'operators'} listed below.
      </p>
      {data.length > 0 ? (
        <section className="ac-pillar__operators">
          <h2 className="eyebrow eyebrow--strong">Operators ({data.length})</h2>
          <ul className="ac-pillar__operator-list">
            {data.map(op => (
              <li key={op.airline_iata}>
                <strong>{op.airline_name}</strong>
                <div className="ac-pillar__operator-meta">
                  {op.route_count} route{op.route_count === 1 ? '' : 's'} ·{' '}
                  {op.models.length} model variant{op.models.length === 1 ? '' : 's'} ({op.models.join(', ')}) ·{' '}
                  last seen {fmtDate(op.last_seen_at)}
                </div>
                {op.sample_routes.length > 0 && (
                  <div className="ac-pillar__sample-routes">
                    Sample routes: {op.sample_routes.join(', ')}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <p className="ac-pillar__empty">
          No operators observed in the last 90 days.
        </p>
      )}
      <section className="ac-pillar__cross">
        <h2 className="eyebrow eyebrow--strong">Explore further</h2>
        <ul>
          <li><Link to={`/aircraft/${slug}`}>← Back to {slug} overview</Link></li>
          <li><Link to={`/aircraft/${slug}/routes`}>Top routes flown by this aircraft →</Link></li>
          <li><Link to={`/aircraft/${slug}/safety`}>Safety record →</Link></li>
          <li><Link to={`/aircraft/${slug}/specs`}>Specifications →</Link></li>
        </ul>
      </section>
    </main>
  );
}
```

### 8.2 AircraftRoutes.jsx

Mirrors AircraftAirlines pattern. Each row links to Spec C `/routes/{pair}/{slug}`:

```jsx
<Link to={`/routes/${row.dep_iata.toLowerCase()}-${row.arr_iata.toLowerCase()}/${slug}`}>
  {row.dep_iata} → {row.arr_iata}
</Link>
```

Templated intro: `"The ${aircraftLabel} has been observed on ${data.length} route${...} by ${operatorTotal} operators in the last 90 days."`

### 8.3 AircraftSafety.jsx

Mirrors pattern. Each event row links to Spec B `/safety/events/{slug-id}`:

```jsx
<Link to={`/safety/events/${ev.slug || ev.id}`}>
  <span className={`safety-badge safety-badge--${ev.severity}`}>{ev.severityLabel}</span>
  {ev.dateLabel} · {ev.operator?.name} · {ev.location?.country}
</Link>
```

Templated intro counts severity breakdown:
```
"Public records show ${data.length} aviation events involving the ${aircraftLabel}: ${fatal_count} fatal, ${hull_loss_count} hull losses."
```

⚠️ Server response should include `slug` field for each event (built via `buildEventSlug` from Spec B). Implementer extends the existing service to include slug field.

### 8.4 AircraftSpecs.jsx

Table-heavy. Templated intro:

```
"The ${label} entered service in ${in_service_since} and is built by ${manufacturer}.
Maximum range is ${max_range_km} km, accommodating ${passenger_capacity_typical} passengers
in typical configurations. The aircraft uses ${engines.join(' or ')} engines."
```

Then `<table>` with ~15 rows: each spec field as a row. Null fields render `—`.

### 8.5 Shared CSS — AircraftPillar.css

Common selectors (~120 lines):
- `.ac-pillar` wrapper (max-width 720px)
- `.ac-pillar__breadcrumb`
- `.ac-pillar__intro`
- `.ac-pillar__operators`, `.ac-pillar__route-list`, `.ac-pillar__events-list`, `.ac-pillar__specs-table` — section variants
- `.ac-pillar__cross` — cross-links footer
- `.ac-pillar__empty` — empty state
- `@media (max-width: 480px)` — 1-col list stacking, smaller font

### 8.6 Route registration

In `client/src/index.jsx`, near other lazy routes:

```jsx
const AircraftAirlines = lazy(() => import('./components/AircraftAirlines'));
const AircraftRoutes   = lazy(() => import('./components/AircraftRoutes'));
const AircraftSafety   = lazy(() => import('./components/AircraftSafety'));
const AircraftSpecs    = lazy(() => import('./components/AircraftSpecs'));

// Inside <Routes>:
<Route path="/aircraft/:slug/airlines" element={<Suspense fallback={null}><AircraftAirlines /></Suspense>} />
<Route path="/aircraft/:slug/routes"   element={<Suspense fallback={null}><AircraftRoutes /></Suspense>} />
<Route path="/aircraft/:slug/safety"   element={<Suspense fallback={null}><AircraftSafety /></Suspense>} />
<Route path="/aircraft/:slug/specs"    element={<Suspense fallback={null}><AircraftSpecs /></Suspense>} />
```

⚠️ Place AFTER the existing `/aircraft/:slug` route in the `<Routes>` block — React Router v7 ranks paths by specificity automatically, but explicit placement helps readability.

---

## 9. Parent restructure — AircraftLandingPage.jsx

Convert existing in-page sections to **lean preview cards with "View full X →" CTAs**. Keep existing sections (don't delete) — append CTA below each:

```jsx
{/* Existing About prose section — keep as-is, append CTA */}
<section className="aircraft-pillar-card">
  <h2 className="eyebrow eyebrow--strong">About the {label}</h2>
  {/* existing About content stays */}
  <Link to={`/aircraft/${slug}/specs`} className="pillar-cta">
    View full specifications →
  </Link>
</section>

{/* Existing Top Routes list — append CTA */}
<section className="aircraft-pillar-card">
  <h2 className="eyebrow eyebrow--strong">Top routes</h2>
  {/* existing top-routes content (5-10 rows) stays */}
  <Link to={`/aircraft/${slug}/routes`} className="pillar-cta">
    View all routes flown by the {label} →
  </Link>
</section>

{/* Existing RecentSafetyEvents block — append CTA */}
<section className="aircraft-pillar-card">
  <h2 className="eyebrow eyebrow--strong">Recent safety events</h2>
  {/* existing recent-safety content stays */}
  <Link to={`/aircraft/${slug}/safety`} className="pillar-cta">
    View full safety record →
  </Link>
</section>

{/* NEW: Operators section (currently absent on parent) */}
<section className="aircraft-pillar-card">
  <h2 className="eyebrow eyebrow--strong">Operators</h2>
  <p>Top airlines operating the {label} from the last 90 days...</p>
  <Link to={`/aircraft/${slug}/airlines`} className="pillar-cta">
    View all operators →
  </Link>
</section>
```

⚠️ Existing `RecentSafetyEvents` component, top routes list, About paragraph — **kept**. Just append CTA. No content deletion.

⚠️ A small fetch may be needed to populate the new "Operators" section (top 3-5 airline names + count). Use existing `/api/aircraft/{slug}/airlines` endpoint — slice top 3 client-side.

---

## 10. Acceptance criteria

- [ ] 4 new routes registered: `/aircraft/{slug}/{airlines,routes,safety,specs}`
- [ ] Each sub-page returns unique `<title>` + Description (verify via `curl`)
- [ ] BreadcrumbList + Vehicle JSON-LD on each (verify via Google Rich Results Test post-deploy)
- [ ] Sitemap.xml includes 76 sub-page URLs (19 families × 4 sub-pages)
- [ ] Templated prose paragraphs render dynamic counts (operator count, route count, severity breakdown)
- [ ] Parent `/aircraft/{slug}` shows 4 hub cards each linking to corresponding sub-page
- [ ] `/aircraft/{slug}/routes` rows deep-link to Spec C `/routes/{pair}/{slug}` pages
- [ ] `/aircraft/{slug}/safety` rows deep-link to Spec B `/safety/events/{slug-id}` pages
- [ ] `aircraftSpecs.json` populated for all 19 families
- [ ] Mobile @ 375 — 4 hub cards stack 1-col on parent; sub-page lists stack
- [ ] Server tests pass; new tests for `aircraftPillarService` (3 functions)
- [ ] Client tests pass; build clean; bundle under 98 KB brotli

---

## 11. Out of scope

- Pagination on `/aircraft/{slug}/safety` beyond 100 events — limited client-side via "View on /safety/global ?aircraft={icao}" link.
- Live data refresh / streaming updates — backend caches via Express, refreshed on each request (DB query ≤ 50ms).
- Per-family editorial copy — Q3 chose templated prose, not editorial.
- Wikidata API integration for specs — Q2 chose hardcoded JSON.
- Variant-specific sub-pages (`/aircraft/boeing-787/787-9`) — overkill for now.

---

## 12. Coverage map

| Audit recommendation | Resolution |
|----------------------|------------|
| E1 (topic-cluster around aircraft pillars) | §3, §5–§8 (full pillar implementation) |
| Strategic content moat | §9 parent restructure ties cluster together |
| Cross-spec ecosystem (Specs B + C) | §8.2 deep-links to /routes/{pair}/{slug}; §8.3 deep-links to /safety/events/{slug-id} |
