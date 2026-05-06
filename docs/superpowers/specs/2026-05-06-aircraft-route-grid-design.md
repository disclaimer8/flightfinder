# Aircraft × Route Programmatic Grid — Design Spec

**Date:** 2026-05-06
**Owner:** Solo (denyskolomiiets)
**Status:** Approved
**Scope:** SEO Growth roadmap, Spec C (of A–D)

---

## 1. Goal

Programmatically generate landing pages at `/routes/{from-to}/{aircraft-slug}` (e.g. `/routes/lhr-jfk/boeing-787`) for the cartesian product of city pair × aircraft type, gated by quality threshold (≥3 observed flights in 90 days OR membership in a curated editorial whitelist). Each page captures long-tail "{city pair} {aircraft model} flights" queries — a niche where major flight-search incumbents (FlightAware, Kayak, FR24) don't compete.

**Coverage estimate:** ~5K–15K pages from auto-threshold + ~50 hub pairs × ~15 aircraft families ≈ 750 editorial pages. Sitemap caps at 10K.

**Success criterion:** Google indexes ≥1K of the qualifying URLs within 8 weeks of deploy. Each page renders unique title + FAQ + operators list + cross-links + breadcrumbs.

---

## 2. Background

The 2026-05-06 SEO audit flagged finding **B4 — competitive aircraft+route grid missing**:

> Current routes are city-pair only. The differentiator ("aircraft-aware") would compound with `/routes/lhr-jfk/boeing-787` style pages targeting "LHR JFK Boeing 787 flights" — extremely low-competition long-tail. Opens 1000s of programmatic pages.

The two pillar surfaces (`/aircraft/{slug}` and `/routes/{pair}`) already exist. Spec C creates the cartesian intersection as a new sub-route `/routes/{pair}/{aircraft-slug}`.

**Why sub-route under `/routes` (not under `/aircraft`)**: long-tail queries typically lead with the city pair (primary intent), aircraft is the filter. Sub-route under route-pillar inherits authority from `/routes/{pair}` and matches user mental model.

---

## 3. Architecture

**Files added:**
- `client/src/components/AircraftRouteLanding.jsx` — new React page component
- `client/src/components/AircraftRouteLanding.css` — styles (reuses existing landing page tokens)
- `server/src/services/aircraftRouteService.js` — service layer with `isQualifying`, `getOperators`, `listQualifying`, `getTopAircraftForPair`
- `server/src/config/editorialPairs.json` — hardcoded list of 50 high-value hub pairs

**Files modified:**
- `client/src/index.jsx` — add route `<Route path="/routes/:pair/:aircraftSlug" element={<AircraftRouteLanding />} />`
- `client/src/components/RouteLandingPage.jsx` — add "Aircraft on this route" section
- `client/src/components/AircraftLandingPage.jsx` — upgrade "Top routes" tile links to deep link `/routes/{pair}/{slug}`
- `server/src/models/observedRoutes.js` — add 3 new prepared statements (`byPairAndAircraft`, `countByPairAndAircraft`, `qualifyingCombos`) + 1 covering index migration
- `server/src/routes/landingRoutes.js` (or wherever route-landing endpoints live) — add 2 new endpoints
- `server/src/services/seoMetaService.js` — `aircraftRouteMeta()` resolver + FAQPage + BreadcrumbList JSON-LD
- `server/src/routes/seo.js` — sitemap enumerates qualifying combos (capped 10K)

**Data flow:**

```
observed_routes table (existing, populated nightly from adsb.lol)
  ├─ filter by (origin, dest)               → /routes/{pair}              (existing)
  ├─ filter by aircraft_type                → /aircraft/{slug}            (existing)
  └─ filter by (origin, dest, aircraft_type)→ /routes/{pair}/{slug}       (NEW Spec C)
```

Backend uses single existing `observed_routes` table — no new ingestion infrastructure required.

