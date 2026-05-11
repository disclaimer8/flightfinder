# Amadeus Production API — Analytics Tier integration

**Date:** 2026-05-11
**Status:** Design (amended post-impl)
**Owner:** Denys

---

## Post-implementation amendment (2026-05-11, verified against prod app)

A smoke test against the approved production app revealed that three of the
six planned endpoints are unusable in Amadeus Self-Service production:

| Endpoint | Status | Reason |
|---|---|---|
| `airport_direct_dest` | ✓ works | — |
| `airline_routes` | ✓ works | — |
| `most_traveled` | ✗ 404 | "Resource not found" — endpoint not enabled for self-service prod |
| `most_booked` | ✗ 404 | same |
| `travel_recs` | ✗ 410 GONE | "API is decommissioned and resource can not be accessible anymore" |

`busiest_period` was already dropped pre-implementation due to the
cityCode-vs-airport-IATA mismatch.

**Net surviving scope:**
- `/airport/:iata` × ~200 — direct destinations + Airport JSON-LD + sidebar
- `/airline/:iata` × ~100 — network destinations + Airline JSON-LD + sidebar
- Route enrichment ("Top destinations travelled from X") — **removed**
- Travel Recommendations cross-link sidebar for routes — **removed**

The two surviving endpoints still deliver the bulk of the new SEO surface
value (JFK returns 186 direct destinations, BA returns 472 routes — real
production data). Code referencing the deprecated endpoints has been
removed to prevent log spam.

---

## Problem

Amadeus production API was approved this week. The existing integration (`server/src/services/amadeusService.js`) was wired against the *test* environment with `AMADEUS_CLIENT_ID/SECRET` commented out in `server/.env` and is currently dead — all flight search traffic flows through Duffel / Travelpayouts / mock fallback (`flightController.js:617` literally notes "Amadeus credentials are dead").

Production unlocks ~20 Self-Service v3 endpoints that the test sandbox could not serve for real routes. The highest-leverage subset for FlightFinder — a SEO-driven flight/aircraft data site — is **analytics & reference data**, not live offer search. These endpoints return slow-changing facts (airport route networks, traffic aggregates, similar destinations) that plug directly into the existing SEO bake pipeline alongside FR24, return cheap per-call payloads (~$0.0005 each at Self-Service pricing), and unlock two net-new indexable URL families.

Live Flight Offers Search migration (Tier B) and booking funnel (Tier C) are out of scope for this iteration — they have different cache models, budget profiles, and compliance footprints and will be scoped separately.

## Goals

1. Plug five Amadeus production endpoints into the SEO bake pipeline as slow-changing facts:
   - **Airport Direct Destinations** (`/v1/airport/direct-destinations`)
   - **Airline Routes** (`/v1/airline/destinations`)
   - **Flight Most Traveled Destinations** (`/v1/travel/analytics/air-traffic/traveled`)
   - **Flight Most Booked Destinations** (`/v1/travel/analytics/air-traffic/booked`)
   - **Flight Busiest Travel Period** (`/v1/travel/analytics/air-traffic/busiest-period`)
   - **Travel Recommendations** (`/v1/reference-data/recommended-locations`)
2. Introduce two new indexable URL families: `/airport/:iata` and `/airline/:iata`.
3. Enrich existing `/routes/:from-:to` pages with "Top destinations from origin" and "Busiest period" fact blocks.
4. Add "Similar destinations" cross-links to the site chrome for route and airport surfaces.
5. Keep production credit burn bounded (<$30/mo at steady state) via persistent SQLite cache + IS_LEADER warm + daily budget guard.

## Non-goals

- Live Flight Offers Search migration to production (deferred — separate spec).
- Booking funnel: Flight Offers Price, Flight Create Orders, SeatMap (deferred — separate spec).
- Flight Delay Prediction & Airport On-Time Performance (rejected for this iteration).
- Hotels, POI, Tours, Trip Purpose Prediction (out of FlightFinder niche).
- Replacing FR24 — Amadeus analytics complements FR24, not replaces it. FR24 = worldwide operator/route stats from open ADS-B; Amadeus = booked/traveled passenger aggregates from GDS. Different signals, both useful.

## Architecture

Two services, two cache models, one URL pipeline.

