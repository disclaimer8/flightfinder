# Route × Aircraft Prices — UI + SEO Bake Design (Spec B)

**Date:** 2026-05-19
**Status:** approved, pending implementation plan
**Predecessor:** `2026-05-19-route-aircraft-prices-data-design.md` (Spec A — data layer shipped same day)

## Problem

Spec A landed the data layer: 325 `route_aircraft_prices` rows, two JSON endpoints (`/api/routes/:pair/prices`, `/api/aircraft/:icao/prices`). The data is invisible to users — no UI consumes it and Google can't see it because nothing is baked into SSR HTML.

Spec B adds the user-facing surfaces:
- React widget on `/routes/:pair` — "Typical fares by aircraft on this route"
- Block on `/aircraft/:slug` — "Where this aircraft flies and what it costs"
- SSR bake into `seoContentBuilders.bRoute` and `seoContentBuilders.bAircraft` so Google indexes the content

## Decisions (from brainstorm sections 4-6, all approved)

- **Sorting**: by `median_eur` ASC on route widget (cheapest first), by `n_quotes` DESC on aircraft widget (most-data first). Cheapest-first is the dominant UX value.
- **Safety badge**: leverage existing `aircraftSafetyService` via Spec A's `safetySummaryForIcao` (already in routePricingService response). Thresholds: 0/1-3/4+ accidents in 5y → green/yellow/red.
- **Empty state on route widget**: returns `null` (no DOM emitted) when no data. UI doesn't show "Loading…" or "no data" — silent fallback. Reasoning: route pages already have content; price block is a bonus.
- **Mobile collapse ≤768px**: hide Operators + Range columns via CSS media query.
- **Deep-link to Google Flights**: `https://www.google.com/travel/flights?q=Flights%20to%20{ARR}%20from%20{DEP}%20oneway`. NO aircraft lock parameter (ToS risk). Opens in new tab.
- **No JSON-LD `Offer` schema**: ToS risk on hosted prices. Use plain HTML table.
- **Blur expansion in copy** (per Spec A finding): same airline operating multiple aircraft on same route produces IDENTICAL stats across those aircraft rows. UI copy must be HONEST — section heading reads "Typical fares by aircraft **on this route**" (not "for this aircraft"). Spec A documents that price stats are per-route-per-airline, blurred across that airline's aircraft.

## Architecture

```
/routes/lhr-jfk page:
  ├─ RouteLandingPage.jsx (existing)
  │    └─ <RouteAircraftPrices pair="lhr-jfk" />  ← NEW component
  │         fetches /api/routes/lhr-jfk/prices
  │         renders table with SafetyBadge
  │
  └─ SSR: bRoute(meta, db)
       └─ pricesBlock HTML appended after existing content
            renders same data Google sees (parity with React render)

/aircraft/boeing-787 page:
  ├─ AircraftLandingPage.jsx (existing)
  │    └─ <AircraftTopRoutesPrices icao="B789" />  ← NEW component
  │         fetches /api/aircraft/B789/prices
  │         renders top-10 routes table
  │
  └─ SSR: bAircraft(meta, db)
       └─ topRoutesBlock HTML appended after existing content
```

## Section 1: SafetyBadge component (reusable)

**File:** `client/src/components/SafetyBadge.jsx` + `.module.css`

```jsx
export default function SafetyBadge({ level, count }) {
  const color = { green: '#3a8d3a', yellow: '#c98b1f', red: '#c2362a' }[level] || '#888';
  const text = count === 0
    ? 'No incidents 5y'
    : `${count} ${count === 1 ? 'incident' : 'incidents'} 5y`;
  return (
    <span className={styles.badge} style={{ borderColor: color, color }}>
      {text}
    </span>
  );
}
```

**Tests** (`SafetyBadge.test.jsx`): green/yellow/red rendering, singular vs plural "incident(s)".

**Why reusable**: aircraft pages already have safety blocks. Future use in /safety/feed cards or accident pages.

## Section 2: RouteAircraftPrices component (`/routes/:pair`)

**File:** `client/src/components/RouteAircraftPrices.jsx` + `.module.css`

```jsx
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { API_BASE } from '../utils/api';
import SafetyBadge from './SafetyBadge';
import styles from './RouteAircraftPrices.module.css';

function gflightsUrl(pair) {
  const [dep, arr] = pair.toUpperCase().split('-');
  return `https://www.google.com/travel/flights?q=Flights%20to%20${arr}%20from%20${dep}%20oneway`;
}

