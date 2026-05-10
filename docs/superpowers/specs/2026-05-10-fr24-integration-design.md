# FlightRadar24 API Integration — Design Spec

**Date:** 2026-05-10
**Author:** Denys (with Claude as collaborator)
**Status:** Approved scope; ready for implementation plan

## Goal

Enrich variant pages (`/aircraft/{family}/variants/{variant}`) and family pages (`/aircraft/{family}`) with derived flight-activity facts from the Flightradar24 API. Three derived facts per page: total flights + unique operators (last 12 months), top 5 operators by frequency, top 5 routes worldwide.

This is the first FR24 use case — top-routes enrichment on `/routes/{a}-{b}` pages is explicitly out of scope and deferred to a future spec.

## Non-Goals

- No backfill of `observed_routes` or any historical route store from FR24 — would violate the 30-day storage rule.
- No replacement of existing live ADS-B sources (adsbl.ol, OpenSky, Mictronics) — those are live use cases with no historical depth requirement.
- No track-geometry rendering or per-flight pages — too expensive in credits and too close to raw redistribution.
- No top-routes enrichment in this MVP.
- No mobile/Capacitor changes.

## Constraints

### Legal/TOS — the dominant constraint

FR24 storage rule (https://fr24api.flightradar24.com/docs/storage-rules):
> All data accumulated from the FR24 API should not be stored for more than 30 days from the date it was first received. After this period, all stored data must be permanently deleted.

Our compliance posture:
- Raw FR24 responses live in RAM only, inside `fr24Service.js`, for the duration of one fetch (a few ms). Never written to disk, never returned outside the module.
- Derived facts (counts, top-N lists) live in an in-memory cache for ≤ 7 days TTL — well under 30 days.
- Derived facts get baked into HTML by `seoContentCache.warm()` (every 6 hours). Each baked HTML carries a datestamp ("Data via Flightradar24, as of YYYY-MM-DD") so the fact is anchored to a moment in time, not presented as eternal.
- HTML is overwritten every 6h warm cycle, so derived data never persists in our cache > 6 hours before being refreshed or removed.
- We do NOT build a queryable archive of FR24 data. No SQLite tables, no JSON files on disk, nothing reconstructable into raw responses.

### Subscription tier

Sandbox key in use during development (returns mock canary data: `record_count: 1234`, one SAS1415/A20N/ESSA-EKCH record regardless of filters). Production tier: Explorer ($9/mo, 30k credits, 30 days history, 10 req/min) — sufficient with 27× headroom for projected ~800 credits/month burn.

### Architectural

- `seoMetaService.resolve()` must remain synchronous — it's called per-URL inside `cache.warm()` loop and from `spaFallback` request path.
- Builders must remain synchronous and side-effect-free given a `meta` object.
- Bake/serve must never fail because FR24 is down or unconfigured.

## Architecture

### File structure

**Create:**
- `server/src/services/fr24Service.js` — low-level FR24 client. Auth, throttling, two public methods. Raw responses contained inside.
- `server/src/services/fr24CacheService.js` — sidecar in-memory `Map<key, derivedFacts>` with TTL. Refresh orchestrator.
- `server/src/__tests__/fr24Service.test.js` — unit tests with mocked axios.
- `server/src/__tests__/fr24CacheService.test.js` — unit tests for TTL/refresh/get logic.
- `server/src/__tests__/fr24Integration.test.js` — opt-in integration tests, skipped unless `FR24_API_KEY` is set in the env.

**Modify:**
- `server/src/services/seoMetaService.js` — `aircraftMeta(slug)` and `aircraftVariantMeta(family, variant)` read `fr24CacheService.get(...)` and attach `meta.fr24Stats` (or null).
- `server/src/services/seoContentBuilders.js` — new `_renderFr24Stats(stats)` helper. `bAircraft` and `bAircraftVariant` invoke it inside their section array.
- `server/src/services/seoContentCache.js` — `warm()` invokes `fr24CacheService.refresh()` if stale, before the resolve loop.
- `server/src/__tests__/seoContentBuilders.test.js` — extend with FR24 rendering tests.
- `server/src/__tests__/seoMetaService.variant.test.js` — extend with `fr24Stats` enrichment tests.
- `server/src/__tests__/index.spaFallback.integration.test.js` — extend with one E2E test that pre-seeds `fr24CacheService` and asserts baked HTML includes the FR24 section.

### Boundaries

- `fr24Service` knows FR24 endpoints, auth, throttling, derivation logic. Knows nothing about resolver/builder/cache.
- `fr24CacheService` knows in-memory storage + TTL + refresh orchestration. Knows nothing about FR24 endpoints — gets derived facts from `fr24Service` via injection.
- `seoMetaService` and builders know about `fr24CacheService.get(key)` only. No knowledge of FR24 internals.

### Env

- `FR24_API_KEY` — Bearer token. Stored in `.env` only (gitignored). Never committed to spec, plan, or any source file.
- If absent: `fr24Service.isEnabled()` returns false. `refresh()` is a no-op (logs once: `[fr24] disabled (no API key)`). `cache.get()` always returns null. Builders skip the FR24 section. Bake and serve work normally without FR24 content.

## Component contracts

### `fr24Service.js`

```js
isEnabled(): boolean
fetchVariantStats(icao: string, opts?: { windowDays?: number }): Promise<DerivedStats | null>
fetchFamilyStats(icaoList: string[], opts?: { windowDays?: number }): Promise<DerivedStats | null>
```

`DerivedStats` shape:

```js
{
  totalFlights: number,           // record_count from /flight-summary/count
  uniqueOperators: number,        // unique operating_as count from /light response
  topOperators: Array<{ icao: string, count: number }>,  // top 5 by count, desc
  topRoutes: Array<{ from: string, to: string, count: number }>,  // top 5 by count, desc
  windowDays: number,             // 365 default
  fetchedAt: number,              // Date.now() — for TTL + datestamp in HTML
}
```

### `fr24CacheService.js`

```js
get(key: string): DerivedStats | null
isStale(): boolean                // true if oldest entry > TTL_MS or cache empty
refresh(): Promise<{ refreshed: number, skipped: number, failed: number }>
clear(): void                     // for tests only
stats(): { keys: number, oldestFetchedAt: number | null, newestFetchedAt: number | null }

const TTL_MS = 7 * 24 * 60 * 60 * 1000;  // 7 days
```

Key format: `variant:${icao}` for variants, `family:${familySlug}` for families.

### `seoMetaService.js` enrichment

`aircraftMeta(slug)` and `aircraftVariantMeta(family, variant)` add to their return:

```js
fr24Stats: _safeFr24((c) => c.get(`family:${slug}`))   // or `variant:${variant.icao}`
```

Where `_safeFr24` is a try/catch wrapper following the same pattern as `_safeDb` already in this file. Returns `null` if `fr24CacheService` throws or returns nothing.

### `seoContentBuilders.js` rendering

```js
function _renderFr24Stats(stats) {
  if (!stats || !stats.totalFlights) return '';
  const date = new Date(stats.fetchedAt).toISOString().slice(0, 10);
  // ... renders HTML below
}
```

HTML (subject to copy refinement during implementation):

```html
<h3>Worldwide activity (last 12 months)</h3>
<p>Operated <strong>47,200</strong> times globally by 84 airlines.</p>
<p>Top operators: ANA (3,200), United (2,800), JAL (2,100), British Airways (1,900), Etihad (1,700)</p>
<p>Top routes: NRT–LAX (340), SIN–LHR (280), DXB–JFK (250), LHR–SIN (240), HND–LAX (220)</p>
<p class="data-source">Data via Flightradar24, as of 2026-05-10.</p>
```

Numeric formatting: thousands separator. `esc()` applied to all dynamic values (operator ICAO, airport ICAO, counts).

## FR24 endpoint usage

Two endpoints per cache key:

```
GET /api/flight-summary/count
   ?flight_datetime_from=YYYY-MM-DD HH:MM:SS
   &flight_datetime_to=YYYY-MM-DD HH:MM:SS
   &aircraft=<comma-separated ICAO type codes, max 15>
Headers:
   Authorization: Bearer <key>
   Accept-Version: v1
   Accept: application/json
Returns: { data: [{ record_count: N }] }

GET /api/flight-summary/light
   <same filters>
   &limit=20000
   &sort=desc
Returns: { data: [{ fr24_id, operating_as, orig_icao, dest_icao, ... }] }
```

Window: rolling 365 days, computed at refresh time.

Fields consumed from light response: `operating_as`, `orig_icao`, `dest_icao`. All other fields are ignored and not propagated past `fr24Service`.

Family ICAO lists capped at 15 (FR24 max). If a family has > 15 codes, take the first 15 in declaration order and log warn.

## Cost projection

Per-query credit cost on Explorer tier (historical, > 30 days from query time):
- `/flight-summary/light`: 3 credits/query
- `/flight-summary/count`: 15% of full = ⌈0.15 × 6⌉ = 1 credit/query

| Per refresh (every 7 days) | Queries | Credits |
|---|---|---|
| 30 variants × (1 count @ 1 + 1 light @ 3) | 60 | 120 |
| 20 families × (1 count @ 1 + 1 light @ 3) | 40 | 80 |
| **Subtotal per refresh** | **100** | **200** |
| Refreshes per month (~4) | 400 | **~800** |

Explorer tier headroom: 30,000 credits/mo → **~37× margin**. Plenty of room to add top-routes enrichment in a future iteration.

## Data flow

### Warm cycle (every 6h, plus startup)

1. `seoContentCache.warm()` checks `fr24CacheService.isStale()`.
2. If stale, awaits `fr24CacheService.refresh()`. Refresh iterates variants + families, throttled internally to 8 req/min (under the 10/min Explorer limit), skips any key whose `fetchedAt` is within `TTL_MS / 2`. Per-key failures don't halt the loop.
3. After refresh completes (or immediately if not stale), `warm()` runs the existing resolve loop. `aircraftMeta` / `aircraftVariantMeta` synchronously read `fr24CacheService.get(...)` and pass `meta.fr24Stats` to builders.
4. Builders render the FR24 section if stats exist and `totalFlights > 0`; skip otherwise.

### Request path

`GET /aircraft/boeing-787` → `spaFallback` → `resolve(url)` → `aircraftMeta('boeing-787')` reads `fr24CacheService.get('family:boeing-787')` → meta with `fr24Stats` → `build(meta)` → `bAircraft` invokes `_renderFr24Stats` → HTML injected into `#root` of index.html → returned.

### Cold start

After pm2 reload, `fr24CacheService` Map is empty. First `cache.warm()` (in `setImmediate` after `app.listen()`) detects stale state, fires refresh (~12 minutes), populates cache. During those minutes, baked HTML lacks FR24 sections — graceful degradation, accepted as a 6-hour transitional window.

## Error handling

| Layer | Failure mode | Behavior |
|---|---|---|
| `fr24Service` | No API key | `isEnabled()` returns false; fetchers return null without HTTP. |
| `fr24Service` | 401/403 | Catch, log warn (`[fr24] auth error: 401 — check FR24_API_KEY`), return null. |
| `fr24Service` | 429 | Backoff (250ms→500ms), one retry, return null on second 429. |
| `fr24Service` | 5xx, timeout, network error | One retry with backoff, return null on failure. |
| `fr24Service` | Malformed/missing `data` field | Return null. |
| `fr24Service` | Empty `data: []` | Return derived with all zeros — valid result, will be cached. Builders detect `totalFlights === 0` and skip the section. |
| `fr24CacheService.refresh` | Per-key failure from `fr24Service` | Log, increment `failed` counter, continue with next key. Never halts. |
| `seoMetaService` | `fr24CacheService.get` throws | `_safeFr24` swallows, returns null. Bake never breaks. |
| Builders | `meta.fr24Stats === null` or `totalFlights === 0` | `_renderFr24Stats` returns `''`. Section absent from HTML. |

Logs use `console.log`/`console.warn` — same surface as existing services. No raw response content in logs (privacy).

## Testing strategy

### Unit tests (jest, mocked axios)

`fr24Service.test.js`:
- `isEnabled()` true/false based on env
- Disabled service returns null without HTTP
- 200 OK with mocked light + count payloads → derived shape correct
- Top operators groups + sorts (test with skewed mock distribution)
- Top routes groups by `orig_icao + dest_icao`
- Family fetch: comma-separated ICAO list assembled correctly in URL
- Family ICAO list > 15: first 15 used, warn logged
- 401 → null + warn
- 429 → retry once → null on second 429
- 5xx → retry once → null
- Timeout → null
- Malformed response → null
- Empty `data: []` → derived with zeros (valid)

`fr24CacheService.test.js`:
- `get('unknown')` → null
- `set` + `get` round-trip
- `isStale()` true when empty, true when oldest > TTL, false otherwise
- `refresh()` skips keys fetched within TTL/2 (idempotent on double-warm)
- `refresh()` continues despite per-key failures
- `refresh()` returns correct counts
- `clear()` empties the Map
- `TTL_MS === 7 days` regression guard

`seoContentBuilders.test.js` (extend):
- `_renderFr24Stats(null)` → `''`
- `_renderFr24Stats({ totalFlights: 0, ... })` → `''`
- Populated stats render expected substrings (Worldwide activity, Operated N times, by N airlines, Top operators, Top routes, Data via Flightradar24, datestamp YYYY-MM-DD)
- XSS guard: malformed operator/route ICAO with `<script>` is escaped
- `bAircraft` and `bAircraftVariant` render the section when `meta.fr24Stats` set; not when null
- Existing tests still pass

`seoMetaService.variant.test.js` (extend):
- Both metas return `fr24Stats: null` when cache empty
- Both metas return `fr24Stats: <derived>` after `fr24CacheService.set`

### Integration tests

`fr24Integration.test.js` (opt-in, skipped unless `process.env.FR24_API_KEY`):
- Real `/count` for B789 → response shape valid (data array, record_count is number)
- Real `/light?limit=5` → response shape valid (data array of objects with operating_as/orig_icao/dest_icao)
- Sandbox returns mock canary data — assertions check shape, not specific values

`index.spaFallback.integration.test.js` (extend):
- Pre-seed `fr24CacheService` with mock derived stats for `boeing-787` family
- `GET /aircraft/boeing-787` → assert HTML includes `Worldwide activity` + `Top operators:` + datestamp pattern
- `GET /aircraft/boeing-787` without pre-seed → assert HTML does NOT include `Worldwide activity` (graceful degrade)

### What we don't test

- Real credit consumption (not API-observable).
- Real rate limit behaviour (sandbox limits unknown, CI risk).
- Refresh cycle wall-clock performance.

### Coverage targets

- `fr24Service.js`: 100% line coverage (all error branches mocked).
- `fr24CacheService.js`: 100% line coverage.
- `_renderFr24Stats`: 100% (null + zero + populated paths).

Expected delta: +25-30 unit tests + 2-3 integration tests. Baseline 542 → ~570 after feature.

## Rollout

1. Land code on a worktree branch following the standard subagent-driven flow (spec → plan → tasks → review → merge).
2. With sandbox `FR24_API_KEY` in `.env` locally, verify cache populates and HTML bakes the FR24 section. Sandbox gives canary `record_count: 1234` and one SAS row — assert presence of section, not specific real numbers.
3. Before deploy, swap `.env` to Explorer-tier production key.
4. Push to origin/main → pm2 reload + cache.warm. First warm completes baseline HTML in ~5s. FR24 refresh runs in background ~12 minutes.
5. After refresh, next warm cycle (≤ 6h later) bakes FR24 sections into all aircraft + variant HTML.
6. Verify on prod: `curl -s -A 'Googlebot' https://himaxym.com/aircraft/boeing-787 | grep -c 'Worldwide activity'` should return 1 within 6 hours of deploy.

## Open considerations (non-blocking)

- **Variant icao stats vs aggregate fleet stats:** spec uses `aircraft=<single ICAO>` for variant page. If we want "this variant + its sub-codes" later (e.g., 787-9 includes B789 only), confirmed simple. If a future variant has multiple ICAO codes, `fetchVariantStats` accepts a list — currently just wraps single-code.
- **Number formatting:** "47,200" comma format (en-US). If we later add i18n, this becomes a copy concern, not architectural.
- **Top-routes enrichment** for `/routes/{a}-{b}` — explicitly deferred. Same architecture would extend cleanly: add `fetchRouteStats(orig, dest)` to `fr24Service`, `route:${orig}-${dest}` keyspace in cache, enrich `routeMeta` similarly.
- **TOS clarification with FR24 sales:** before going beyond Explorer tier, write to FR24 support describing our use case (derived aggregations, ≤7 day RAM cache, 6h HTML refresh, no raw archive) and get written confirmation. Not blocking for MVP launch on Explorer.