```
                       ┌──────────────────────────────┐
                       │ amadeusService.js (existing) │  live search — RAM cache
                       │ — flight Offers Search       │  request-scoped TTL
                       │ — Flight Dates / Inspiration │  no IS_LEADER
                       └──────────────────────────────┘
                                                          (untouched in this spec)

                       ┌──────────────────────────────┐
                       │ amadeusAnalyticsService.js   │  slow-changing facts
                       │ — airportDirectDestinations  │  SQLite cache
                       │ — airlineRoutes              │  IS_LEADER fetch
                       │ — mostTraveled / mostBooked  │  30d TTL
                       │ — busiestPeriod              │  budget guard
                       │ — travelRecommendations      │
                       └──────────────────────────────┘
                                  │ read
                                  ▼
                       ┌──────────────────────────────┐
                       │ amadeus_cache table (SQLite) │
                       │ endpoint, key, payload,      │
                       │ fetched_at, expires_at       │
                       └──────────────────────────────┘
                                  │
                  ┌───────────────┼────────────────────────┐
                  ▼               ▼                        ▼
           bAirport(meta)   bAirline(meta)    bRoutePair(...) + cross-refs
                  │               │                        │
                  └────────► seoContentBuilders.build(meta) ◄──── applyChrome (Travel Recs)
                                          │
                                          ▼
                          seoContentCache (existing 6h warm + per-URL bake)
```

### Component split rationale

The existing `amadeusService.js` is a thin SDK wrapper for **live, request-scoped** offer search — RAM cache, no persistence, ~hours TTL at most, called inside request handlers. Adding 5–6 analytics methods to it would couple two cache disciplines (request-scoped vs multi-day persistent) and would conflict with the cluster-mode invariant "background workers and one-shot bootstraps guarded by IS_LEADER" (`feedback_seo-bake-invariants.md`).

A separate `amadeusAnalyticsService.js` keeps each service one-purposed: live search vs slow facts. Both wrap the same `Amadeus` SDK instance (initialized once in a shared client module — see Components/Module split below) and the same env-var configuration, so the only operational difference is the cache strategy.

## Components

### 1. Shared client module — `server/src/services/amadeusClient.js` (new, ~25 lines)

Extract the `new Amadeus({...})` initialization from `amadeusService.js` into its own module so both services share one SDK client (one auth token, one rate-limit bucket).

```js
// server/src/services/amadeusClient.js
const Amadeus = require('amadeus');

let client = null;
function getClient() {
  if (client) return client;
  const id = process.env.AMADEUS_CLIENT_ID;
  const secret = process.env.AMADEUS_CLIENT_SECRET;
  if (!id || !secret) return null;
  try {
    client = new Amadeus({
      clientId: id,
      clientSecret: secret,
      hostname: process.env.AMADEUS_ENV === 'production' ? 'production' : 'test',
    });
    return client;
  } catch (err) {
    console.warn('[amadeus] init failed:', err.message);
    return null;
  }
}

function isEnabled() { return getClient() !== null; }

module.exports = { getClient, isEnabled };
```

Existing `amadeusService.js` is refactored to consume `getClient()` instead of holding its own instance. Behavior identical; this is a pure extraction.

### 2. SQLite cache table

New migration in `server/src/models/db.js` `init()` (same pattern as existing tables — `CREATE TABLE IF NOT EXISTS`):

```sql
CREATE TABLE IF NOT EXISTS amadeus_cache (
  endpoint     TEXT    NOT NULL,
  key          TEXT    NOT NULL,
  payload_json TEXT    NOT NULL,
  fetched_at   INTEGER NOT NULL,    -- ms epoch
  expires_at   INTEGER NOT NULL,    -- ms epoch
  PRIMARY KEY (endpoint, key)
);
CREATE INDEX IF NOT EXISTS idx_amadeus_cache_expires
  ON amadeus_cache(expires_at);

CREATE TABLE IF NOT EXISTS amadeus_budget (
  day_utc   TEXT    NOT NULL PRIMARY KEY,  -- 'YYYY-MM-DD'
  calls     INTEGER NOT NULL DEFAULT 0,
  errors    INTEGER NOT NULL DEFAULT 0
);
```

`endpoint` values: `airport_direct_dest`, `airline_routes`, `most_traveled`, `most_booked`, `busiest_period`, `travel_recs`. `key` is endpoint-specific (e.g., `JFK` for airport, `BA` for airline, `MAD:2026` for most-traveled origin+year, `LON:JFK` for busiest-period O&D).

New model: `server/src/models/amadeusCache.js` exporting `get(endpoint, key)`, `put(endpoint, key, payload, ttlMs)`, `getStale(endpoint, ttlMs, limit)`, `incrementBudget(callsDelta, errorsDelta)`, `todayBudget()`.

