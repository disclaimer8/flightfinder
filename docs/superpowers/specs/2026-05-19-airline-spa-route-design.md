# /airline/:iata SPA route — design

**Date:** 2026-05-19
**Status:** approved, pending implementation
**Origin:** post-Hetzner-migration follow-up #2 ([[project_post-migration-followups]])

## Problem

`/airline/:iata` is served via SSR (jonty-backed when available, Amadeus-backed `bAirline` fallback). Googlebot sees the full SSR shell. Real users, however:

- Land on the page from a bookmark or shared link: SSR flashes for ~50–200ms, then `client/src/index.jsx` calls `createRoot().render()` (NOT `hydrateRoot`) which wipes `#root` and re-renders.
- Navigate client-side via React Router: the SPA has no matching `<Route>` for `/airline/:iata` (only `/airline/:iata/aircraft/:icao` is registered). The catch-all `<Route path="*" element={<Home />} />` takes over and the home hero appears.

End result: shared airline links degrade to the home page for humans. SEO is unaffected (bots get full SSR pre-mount). The fix is a client-side route component that matches the SSR content depth.

## Decisions

- **Depth:** full parity with SSR content (intro, hubs, top aircraft, top destinations, safety cross-link).
- **Data source:** local SQLite only — `jonty.db` + `observed_routes` table via existing services. **No Amadeus calls from the SPA endpoint** (Amadeus self-service has 3 deprecated analytics endpoints — [[feedback_amadeus-self-service-prod-deprecations]]; keeps SPA fast and reliable).
- **Rendering model:** stay on `createRoot` (no migration to `hydrateRoot`); add a real SPA route that fetches and renders.

## Architecture

```
GET /airline/dlh
  ├─ SSR (existing): jonty path OR bAirline fallback → baked HTML
  └─ SPA mount (new): React Router matches /airline/:iata
        → AirlineLanding component
        → fetch /api/airline/dlh
        → render sections matching SSR depth
```

### New JSON endpoint: `GET /api/airline/:iata`

**File:** `server/src/routes/airline.js` (new)

**Response shape:**

```json
{
  "airline": { "iata": "LH", "icao": "DLH", "name": "Lufthansa" },
  "jonty": {
    "totalRoutes": 287,
    "totalCountries": 64,
    "hubCount": 3,
    "origins": [
      { "iata": "FRA", "city": "Frankfurt", "country": "Germany", "routeCount": 142 }
    ]
  },
  "observed": {
    "topAircraft": [
      { "icao": "A320", "name": "Airbus A320", "nPairs": 87, "hasMatrix": true }
    ],
    "hubs": [
      { "iata": "FRA", "city": "Frankfurt", "country": "Germany", "pairCount": 142 }
    ],
    "topDests": [
      { "iata": "JFK", "city": "New York", "country": "USA", "pairCount": 12 }
    ]
  }
}
```

- `jonty: null` when carrier missing from `jonty.db`.
- `observed.topAircraft`, `observed.hubs`, `observed.topDests` may all be empty arrays.
- **404** when `jonty == null` AND all observed arrays empty.
- `origins` capped at 100 entries (SSR parity).
- `topAircraft` capped at 6, `hubs` and `topDests` at 5.
- `hasMatrix` = true when `(iata, icao)` exists in `airlineAircraftService.listValidCombinations({ minPairs: 5 })`.

**Caching:** in-memory LRU keyed by uppercase IATA, 5-minute TTL. Same pattern as `routes/airlineAircraft.js`.

**ICAO/IATA mapping (critical, per [[feedback_observed-routes-airline-column-icao]]):**
- `jonty.db` stores **IATA** in `carrier_iata`. Resolve airline name via `getAirlineByIata`.
- `observed_routes.airline_iata` actually stores **ICAO**. Resolve name via `getAirlineByIcao`.
- The endpoint accepts IATA in the URL; convert to ICAO before hitting `observed_routes`. Use `airlines` table lookup.

### New SPA page: `AirlineLanding`

**Files:**
- `client/src/pages/AirlineLanding.jsx`
- `client/src/pages/AirlineLanding.module.css`

**Component contract:**

```jsx
function AirlineLanding() {
  const { iata } = useParams();
  // states: loading | error{status} | data
  // fetch /api/airline/:iata
  // render sections below
}
```

**Sections (SSR parity):**

1. **Hero** — `<h1>{name} — destinations and fleet</h1>`
2. **Intro** (when `jonty` present) — paragraph: "<name> operates X non-stop routes across Y countries, with Z hub airports."
3. **"Where {name} flies from"** (when `jonty.origins` non-empty) — ordered list of origins linked to `/airline/{iata}/from/{originIata}`, format `City (IATA) — N routes`.
4. **"Top aircraft"** (when `observed.topAircraft` non-empty) — list of 6 items; each is either `<Link to="/airline/{iata}/aircraft/{icao}">{name}</Link> — N route pairs` (when `hasMatrix`) or plain `{name} — N route pairs`.
5. **"Hub airports"** (when `observed.hubs` non-empty) — list of 5; format `{iata} · {city}, {country} · {pairCount} routes`.
6. **"Top destinations"** (when `observed.topDests` non-empty) — list of 5; same format.
7. **"Safety record"** — paragraph + link `/safety/global?op={icao}`.