export default function RouteAircraftPrices({ pair }) {
  const [data, setData] = useState(null);
  const [errorStatus, setErrorStatus] = useState(null);

  useEffect(() => {
    let active = true;
    setData(null); setErrorStatus(null);
    fetch(`${API_BASE}/api/routes/${pair}/prices`)
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(b => { if (active) setData(b); })
      .catch(s => { if (active) setErrorStatus(s); });
    return () => { active = false; };
  }, [pair]);

  // Empty / error: render nothing — page already has primary content.
  if (errorStatus) return null;
  if (!data) return null;          // initial: SSR-baked block already there
  if (!data.prices?.length) return null;

  const fmt = (n) => `€${Math.round(n)}`;

  return (
    <section className={styles.section} data-widget="route-aircraft-prices">
      <h2 className={styles.h2}>Typical fares by aircraft on this route</h2>
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">Aircraft</th>
            <th scope="col">Median</th>
            <th scope="col" className={styles.colRange}>Range</th>
            <th scope="col" className={styles.colOperators}>Operators</th>
            <th scope="col">Safety</th>
            <th scope="col" />
          </tr>
        </thead>
        <tbody>
          {data.prices.map(row => (
            <tr key={row.aircraft_icao}>
              <td>
                <Link to={`/aircraft/${row.aircraft_slug}`}>{row.aircraft_name}</Link>
              </td>
              <td className={styles.mono}>{fmt(row.median_eur)}</td>
              <td className={`${styles.mono} ${styles.colRange}`}>
                {fmt(row.min_eur)}–{fmt(row.max_eur)}
              </td>
              <td className={styles.colOperators}>{row.airlines_display}</td>
              <td>
                <SafetyBadge level={row.safety.level} count={row.safety.accident_count_5y} />
              </td>
              <td>
                <a href={gflightsUrl(pair)} target="_blank" rel="noopener noreferrer">
                  Check fares →
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className={styles.foot}>
        Based on {data.prices.reduce((s, r) => s + r.n_quotes, 0)} recent fare observations · Same aircraft type from one airline shows identical stats (route-level data; aircraft attribution is statistical).
      </p>
    </section>
  );
}
```

**CSS (mobile collapse):**
```css
.section { margin-block: 2rem; }
.table { width: 100%; border-collapse: collapse; }
.mono { font-variant-numeric: tabular-nums; }
.foot { font-size: 0.875rem; color: var(--text-secondary, #666); margin-top: 0.5rem; }

@media (max-width: 768px) {
  .colRange, .colOperators { display: none; }
}
```

**Mounting in `RouteLandingPage.jsx`**: import the component, render `<RouteAircraftPrices pair={pair} />` after the existing route-detail block (before the footer / cross-link section).

**Tests** (`RouteAircraftPrices.test.jsx`):
- 404 from API → `null`
- empty array → `null`
- happy path with 2 rows → both aircraft rendered, sorted by median, SafetyBadge present, mono formatting on price/range cols, GF deep-link href correct
- Operators column has `colOperators` class so CSS can hide on mobile

## Section 3: AircraftTopRoutesPrices component (`/aircraft/:slug`)

**File:** `client/src/components/AircraftTopRoutesPrices.jsx` + `.module.css`

```jsx
export default function AircraftTopRoutesPrices({ icao, familyLabel }) {
  const [data, setData] = useState(null);
  const [errorStatus, setErrorStatus] = useState(null);

  useEffect(() => {
    let active = true;
    setData(null); setErrorStatus(null);
    fetch(`${API_BASE}/api/aircraft/${icao}/prices`)
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(b => { if (active) setData(b); })
      .catch(s => { if (active) setErrorStatus(s); });
    return () => { active = false; };
  }, [icao]);

  if (errorStatus) return null;
  if (!data?.routes?.length) return null;
  if (data.routes.length < 3) return null;  // suppress thin

  const fmt = (n) => `€${Math.round(n)}`;

  return (
    <section className={styles.section} data-widget="aircraft-top-routes-prices">
      <h2 className={styles.h2}>
        Where the {familyLabel || icao} flies — and what it costs
      </h2>
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">Route</th>
            <th scope="col">Median fare</th>
            <th scope="col" className={styles.colSamples}>Sample size</th>
          </tr>
        </thead>
        <tbody>
          {data.routes.map(r => (
            <tr key={`${r.dep_iata}-${r.arr_iata}`}>
              <td>
                <Link to={`/routes/${r.dep_iata.toLowerCase()}-${r.arr_iata.toLowerCase()}`}>
                  {r.dep_city || r.dep_iata} → {r.arr_city || r.arr_iata}
                </Link>
              </td>
              <td className={styles.mono}>{fmt(r.median_eur)}</td>
              <td className={`${styles.mono} ${styles.colSamples}`}>{r.n_quotes} quotes</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className={styles.foot}>Top routes by sample size from the last ~30 days.</p>
    </section>
  );
}
```

**Mounting in `AircraftLandingPage.jsx`**: pass the family ICAO and label down. Component goes after existing safety/specs sections, before footer.

**Tests:**
- 404 or empty → null
- < 3 routes → null (suppress thin)
- 5 routes → all rendered, links to `/routes/{pair}` correct, mobile-collapse class on `colSamples`

## Section 4: SSR bake in `bRoute`

**File:** `server/src/services/seoContentBuilders.js` (modify `bRoute` around line 232)

After the existing content blocks in `bRoute(meta, db)`, before the `return` statement that combines them, append a `pricesBlock` if data exists:

```js
const routePricingService = require('./routePricingService');
// ... inside bRoute ...
let pricesBlock = '';
try {
  const prices = routePricingService.getPricesForRoute(meta.fromIata, meta.toIata);
  if (prices && prices.length >= 1) {
    const rows = prices.map(p => `
      <tr>
        <td><a href="/aircraft/${esc(p.aircraft_slug)}">${esc(p.aircraft_name)}</a></td>
        <td>€${Math.round(p.median_eur)}</td>
        <td>€${Math.round(p.min_eur)}–${Math.round(p.max_eur)}</td>
        <td>${esc(p.airlines_display || '')}</td>
      </tr>`).join('');
    const totalQuotes = prices.reduce((s, p) => s + p.n_quotes, 0);
    pricesBlock = `
<section class="route-aircraft-prices" data-widget="route-aircraft-prices">
  <h2>Typical fares by aircraft on this route</h2>
  <table>
    <thead><tr><th>Aircraft</th><th>Median</th><th>Range</th><th>Operators</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <p>Based on ${totalQuotes} recent fare observations.</p>
</section>`.trim();
  }
} catch (e) {
  // Defensive: never break SSR if price service fails. Log + drop.
  console.warn('[bRoute] pricesBlock build failed for %s-%s: %s', meta.fromIata, meta.toIata, e.message);
}
```

Then include `pricesBlock` in the final HTML assembly (after existing content blocks, before footer/jsonLd).

**Why no Safety column in SSR**: keeps SSR-only HTML lean. React widget adds Safety column on hydrate. Google sees the table and prices — that's enough for indexing.

**Lazy-bake regex check**: `/routes/:pair` already matches `isLazyPath` regex line 152. No regex change needed. Add a unit test asserting `isLazyPath('/routes/lhr-jfk')` still returns true (regression test for the trap from `[[feedback_lazy-bake-regex-sync]]`).

## Section 5: SSR bake in `bAircraft`

**File:** `server/src/services/seoContentBuilders.js` (modify `bAircraft` around line 447)

Same pattern. After existing aircraft content, before final assembly:

```js
let topRoutesBlock = '';
try {
  const routes = routePricingService.getRoutesForAircraft(meta.icao, 10);
  if (routes && routes.length >= 3) {
    const rows = routes.map(r => `
      <tr>
        <td><a href="/routes/${esc(r.dep_iata.toLowerCase())}-${esc(r.arr_iata.toLowerCase())}">${esc(r.dep_city || r.dep_iata)} → ${esc(r.arr_city || r.arr_iata)}</a></td>
        <td>€${Math.round(r.median_eur)}</td>
        <td>${r.n_quotes} quotes</td>
      </tr>`).join('');
    topRoutesBlock = `
<section class="aircraft-top-routes-prices" data-widget="aircraft-top-routes-prices">
  <h2>Where the ${esc(meta.familyLabel || meta.icao)} flies — and what it costs</h2>
  <table>
    <thead><tr><th>Route</th><th>Median fare</th><th>Sample size</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <p>Top routes by sample size from the last ~30 days.</p>
</section>`.trim();
  }
} catch (e) {
  console.warn('[bAircraft] topRoutesBlock build failed for %s: %s', meta.icao, e.message);
}
```

Suppress block when < 3 routes (matches React component behavior).

## Section 6: Testing strategy

### Server (Jest)
- `bRoute.prices.test.js`: with seeded `route_aircraft_prices` rows, bRoute output includes `data-widget="route-aircraft-prices"`. With no rows, attribute absent. With service throwing, SSR still completes (defensive).
- `bAircraft.topRoutes.test.js`: same pattern. < 3 routes → attribute absent.
- `seoContentCache.isLazyPath.routes.test.js`: regression test for `/routes/lhr-jfk` returning true (anti-trap for `[[feedback_lazy-bake-regex-sync]]`).

### Client (Vitest)
- `SafetyBadge.test.jsx`: 3 levels + singular/plural.
- `RouteAircraftPrices.test.jsx`: 4 states (404, empty, error, full data) + GF deep-link href + mobile-collapse classes.
- `AircraftTopRoutesPrices.test.jsx`: 3 states (404, < 3 routes → null, ≥3 routes rendered).
- `RouteLandingPage.test.jsx` (extension): asserts new widget mounts at right place.
- `AircraftLandingPage.test.jsx` (extension): same.

### Integration / smoke (post-deploy)
- `curl -A 'Googlebot' https://himaxym.com/routes/lhr-jfk | grep data-widget="route-aircraft-prices"` → non-zero (SSR bake confirmed).
- `curl -A 'Googlebot' https://himaxym.com/aircraft/boeing-787 | grep data-widget="aircraft-top-routes-prices"` → non-zero.
- Browser smoke: load `/routes/lhr-jfk`, verify table appears (SSR), then React mount enriches with Safety column (no DOM flicker).

## Section 7: Deploy story

Phased: ship SSR bake first (Google sees data faster), React widget second (UX polish). But since the lazy-bake cache is per-URL with TTL, both can ship together cleanly.

Recommended single deploy:
1. Run all new tests locally; green.
2. Push to main (auto-deploy ~90s).
3. Smoke endpoints with Googlebot UA.
4. Manually inspect 2-3 pages in real browser.
5. Trigger IndexNow ping for `/routes/` and `/aircraft/` families to accelerate Google re-crawl.

## Risks and mitigations

1. **Blur expansion creates user-visible duplication.** Same airline, multiple aircraft on same route → identical stats. Mitigation: footer copy explicitly says "aircraft attribution is statistical" and "same aircraft type from one airline shows identical stats". Users won't be confused if we're upfront.
2. **`routePricingService` errors during SSR.** Mitigation: each try/catch in bRoute/bAircraft falls back to empty block. SSR never fails because of price service.
3. **Lazy-bake regex desync (recurring trap, hit 3×).** Mitigation: regression test in `isLazyPath` test file asserts `/routes/lhr-jfk` and `/aircraft/boeing-787-9` (slug) still match. Existing regex covers both — no change needed, just lock it down.
4. **Mobile column collapse via CSS only.** Verify on real device or DevTools narrow viewport. Risk: if site uses container queries elsewhere, our media-query approach is inconsistent. Mitigation: use the same breakpoint (`768px`) the rest of the site already uses.
5. **Cache invalidation lag.** `routePricingService` caches 5 minutes. After aggregate-gf-prices cron at 05:00 UTC, the new data shows up on next page hit after 5 min stale window. Acceptable.
6. **`familyLabel` on `bAircraft`.** The SSR builder needs the human label ("Boeing 787-9"). Verify `meta.familyLabel` exists in the meta resolver; if not, fall back to ICAO.

## Files affected

**New:**
- `client/src/components/SafetyBadge.jsx`
- `client/src/components/SafetyBadge.module.css`
- `client/src/components/RouteAircraftPrices.jsx`
- `client/src/components/RouteAircraftPrices.module.css`
- `client/src/components/AircraftTopRoutesPrices.jsx`
- `client/src/components/AircraftTopRoutesPrices.module.css`
- `client/src/components/__tests__/SafetyBadge.test.jsx`
- `client/src/components/__tests__/RouteAircraftPrices.test.jsx`
- `client/src/components/__tests__/AircraftTopRoutesPrices.test.jsx`
- `server/src/__tests__/bRoute.prices.test.js`
- `server/src/__tests__/bAircraft.topRoutes.test.js`
- `server/src/__tests__/seoContentCache.isLazyPath.routes.test.js`

**Modified:**
- `client/src/components/RouteLandingPage.jsx` — import + mount `RouteAircraftPrices`
- `client/src/components/AircraftLandingPage.jsx` — import + mount `AircraftTopRoutesPrices`
- `server/src/services/seoContentBuilders.js` — `bRoute` + `bAircraft` get pricesBlock/topRoutesBlock

## Success criteria

After deploy:
- Both endpoint pages show price widget when data exists, hide when empty (no broken UI)
- `curl -A Googlebot https://himaxym.com/routes/lhr-jfk | grep -c data-widget="route-aircraft-prices"` → 1
- `curl -A Googlebot https://himaxym.com/aircraft/boeing-787-9 | grep -c data-widget="aircraft-top-routes-prices"` → 1
- React widget loads with no console errors
- Mobile (<768px viewport) hides Operators + Range columns; Aircraft / Median / Safety / GF-link visible
- Safety badge displays correct color based on level
- GF deep-link opens in new tab without aircraft lock
- All new tests green; existing tests unaffected

## Out of scope (future)

- Per-airline filter on route widget ("show me only Lufthansa prices") — UI complexity, low marginal value
- Currency conversion (only EUR for now)
- Time-of-year price chart — would need date-bucketed aggregation
- Cabin-class breakdown (economy/business) — GF scrape doesn't expose this consistently