### 3. `amadeusAnalyticsService.js` — new, ~250 lines

Public methods (all return parsed payloads, throw on hard failure, log+null on soft failure):

```js
async function getAirportDirectDestinations(iata)   // → string[] of dest IATAs
async function getAirlineRoutes(iata)               // → string[] of dest IATAs
async function getMostTraveled(originIata, period)  // → [{destination, analytics}]
async function getMostBooked(originIata, period)    // → [{destination, analytics}]
async function getBusiestPeriod(cityCode, year, period)  // → [{period, analytics}]
async function getTravelRecommendations(cityCodes, travelerCountryCode)
                                                    // → [{name, iataCode, ...}]
```

Each method:
1. Compute cache key for endpoint.
2. Read from `amadeusCache.get(endpoint, key)` — return immediately if fresh.
3. If stale/missing AND `IS_LEADER` AND budget not exceeded — fetch from Amadeus SDK; on success, `put` with TTL; return payload.
4. If stale/missing AND **not** IS_LEADER — return last stale value if present, else null (follower never originates fetches).
5. If budget exceeded — return stale-or-null; increment `errors` counter only on actual API error.

TTLs (constants at top of file):
- `TTL_AIRPORT_DIRECT_DEST = 30d` — airline network changes slowly
- `TTL_AIRLINE_ROUTES = 30d` — same
- `TTL_MOST_TRAVELED = 30d` — annual aggregate
- `TTL_MOST_BOOKED = 30d` — annual aggregate
- `TTL_BUSIEST_PERIOD = 90d` — yearly seasonality
- `TTL_TRAVEL_RECS = 14d` — recommendations evolve faster

Budget guard:
- `AMADEUS_DAILY_BUDGET_CALLS` env (default `1000`)
- Before each fetch: `if (todayBudget().calls >= cap) return staleOrNull()`
- After each fetch: `incrementBudget(1, errorOccurred ? 1 : 0)`
- Log warning once per day when budget first crosses cap

### 4. Warm integration

Extend `seoContentCache.warm()` with an Amadeus refresh pass, mirroring the FR24 fire-and-forget pattern:

```js
// inside warm(), after fr24CacheService refresh block
if (process.env.NODE_APP_INSTANCE == null || process.env.NODE_APP_INSTANCE === '0') {
  amadeusAnalyticsService.refreshStale().catch((err) => {
    console.warn(`[amadeus-analytics] background refresh error: ${err.message || err}`);
  });
}
```

`refreshStale()` iterates a deterministic enumeration of (endpoint, key) tuples — same enumeration that `seoUrlEnumerator` uses — and refreshes only entries past TTL, capped at `AMADEUS_DAILY_BUDGET_CALLS`. Returns `{ refreshed, skipped, failed, budgetRemaining }`.

Enumeration sources (from existing DB):
- **Airports for `/airport/:iata`**: top ~200 IATA codes by `(dep_iata count + arr_iata count)` in `observed_routes`. SQL added to `db.js` as `getTopAirportsByObservedActivity(limit)`.
- **Airlines for `/airline/:iata`**: top ~100 IATA airline codes by observed flight count in `observed_routes` (column `airline_iata` if present — verify in `models/db.js`; if absent, sourced from `aircraftPillarService` airline aggregation).
- **Most-traveled origins**: same top ~200 airports → fetched for `period=2025` (last completed year).
- **Busiest-period O&D pairs**: top ~500 hub-network edges (existing `getHubNetwork({ hubLimit: 200, minDests: 15, edgeLimit: 500 })` in `seoUrlEnumerator`).
- **Travel-recs**: top ~200 destination cities derived from above.

Total cold-start enumeration: ~1500 calls × ~$0.0005 = ~$0.75 one-time. Steady-state monthly refresh: ~50 calls/day average ≈ $0.75/month.

### 5. URL enumeration

Add to `seoUrlEnumerator.js`:

```js
// after the hub-network edges block
try {
  for (const a of db.getTopAirportsByObservedActivity?.({ limit: 200 }) ?? []) {
    set.add(`/airport/${a.iata.toLowerCase()}`);
  }
} catch (err) { console.warn('[seoUrlEnumerator] top airports unavailable:', err.message); }

try {
  for (const al of db.getTopAirlinesByObservedActivity?.({ limit: 100 }) ?? []) {
    set.add(`/airline/${al.iata.toLowerCase()}`);
  }
} catch (err) { console.warn('[seoUrlEnumerator] top airlines unavailable:', err.message); }
```