**States:**
- **Loading:** centered "Loading…" matching `AirlineAircraftLanding` aesthetic.
- **404 / empty:** "We're still gathering routes for this carrier. <Link to='/by-aircraft'>Browse by aircraft</Link>."
- **Generic error:** "Failed to load — please try again."

**Visual style:** CSS module mirrors `AirlineAircraftLanding.module.css` (hero, sections, tables, monospace for codes).

### Route registration

**File:** `client/src/AppRoutes.jsx`

Add inside `<Route element={<SiteLayout />}>` block, AFTER the existing `/airline/:iata/aircraft/:icao` route (more specific first ensures proper matching even though React Router v6 ranks by specificity):

```jsx
const AirlineLanding = lazy(() => import('./pages/AirlineLanding'));
// ...
<Route path="/airline/:iata/aircraft/:icao" element={...} />
<Route path="/airline/:iata" element={<Suspense fallback={null}><AirlineLanding /></Suspense>} />
```

### Server mount

**File:** `server/src/index.js`

Mount the new router at the same base path as the existing airline-aircraft router. Express's path matching makes them non-conflicting: `airline.js` defines only `GET /:iata` (single segment), so requests like `/api/airline/lh/aircraft/a320/routes` fall through to `airlineAircraft.js`. Place the new mount BEFORE the existing one (line 221) for predictable ordering:

```js
app.use('/api/airline',       require('./routes/airline'));         // new — GET /:iata
app.use('/api/airline',       require('./routes/airlineAircraft')); // existing — /:iata/aircraft/:icao/routes
```

## Testing

**Server** (`server/src/__tests__/airlineRoutes.test.js`):
- 200 with full jonty + observed data
- 200 with jonty only (observed empty)
- 200 with observed only (jonty null)
- 404 with both empty
- Verify airline name resolution: IATA→name (jonty path) and ICAO→name (observed path) both work and return the same name for the same carrier
- Cache hit: second call within TTL doesn't re-query

**Client** (`client/src/components/__tests__/AirlineLanding.test.jsx`):
- Loading → data render: fetches `/api/airline/lh`, renders all sections
- 404 → empty state: renders "still gathering" message + by-aircraft link
- Matrix link: when `hasMatrix=true`, top aircraft item is a `<Link>` to matrix; otherwise plain text
- Conditional sections: jonty=null hides intro + origins; empty observed.hubs hides hubs section

**Integration / smoke:**
- After deploy, curl `/api/airline/lh` (jonty-backed) and `/api/airline/uia` (observed-only) and verify shape
- Browser load `/airline/lh`: confirm no Home flash; airline content stays
- Browser navigate from `/by-aircraft` → click airline link → SPA route activates

## Files affected

**New:**
- `server/src/routes/airline.js`
- `server/src/__tests__/airlineRoutes.test.js`
- `client/src/pages/AirlineLanding.jsx`
- `client/src/pages/AirlineLanding.module.css`
- `client/src/components/__tests__/AirlineLanding.test.jsx`

**Edited:**
- `server/src/index.js` — mount `/api/airline` router
- `client/src/AppRoutes.jsx` — register lazy `AirlineLanding` route

## Risks and mitigations

1. **ICAO column trap in observed_routes** ([[feedback_observed-routes-airline-column-icao]] — hit twice in production already). Mitigation: explicit ICAO conversion before query, inline comment, unit test asserts both IATA and ICAO lookups return same airline name.
2. **SSR/SPA divergence on empty data.** Bot might see Amadeus-backed SSR content; SPA returns 404 because local DBs are empty. Acceptable — Amadeus content is fading out anyway, and a 404 with cross-link is better UX than a 5-second hung fetch.
3. **`seoContentCache.isLazyPath` regex desync** ([[feedback_lazy-bake-regex-sync]] — hit 3× in one sprint). `/airline/:iata` is an existing SSR-baked path; the regex already matches. Verify before deploy as part of standard SEO smoke.
4. **Route specificity in React Router v6.** v6 ranks routes by specificity, so order shouldn't matter in theory. Test by navigating to `/airline/lh/aircraft/a320` — must still resolve to `AirlineAircraftLanding`, not `AirlineLanding`.

## Out of scope

- Adding Amadeus fallback (deliberately rejected — see Decisions).
- Migrating to `hydrateRoot` (deliberately rejected — wide refactor, breaks other pages' SSR-then-replace contract).
- New aggregation logic (top aircraft, hubs, destinations already exist in `airlineAircraftService`).
- Editorial intro generation (jonty path uses `seoEditorialIntro.airline` server-side; SPA computes inline from stats — no new editorial service).
- Sitemap / canonical changes (URL family unchanged).