**Branch:** `feat/aircraft-route-grid` from main (after PR #79 merges).

---

## 4. Threshold + editorial whitelist

### 4.1 Auto-threshold

A `(from, to, aircraft-slug)` combo qualifies for indexing iff:
- ≥3 observed flights of that aircraft type on that route in the last 90 days

### 4.2 Editorial whitelist

50 high-value hub pairs hardcoded in `server/src/config/editorialPairs.json`:

```json
{
  "_doc": "Editorial whitelist for /routes/{pair}/{aircraft-slug} pages. These pairs always generate landing pages even if observed flight count is below the auto-threshold (≥3 in 90d). Stored as 'lhr-jfk' (lowercase, dash-separated) format.",
  "pairs": [
    "lhr-jfk", "lhr-lax", "lhr-sin", "lhr-dxb", "lhr-hkg",
    "jfk-lax", "jfk-sfo", "jfk-mia", "jfk-cdg", "jfk-fco",
    "nrt-lax", "nrt-sfo", "nrt-jfk", "hnd-sfo", "hnd-jfk",
    "sin-syd", "sin-lhr", "sin-jfk", "hkg-jfk", "hkg-syd",
    "dxb-jfk", "dxb-lhr", "dxb-syd", "doh-lhr", "doh-jfk",
    "cdg-jfk", "cdg-yyz", "fra-jfk", "ams-jfk", "lhr-yyz",
    "syd-lax", "syd-sfo", "mel-lax", "syd-hnd", "syd-sin",
    "icn-jfk", "icn-lax", "icn-sfo", "pek-lax", "pvg-jfk",
    "bom-lhr", "del-lhr", "del-jfk", "bkk-lhr", "kul-lhr",
    "ord-lhr", "ord-fra", "iah-lhr", "atl-lhr", "dfw-lhr"
  ]
}
```

For each editorial pair × every aircraft family from `aircraftFamilies.js` (currently 19 families), a page is generated regardless of observation count. Estimated 50 × 19 = 950 editorial pages.

⚠️ Editorial pages with zero observed flights show "No observed flights on this aircraft+route in the last 90 days" — content-thin but Google still indexes due to `editorialPairs` membership flag. If too many such pages risk thin-content penalty, downstream tweak: gate editorial coverage to families that have *any* observation on the pair (still permissive, but prunes truly empty pages).

---

## 5. Backend: queries + service + endpoints

### 5.1 New prepared statements (`server/src/models/observedRoutes.js`)

```js
const stmts = {
  // ... existing ...

  byPairAndAircraft: db.prepare(`
    SELECT
      operator_icao,
      operator_iata,
      operator_name,
      COUNT(*) AS flight_count,
      MAX(observed_at) AS last_seen_at,
      MIN(observed_at) AS first_seen_at
    FROM observed_routes
    WHERE LOWER(origin_iata) = ?
      AND LOWER(destination_iata) = ?
      AND UPPER(aircraft_icao) IN (
        SELECT icao_type FROM aircraft_family_models WHERE family_slug = ?
      )
      AND observed_at >= ?
    GROUP BY operator_icao
    ORDER BY flight_count DESC
  `),

  countByPairAndAircraft: db.prepare(`
    SELECT COUNT(*) AS n FROM observed_routes
    WHERE LOWER(origin_iata) = ?
      AND LOWER(destination_iata) = ?
      AND UPPER(aircraft_icao) IN (
        SELECT icao_type FROM aircraft_family_models WHERE family_slug = ?
      )
      AND observed_at >= ?
  `),

  qualifyingCombos: db.prepare(`
    SELECT
      LOWER(origin_iata) AS from_iata,
      LOWER(destination_iata) AS to_iata,
      afm.family_slug AS slug,
      COUNT(*) AS flight_count
    FROM observed_routes obr
    JOIN aircraft_family_models afm ON UPPER(obr.aircraft_icao) = afm.icao_type
    WHERE observed_at >= ?
    GROUP BY from_iata, to_iata, slug
    HAVING flight_count >= 3
    ORDER BY flight_count DESC
    LIMIT ?
  `),

  topAircraftForPair: db.prepare(`
    SELECT
      afm.family_slug AS slug,
      afm.family_label AS label,
      COUNT(*) AS flight_count
    FROM observed_routes obr
    JOIN aircraft_family_models afm ON UPPER(obr.aircraft_icao) = afm.icao_type
    WHERE LOWER(obr.origin_iata) = ?
      AND LOWER(obr.destination_iata) = ?
      AND obr.observed_at >= ?
    GROUP BY afm.family_slug
    ORDER BY flight_count DESC
    LIMIT ?
  `),
};
```

⚠️ Schema assumption: `observed_routes` has `origin_iata`, `destination_iata`, `aircraft_icao`, `operator_icao`, `operator_iata`, `operator_name`, `observed_at`. `aircraft_family_models` maps ICAO type codes to family slugs (created in earlier phases per memory `project_phase3_aircraft_map`).

If actual schema differs, implementer adapts queries. If column names match a different existing convention, consult `server/src/models/db.js` migrations.

### 5.2 Covering index (migration)

If query EXPLAIN shows full table scan on observed_routes, add:

```sql
CREATE INDEX IF NOT EXISTS idx_obr_pair_aircraft
  ON observed_routes(origin_iata, destination_iata, aircraft_icao, observed_at);
```

Add to existing migration system. If schema migration management is via `server/src/models/db.js`, add this index there.

### 5.3 Service (`server/src/services/aircraftRouteService.js`)

```js
'use strict';
const obr = require('../models/observedRoutes');
const editorial = require('../config/editorialPairs.json');
const { getFamilyBySlug, getFamilyList } = require('../models/aircraftFamilies');

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
const EDITORIAL_PAIRS = new Set(editorial.pairs.map(p => p.toLowerCase()));

function isEditorialPair(fromIata, toIata) {
  return EDITORIAL_PAIRS.has(`${String(fromIata).toLowerCase()}-${String(toIata).toLowerCase()}`);
}

function isQualifying(fromIata, toIata, slug) {
  if (!getFamilyBySlug(slug)) return false;
  if (isEditorialPair(fromIata, toIata)) return true;

  const count = obr.countByPairAndAircraft?.(
    String(fromIata).toLowerCase(),
    String(toIata).toLowerCase(),
    slug,
    Date.now() - NINETY_DAYS_MS,
  ) || 0;
  return count >= 3;
}

function getOperators(fromIata, toIata, slug) {
  return obr.byPairAndAircraft?.(
    String(fromIata).toLowerCase(),
    String(toIata).toLowerCase(),
    slug,
    Date.now() - NINETY_DAYS_MS,
  ) || [];
}

function getTopAircraftForPair(fromIata, toIata, { limit = 8 } = {}) {
  return obr.topAircraftForPair?.(
    String(fromIata).toLowerCase(),
    String(toIata).toLowerCase(),
    Date.now() - NINETY_DAYS_MS,
    Math.min(Math.max(Number(limit) || 8, 1), 20),
  ) || [];
}

function listQualifying({ limit = 10000 } = {}) {
  const auto = obr.qualifyingCombos?.(Date.now() - NINETY_DAYS_MS, limit) || [];
  const seen = new Set(auto.map(r => `${r.from_iata}-${r.to_iata}-${r.slug}`));

  // Inject editorial pairs not already in auto-list (cap to keep sitemap sane).
  const editorialAdded = [];
  const families = getFamilyList();
  for (const pair of EDITORIAL_PAIRS) {
    const [from, to] = pair.split('-');
    for (const fam of families) {
      const key = `${from}-${to}-${fam.slug}`;
      if (!seen.has(key) && editorialAdded.length < 1000) {
        editorialAdded.push({ from_iata: from, to_iata: to, slug: fam.slug, flight_count: 0 });
        seen.add(key);
      }
    }
  }
  return [...auto, ...editorialAdded].slice(0, limit);
}

module.exports = {
  isQualifying,
  isEditorialPair,
  getOperators,
  getTopAircraftForPair,
  listQualifying,
};
```

### 5.4 Endpoints

`server/src/routes/landingRoutes.js` (or equivalent):

```js
const aircraftRouteSvc = require('../services/aircraftRouteService');

// GET /api/routes/:pair/aircraft/:slug — main detail endpoint
router.get('/routes/:pair/aircraft/:slug', async (req, res) => {
  const m = /^([a-z]{3})-([a-z]{3})$/i.exec(req.params.pair);
  if (!m) return res.status(400).json({ success: false, message: 'invalid pair' });
  const fromIata = m[1].toLowerCase();
  const toIata = m[2].toLowerCase();
  const slug = req.params.slug.toLowerCase();

  if (!aircraftRouteSvc.isQualifying(fromIata, toIata, slug)) {
    return res.status(404).json({ success: false, message: 'not qualifying' });
  }

  const operators = aircraftRouteSvc.getOperators(fromIata, toIata, slug);
  res.json({ success: true, data: { operators, fromIata, toIata, slug } });
});

// GET /api/routes/:pair/aircraft-list — sibling discovery for cross-linking
router.get('/routes/:pair/aircraft-list', async (req, res) => {
  const m = /^([a-z]{3})-([a-z]{3})$/i.exec(req.params.pair);
  if (!m) return res.status(400).json({ success: false });
  const fromIata = m[1].toLowerCase();
  const toIata = m[2].toLowerCase();
  const list = aircraftRouteSvc.getTopAircraftForPair(fromIata, toIata, { limit: 8 });
  res.json({ success: true, data: list });
});
```

---

## 6. seoMetaService — resolver + JSON-LD

### 6.1 Add resolver branch

In `seoMetaService.js` `resolve()`, after the existing `routeMeta` regex match (line ~162), insert:

```js
const acRtMatch = /^\/routes\/([a-z]{3}-[a-z]{3})\/([^/?#]+)\/?$/i.exec(pathname);
if (acRtMatch) {
  return aircraftRouteMeta(acRtMatch[1].toLowerCase(), acRtMatch[2].toLowerCase());
}
```

### 6.2 Resolver function

```js
const aircraftRouteService = require('./aircraftRouteService');

function aircraftRouteMeta(pair, slug) {
  const m = /^([a-z]{3})-([a-z]{3})$/.exec(pair);
  if (!m) return notFoundMeta();
  const fromIata = m[1].toUpperCase();
  const toIata   = m[2].toUpperCase();
  const fromAp   = openFlightsService.getAirport(fromIata);
  const toAp     = openFlightsService.getAirport(toIata);
  if (!fromAp || !toAp) return notFoundMeta();

  const fam = getFamilyBySlug(slug);
  if (!fam) return notFoundMeta();
  const aircraftLabel = fam.family?.label || fam.name;

  const qualifies = aircraftRouteService.isQualifying(fromIata, toIata, slug);

  const fromName = fromAp.city || fromAp.name || fromIata;
  const toName   = toAp.city   || toAp.name   || toIata;
  const canonical = `${BASE}/routes/${pair}/${slug}`;

  return {
    title: `${fromName} to ${toName} on the ${aircraftLabel} (${fromIata} → ${toIata}) — flights and operators | FlightFinder`,
    description: `Flights from ${fromName} (${fromIata}) to ${toName} (${toIata}) operated by the ${aircraftLabel}: which airlines, frequency in the last 90 days, and recent observed flights from open ADS-B data.`,
    canonical,
    h1: `${fromName} to ${toName} on the ${aircraftLabel}`,
    subtitle: `${fromIata} → ${toIata} · operated by the ${aircraftLabel}`,
    robots: qualifies ? 'index, follow' : 'noindex, follow',
    ogType: 'article',
    kind: 'aircraft-route',
    pair,
    slug,
    fromIata,
    toIata,
    fromName,
    toName,
    aircraftLabel,
  };
}
```

### 6.3 Structured data branch

In `structuredData()`, before the existing `home` branch:

```js
} else if (meta.kind === 'aircraft-route') {
  graph.push({
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: `${BASE}/` },
      { '@type': 'ListItem', position: 2, name: 'Routes', item: `${BASE}/` },
      {
        '@type': 'ListItem',
        position: 3,
        name: `${meta.fromName} to ${meta.toName}`,
        item: `${BASE}/routes/${meta.pair}`,
      },
      { '@type': 'ListItem', position: 4, name: meta.aircraftLabel, item: meta.canonical },
    ],
  });
  graph.push({
    '@type': 'FAQPage',
    mainEntity: [
      {
        '@type': 'Question',
        name: `Which airlines fly the ${meta.aircraftLabel} from ${meta.fromIata} to ${meta.toIata}?`,
        acceptedAnswer: {
          '@type': 'Answer',
          text: `See the operators list on this page — it is compiled from open ADS-B observed-flights data updated nightly. Operators with the highest flight count are listed first.`,
        },
      },
      {
        '@type': 'Question',
        name: `How often is the ${meta.aircraftLabel} used on the ${meta.fromIata} to ${meta.toIata} route?`,
        acceptedAnswer: {
          '@type': 'Answer',
          text: `Observed flight frequency over the last 90 days is shown on this page. Aircraft assignments can change seasonally; data refreshes nightly.`,
        },
      },
      {
        '@type': 'Question',
        name: `What is the typical schedule for ${meta.aircraftLabel} flights from ${meta.fromName} to ${meta.toName}?`,
        acceptedAnswer: {
          '@type': 'Answer',
          text: `Schedules vary by operator. Recent observed flights are listed below with date and operator. For live schedules and fares, search by aircraft on the FlightFinder home page.`,
        },
      },
      {
        '@type': 'Question',
        name: 'Where does this data come from?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'Operator counts and observed flights come from the adsb.lol open ADS-B network under the Open Database License. Data refreshes nightly.',
        },
      },
    ],
  });
}
```

---

## 7. Sitemap

In `seo.js`, after the safety events block (Spec B), add:

```js
try {
  const aircraftRouteSvc = require('../services/aircraftRouteService');
  const combos = aircraftRouteSvc.listQualifying({ limit: 10000 });
  for (const c of combos) {
    urls.push({
      loc: `${BASE}/routes/${c.from_iata}-${c.to_iata}/${c.slug}`,
      changefreq: 'weekly',
      priority: '0.5',
      lastmod: today,
    });
  }
} catch (err) {
  console.warn('[seo] aircraft-route grid unavailable for sitemap:', err.message);
}
```

⚠️ 10K cap is comfortably below Google's 50K-URL limit per sitemap. If actual qualifying combos exceed 10K, the cap selects highest-frequency combos first.

---

## 8. Client: AircraftRouteLanding component

`client/src/components/AircraftRouteLanding.jsx`:

```jsx
import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import './AircraftRouteLanding.css';

const API = (import.meta.env.VITE_API_BASE || '');

export default function AircraftRouteLanding() {
  const { pair, aircraftSlug } = useParams();
  const [data, setData] = useState(undefined);
  const [error, setError] = useState(null);
  const [siblings, setSiblings] = useState([]);

  useEffect(() => {
    let active = true;
    fetch(`${API}/api/routes/${pair}/aircraft/${aircraftSlug}`)
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then(j => { if (active) setData(j.data); })
      .catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [pair, aircraftSlug]);

  useEffect(() => {
    let active = true;
    fetch(`${API}/api/routes/${pair}/aircraft-list`)
      .then(r => r.ok ? r.json() : { data: [] })
      .then(j => {
        if (active) setSiblings((j.data || []).filter(s => s.slug !== aircraftSlug).slice(0, 5));
      })
      .catch(() => {});
    return () => { active = false; };
  }, [pair, aircraftSlug]);

  if (error) return <main className="ar-landing"><h1>Not found</h1><Link to="/">← Home</Link></main>;
  if (!data) return <main className="ar-landing"><p>Loading…</p></main>;

  const { operators = [], fromIata, toIata } = data;

  return (
    <main className="ar-landing">
      <nav className="ar-landing__breadcrumb">
        <Link to="/">Home</Link> ›{' '}
        <Link to={`/routes/${pair}`}>{fromIata} → {toIata}</Link> ›{' '}
        <span>{aircraftSlug}</span>
      </nav>

      <p className="ar-landing__intro">
        Flights operated by this aircraft model on this route, compiled from open
        ADS-B observed-flights data over the last 90 days.
      </p>

      {operators.length > 0 ? (
        <section className="ar-landing__operators">
          <h2 className="eyebrow eyebrow--strong">Operators on this route</h2>
          <ul className="ar-landing__operator-list">
            {operators.map(op => (
              <li key={op.operator_icao || op.operator_iata}>
                <strong>{op.operator_name || op.operator_icao || op.operator_iata}</strong>
                <span>{op.flight_count} flights · last seen {new Date(op.last_seen_at).toISOString().slice(0, 10)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <p className="ar-landing__empty">
          No observed flights on this aircraft+route in the last 90 days.
        </p>
      )}

      <section className="ar-landing__cross">
        <h2 className="eyebrow eyebrow--strong">
          Other aircraft on the {fromIata} → {toIata} route
        </h2>
        {siblings.length > 0 ? (
          <ul className="ar-landing__sibling-list">
            {siblings.map(s => (
              <li key={s.slug}>
                <Link to={`/routes/${pair}/${s.slug}`}>{s.label || s.slug}</Link>
              </li>
            ))}
          </ul>
        ) : (
          <p>Currently only this aircraft is observed on this route.</p>
        )}
        <p>
          <Link to={`/routes/${pair}`}>
            View all flights on the {fromIata} → {toIata} route →
          </Link>
        </p>
        <p>
          <Link to={`/aircraft/${aircraftSlug}`}>
            View all routes flown by this aircraft type →
          </Link>
        </p>
      </section>
    </main>
  );
}
```

⚠️ The H1 is NOT in the JSX — it's injected by `seoMetaService.inject()` into the static SSR shell. The component only renders below-fold content. Same pattern as `RouteLandingPage.jsx`.

---

## 9. Cross-linking from existing pages

### 9.1 RouteLandingPage — "Aircraft on this route" section

In `client/src/components/RouteLandingPage.jsx`, fetch `/api/routes/{pair}/aircraft-list` on mount and render:

```jsx
{topAircraft.length > 0 && (
  <section className="route-landing__aircraft-grid">
    <h2 className="eyebrow eyebrow--strong">Aircraft on this route</h2>
    <ul>
      {topAircraft.map(a => (
        <li key={a.slug}>
          <Link to={`/routes/${pair}/${a.slug}`}>
            {a.label} <span>({a.flight_count} flights / 90d)</span>
          </Link>
        </li>
      ))}
    </ul>
  </section>
)}
```

### 9.2 AircraftLandingPage — "Top routes" deep-link upgrade

Existing "Top routes" tile rendering in `AircraftLandingPage.jsx` currently links to `/routes/{pair}`. Update to deep-link:

```jsx
<Link to={`/routes/${route.pair}/${slug}`}>
  {route.fromIata} → {route.toIata}
</Link>
```

This redirects PageRank from the aircraft pillar to the new programmatic pages.

⚠️ Do not break the existing tile if a specific route is on the editorial whitelist but has 0 observations on this aircraft — the deep-link page will render the empty-state ("No observed flights"). Acceptable given editorial intent.

---

## 10. Acceptance criteria

- [ ] `/routes/lhr-jfk/boeing-787` returns unique `<title>` containing both city pair AND aircraft model (verify via `curl`).
- [ ] FAQPage + BreadcrumbList JSON-LD emitted (verify via Google Rich Results Test post-deploy).
- [ ] Non-qualifying combos return `noindex, follow`.
- [ ] Qualifying combos return `index, follow`.
- [ ] Sitemap.xml includes ≤10K `/routes/{pair}/{slug}` URLs.
- [ ] `/routes/lhr-jfk` page shows "Aircraft on this route" section with 5–8 deep links.
- [ ] `/aircraft/boeing-787` "Top routes" tiles link to `/routes/{pair}/boeing-787` (deep link).
- [ ] `/routes/lhr-jfk/boeing-787` rendered: operators list (or empty state) + siblings section + 2 cross-link footers.
- [ ] Mobile @ 375 — operator list + sibling list stack correctly.
- [ ] Server tests: new tests for `aircraftRouteService.isQualifying`, `getOperators`, `listQualifying`.
- [ ] Client tests pass; build clean; bundle under 98 KB brotli.

---

## 11. Out of scope

- Aircraft × route × operator deep nesting (`/routes/lhr-jfk/boeing-787/united-airlines`) — overkill for content quality.
- Booking links integration (Travelpayouts cheapest fares filtered by aircraft) — Q3 chose Standard not Rich.
- Comparison stat strips ("vs A350") — Q3.
- Editorial commentary auto-generation — Q3.
- Search Console submission — manual ops post-deploy.
- Schema.org `Trip` or `FlightReservation` — these schemas describe specific bookable trips, not aggregated route+aircraft pages. FAQPage is the right primary schema here.

---

## 12. Coverage map

| Audit finding | Resolution |
|---------------|------------|
| B4 (aircraft+route grid missing) | §3 architecture, §5 backend, §6 seoMetaService, §8 client |
| Strategic E2 (programmatic grid) | §4 threshold + editorial, §7 sitemap, §9 cross-linking |