These must run **after** the airport/airline enumeration is also fed to `amadeusAnalyticsService.refreshStale()` — single source of truth so the URL enumerated for SEO is the one we have cached facts for.

### 6. `seoMetaService.resolve()` cases

Add two new regex branches before the catch-all 404:

```js
const airportMatch = /^\/airport\/([a-z]{3})\/?$/i.exec(pathname);
if (airportMatch) return airportMeta(airportMatch[1].toLowerCase());

const airlineMatch = /^\/airline\/([a-z0-9]{2,3})\/?$/i.exec(pathname);
if (airlineMatch) return airlineMeta(airlineMatch[1].toLowerCase());
```

`airportMeta(iata)` and `airlineMeta(iata)` produce `{ title, description, canonical, h1, subtitle, robots:'index, follow', kind:'airport'|'airline', iata, name }`. Title/description templates follow existing patterns (e.g., `bRoute` meta).

If IATA is not in our enumerated top list — return `{ ...HOME, kind:'not-found', robots:'noindex, follow' }` (matches existing 404 contract; same noindex behavior as stale `/routes/:pair/:slug`).

### 7. Builders

Add to `seoContentBuilders.js`:

- **`bAirport(meta, db)`** — Renders for `/airport/:iata`:
  - H1: `{Airport name} ({IATA}) flights and destinations`
  - Direct destinations list (from `amadeusAnalyticsService.getAirportDirectDestinations(iata)`) — each linkified to `/airport/:dest` or `/routes/:iata-:dest`
  - Top airlines serving the airport (from observed_routes DB aggregation, same source as `aircraft-airlines`)
  - "Most traveled destinations" block from `getMostTraveled(iata, '2025')`
  - "Busiest periods" hint if data available
  - JSON-LD: `Airport` schema with `geo` (if coords available from OurAirports), `iataCode`, `name`
- **`bAirline(meta, db)`** — Renders for `/airline/:iata`:
  - H1: `{Airline name} ({IATA}) destinations and fleet`
  - Network destinations list from `getAirlineRoutes(iata)`
  - Observed aircraft families (DB aggregation from `aircraftPillarService`)
  - Top routes (DB aggregation by airline)
  - JSON-LD: `Airline` schema (Organization subtype), `iataCode`, `name`
- **`bRoutePair` enrichment** — extend existing `bRoute(meta, db)`:
  - Add "Top destinations from {origin}" block (top 5 from `getMostTraveled(originIata, '2025')`)
  - Add "Busiest period" line if `getBusiestPeriod(originCity, year, 'YEAR')` returns data
  - Both blocks render only when Amadeus data present — silent skip on null (no broken UI)

Dispatch additions in `build()`:

```js
else if (meta.kind === 'airport')            innerHtml = bAirport(meta, dbInstance);
else if (meta.kind === 'airline')            innerHtml = bAirline(meta, dbInstance);
```

### 8. Chrome — Travel Recommendations cross-links

Extend `seoChrome.js`:
- New helper `_crossRefsForAirport(meta, db)` — direct destinations as internal links to `/airport/:dest`.
- New helper `_crossRefsForAirline(meta, db)` — destinations + top routes.
- Extend `_crossRefsForRoute(meta, db)` with a "Similar destinations" sub-block sourced from `amadeusAnalyticsService.getTravelRecommendations([destCity], originCountry)`. Falls back to current cross-refs if Amadeus returns null.
- `_renderCrossRefs(meta, db)` dispatch updated to route `airport` and `airline` kinds.

Cross-refs are **strict best-effort** — Amadeus null → existing chrome behavior unchanged. Never block the bake on Amadeus.

### 9. Sitemap

`server/src/routes/seo.js` iterates `enumerateSeoUrls()` and assigns `changefreq` / `priority` per URL prefix via an if-ladder (line 58–75). Adding airport/airline paths to the enumerator (step 5) gets them included automatically, but they would fall into the default branch (`changefreq: 'weekly', priority: '0.5'`). Add explicit branches before the default:

```js
if (p.startsWith('/airport/'))  return { loc, changefreq: 'monthly', priority: '0.6', lastmod: today };
if (p.startsWith('/airline/'))  return { loc, changefreq: 'monthly', priority: '0.6', lastmod: today };
```

`monthly` matches the slow-changing nature of airport/airline reference data; `0.6` aligns with route pages.

### 10. Env / rollout

```
# server/.env (uncomment + set production keys)
AMADEUS_CLIENT_ID=<prod_id>
AMADEUS_CLIENT_SECRET=<prod_secret>
AMADEUS_ENV=production
AMADEUS_DAILY_BUDGET_CALLS=1000
```

Same secrets in GitHub Actions repo secrets for deploy.yml (mirror of how FR24 key was added per `project_flightfinder.md`).

## Data flow

**Cold path (first request after deploy / cache miss):**
1. Request `/airport/jfk`
2. `seoMetaService.resolve('/airport/jfk')` → `airportMeta('jfk')`
3. `seoContentBuilders.build(meta)` → `bAirport(meta, db)`
4. `bAirport` calls `amadeusAnalyticsService.getAirportDirectDestinations('JFK')`
5. Cache miss → IS_LEADER? Yes → SDK call → put in `amadeus_cache` → return → render
6. Cache miss → IS_LEADER? No → return null → builder skips Amadeus block → renders DB-only content
7. `applyChrome` adds cross-refs (Travel Recs best-effort, same cache flow)
8. SPA fallback in `index.js` serves baked HTML

**Warm path (cached):**
1–3 same.
4. Cache hit → return parsed payload immediately (SQLite read, ~0.5ms).
5. Render full content with Amadeus facts.

**Background refresh (every 6h, IS_LEADER only):**
1. `seoContentCache.warm()` fires (existing 6h tick).
2. Fire-and-forget `amadeusAnalyticsService.refreshStale()`.
3. `refreshStale` iterates enumeration, fetches only past-TTL rows, respects daily budget cap.
4. Updates `amadeus_cache` rows in place. Next `seoContentCache.refresh()` tick rebuilds bake with fresh facts.

## Error handling

| Failure | Behavior |
|---|---|
| `AMADEUS_CLIENT_ID/SECRET` not set | `amadeusClient.isEnabled()` returns false; all analytics service methods return null; builders skip Amadeus blocks; bake degrades to DB-only content. No errors thrown. |
| `AMADEUS_ENV` not `production` | SDK uses test hostname (matches existing behavior). Self-Service test endpoints return limited / empty data for most analytics calls — logged once at warm time. |
| 401 / invalid creds | Service logs once, marks circuit "open" for 1h via in-memory flag, returns null. Re-tries after 1h. |
| 429 quota exceeded | Service logs, records `errors+=1` in `amadeus_budget`, returns stale-or-null. Backs off until next UTC day. |
| 5xx / timeout | Same as 429 (stale-or-null + error counter). SDK timeout: 10s. |
| Daily budget cap reached | All further fetches return stale-or-null. Warning logged once per day at the moment of crossing. |
| Builder crash | Existing `seoContentCache.warm()` try/catch preserves prior cached value (per `seoContentCache.js:65-69`). Builder must not throw for transient Amadeus null — return partial content. |
| DB write failure on `amadeus_cache` | Logged; in-memory fallback so request still serves. Acceptable — next deploy fixes it. |
| Cluster: follower fetches | **Must not happen.** All write paths gated by `IS_LEADER` check (= `!process.env.NODE_APP_INSTANCE || NODE_APP_INSTANCE === '0'`, same expression used in `index.js:404`). Followers read SQLite only. |

## Testing

Unit tests in `server/__tests__/` (jest, in-memory SQLite via `NODE_ENV=test`):

1. **`amadeusCache.test.js`** — model layer: put/get round-trip, TTL expiration via `expires_at` (mock Date.now), `getStale` returns only past-TTL rows, budget increment/read.
2. **`amadeusAnalyticsService.test.js`** — SDK mocked at `amadeusClient.getClient()` boundary:
   - Cache hit returns immediately without SDK call (verify mock not invoked)
   - Cache miss + IS_LEADER fetches and writes
   - Cache miss + follower (set `NODE_APP_INSTANCE='1'`) does **not** fetch
   - Budget cap reached → returns null without SDK call
   - 429 from SDK → records error, returns stale
   - 401 → opens circuit, second call within 1h returns null without SDK call
3. **`bAirport.test.js` / `bAirline.test.js`** — builder layer with Amadeus service mocked:
   - Renders expected H1, lists, JSON-LD when service returns data
   - Renders DB-only content when service returns null (no broken HTML, no thrown exceptions)
   - Cross-refs section appears with linkified destinations
4. **`seoMetaService.test.js`** — add cases for `/airport/jfk`, `/airline/ba`. Verify regex precedence (airport regex doesn't shadow other `/airport`-prefixed routes if any exist; verify nothing currently does).
5. **`seoUrlEnumerator.test.js`** — top airports/airlines included when DB has data; gracefully omits when DB methods return empty.
6. **Integration: `amadeus-bake.integration.test.js`** — end-to-end: mock Amadeus client, run `seoContentCache.warm()`, hit SPA fallback for `/airport/jfk`, assert response HTML contains baked airport block.

**Smoke gate before merge:** `NODE_APP_INSTANCE=0 node -e "require('./server/src/services/amadeusAnalyticsService').refreshStale().then(console.log)"` with prod creds → returns `{refreshed: N>0, failed: 0}`.

**Pre-existing failing suite to ignore in baseline:** `historical.bootstrap.test.js` (duckdb under Node 25 — known issue per project memory).

## Verification after deploy

Per existing FlightFinder convention:

```bash
curl -s -A 'Googlebot' https://himaxym.com/airport/jfk | grep -c data-seo-bake
# expect non-zero — page is baked

curl -s -A 'Googlebot' https://himaxym.com/airline/ba | grep -c data-seo-bake
# expect non-zero

curl -s https://himaxym.com/sitemap.xml | grep -c '/airport/'
# expect ~200 entries

curl -s https://himaxym.com/sitemap.xml | grep -c '/airline/'
# expect ~100 entries
```

Search Console submission: re-submit sitemap once new URLs are live; expect "Discovered — not indexed" first, then progressive indexing over 4–8 weeks (same pattern as prior SEO surfaces per project memory).

## Out-of-scope / explicit deferrals

- Tier B: live `/api/flights` migration to production Amadeus. Requires separate spec with: rate-limit per IP, request-scoped cache TTL, budget guard scaled to live volume (~$0.0035/call), Duffel deprecation timeline.
- Tier C: Flight Offers Price, Create Orders, SeatMap, booking confirmation emails, refunds, IATA compliance. Separate spec, separate compliance review.
- On-Time Performance + Flight Delay Prediction integration with existing `delayPredictionService`. Worth doing, but rejected from this iteration's scope.
- Pruning of `amadeus_cache` rows for IATA codes that fall out of the top-200 / top-100 windows. Not urgent — stale rows just sit. Optional `vacuum()` method can be added later.
- Migration of `amadeusService.js` callers (`flightController`, `mapController`, `aircraftSearchService`) to use `amadeusClient.getClient()` shared instance. Refactor done as part of step 1 (shared client) is the minimum; the existing live-search behavior must remain bit-identical.

## Success criteria

1. With prod Amadeus creds set, `GET /airport/jfk` and `GET /airline/ba` return 200 with baked SEO content (verifiable via `grep data-seo-bake`).
2. `sitemap.xml` contains the new URL families.
3. After 24h of running, `amadeus_budget.calls` for that day ≤ `AMADEUS_DAILY_BUDGET_CALLS`.
4. After warm completes, ≥80% of enumerated (endpoint, key) pairs have fresh rows in `amadeus_cache`.
5. Cluster invariant holds: only `NODE_APP_INSTANCE=0` worker increments `amadeus_budget.calls` (verifiable via log line `[amadeus-analytics] leader=true fetched N`).
6. Existing live-search paths (`/api/flights`, by-aircraft search, map endpoints) behave identically — no regressions in `flights.test.js` / `health.test.js` integration suites.
7. Zero increase in 5xx rate during 24h post-deploy window (per existing deploy health gate).

## Risks

- **Top-airport / top-airline DB queries.** `observed_routes` schema may not have an `airline_iata` column; verification needed during implementation. If absent, airlines are sourced from `aircraftPillarService` aggregation instead — acceptable detour, design supports both.
- **Amadeus pricing schedule.** $0.0005/call is a self-service tier estimate. Real per-call cost should be verified in Amadeus dashboard before merging; the budget guard (`AMADEUS_DAILY_BUDGET_CALLS`) is the hard cap regardless.
- **Test environment data quality.** If `AMADEUS_ENV` is left as `test` accidentally, analytics endpoints return tiny / empty payloads. The smoke gate before merge catches this; the warm log line includes the configured hostname.
- **Sitemap size pressure.** Adding ~300 new URLs nudges sitemap toward Google's 50K-URL ceiling, but current count is well below — no risk in this iteration. Reconsider when total enumerated URLs cross 30K.
