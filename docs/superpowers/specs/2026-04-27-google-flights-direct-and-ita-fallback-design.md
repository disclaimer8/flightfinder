# Google Flights direct + ITA Matrix fallback — Design

**Date:** 2026-04-27
**Status:** Draft for user review
**Owner:** denyskolomiiets

## Problem

Production live flight search is currently broken. `amadeusService.js` exists but Amadeus Self-Service is closed (no credentials). `duffelService.js` works but coverage is too narrow (NDC contracts only, no LCC). Real-time price data falls through to `travelpayouts` (cached affiliate prices, not source-of-truth). The commercial flight-API landscape has no open self-service options — Amadeus, Kiwi Tequila, and Skyscanner B2B are all closed to new developers.

The pragmatic remaining path is the Google Flights data channel. SerpApi is the paid option with a US legal shield; this design is the **free** alternative — direct undocumented-API access with a diversified fallback to ITA Matrix.

## Goals

- Restore working live flight search at zero per-request cost.
- Two independent free sources with **uncorrelated failure modes** so a single Google schema change does not take search offline.
- Drop-in replacement for the existing `flightController` flow — frontend contract unchanged.
- Schema-break detection in CI so we know about breakage before users do.

## Non-goals

- Booking flow integration (stays on existing `duffelService`).
- Removing `amadeusService.js` or `travelpayoutsService` — they remain (Amadeus dormant, travelpayouts as final fallback for prices).
- Paid sources (SerpApi, Apify) — explicitly excluded for this iteration.
- Custom Go scraping code — use `gilby125/google-flights-api` upstream as-is via its built-in HTTP server.

## Architecture

### High-level

```
Express (5001) ── orchestrator ──┬─► googleFlightsService ──► Go sidecar (5002) ──► Google Flights internal API
                                 │                                  (gilby125/google-flights-api web server)
                                 ├─► itaMatrixService    ──► matrix.itasoftware.com/xhr/shop/search
                                 ├─► travelpayoutsService (existing)
                                 └─► cacheService (node-cache, 6h TTL)
```

### New components

| File | Responsibility |
|---|---|
| `server/src/services/googleFlightsService.js` | HTTP client to local Go sidecar; parse + normalize response; emit `null` on failure |
| `server/src/services/itaMatrixService.js` | Direct HTTP POST to `matrix.itasoftware.com/xhr/shop/search`; parse JSON → normalize; emit `null` on failure |
| `server/src/services/flightSearchOrchestrator.js` | Cache check → google → ita → travelpayouts → stale-cache → empty. Single owner of fallback logic |
| `bin/google-flights-server` | Compiled Go binary (built in CI from gilby125 upstream); deployed to `/opt/flight/bin/` on VPS |

### Modified components

- `server/src/controllers/flightController.js` — replace inline `if (hasAmadeus) ... else if (hasDuffel) ...` with `orchestrator.search(params)`. ~80 LOC moves out.
- `ecosystem.config.js` — add second PM2 process `google-flights-sidecar` on port 5002, `max_memory_restart: '300M'`.
- `.github/workflows/deploy.yml` — add `Build Go sidecar` step before rsync (clone gilby125, `go build`, copy binary).

### Unchanged

- `amadeusService.js`, `duffelService.js` — left in place. Duffel stays in booking flow.
- `nginx` config — sidecar is `127.0.0.1:5002` only, never exposed.
- Frontend — orchestrator returns the same normalized shape the controller produces today.

## Data flow

### Happy path

```
1. GET /api/flights?departure=LIS&arrival=JFK&date=2026-06-01
2. orchestrator.search(params)
3. cache.get(key) → MISS
4. googleFlightsService.search(params)
   axios.get('http://127.0.0.1:5002/api/v1/flights/search', { timeout: 8000 })
5. Go sidecar → Google internal API → JSON
6. parse + normalize → NormalizedFlight[]
7. cache.set(key, results, 21600)  // 6h
8. controller → res.json(results)
```

### Failure cascade

```
google fails (5xx | timeout | empty | 429-captcha)
   → ita.search(params)
   → on failure: travelpayouts.search(params)
   → on failure: cache.getStale(key)  // serve stale rather than empty
   → on failure: { flights: [], source: 'none' }  (200, not 500)
```

## Normalized output schema

All three sources emit this shape. Frontend already consumes a near-identical structure from existing Amadeus/Duffel code path — actual field names verified against `flightController` parser before implementation.

```js
{
  id: string,                    // hash(source + offer-id)
  source: 'google' | 'ita' | 'travelpayouts',
  price: { amount: number, currency: 'EUR'|'USD' },
  legs: [{
    departure: { iata: string, datetime: ISO8601 },
    arrival:   { iata: string, datetime: ISO8601 },
    durationMin: number,
    carrier: string,             // IATA code
    flightNumber: string,
    aircraft: { icao: string|null, name: string|null },
    stops: number,
  }],
  totalDurationMin: number,
  bookingUrl: string|null,       // ITA does not provide → null
  co2Kg: number|null,            // Google only
}
```

## ITA Matrix endpoint research

`POST https://matrix.itasoftware.com/xhr/shop/search` is the known community endpoint. Payload format is non-trivial: URL-encoded JSON-array. Exact payload schema must be captured live before writing the parser.

**Research deliverable** (separate plan step before `itaMatrixService.js`):
- Open Chrome DevTools on `matrix.itasoftware.com`, perform LIS→JFK search.
- Capture full POST request (URL, headers, body).
- Save as fixture in `docs/superpowers/research/ita-matrix-payload.md` with annotated field map.
- Only after this artifact exists do we implement `itaMatrixService.js`.

## Error handling

| Condition | Source | Action |
|---|---|---|
| Sidecar `ECONNREFUSED` | google | Sentry breadcrumb (warn), fail-fast → ita |
| `200` with `flights: []` | google | Treat as failure → ita |
| HTTP `429` (Google captcha) | google | Sentry breadcrumb (warn), set 5-min cooldown on google source → ita |
| Timeout > 8s | any | Abort, advance to next source |
| HTTP 4xx/5xx | ita / travelpayouts | Sentry breadcrumb, advance |
| All sources empty | — | Return `{ flights: [] }` with HTTP 200 (not 500) |
| Sidecar process crash | google | PM2 auto-restarts; orchestrator falls through during downtime |

Sentry already configured per `project_sentry.md` — warn-level → breadcrumb, error-level (all sources down) → captured exception.

## Schema canary

Separate scheduled GitHub Actions workflow `.github/workflows/flight-canary.yml`:

- Runs every 6h via `schedule: cron`.
- Single fixed query (LIS→JFK, +30 days).
- Validates response shape: `legs[]`, `price.amount`, `carrier`.
- Failure → workflow fails → GitHub notification → Sentry alert.

Goal: detect Google Protobuf schema changes **before** users see broken results.

## Deployment

### `ecosystem.config.js` addition

```js
{
  name: 'google-flights-sidecar',
  script: '/opt/flight/bin/google-flights-server',
  env: { PORT: '5002', LOG_LEVEL: 'warn' },
  max_memory_restart: '300M',
  autorestart: true,
}
```

### `.github/workflows/deploy.yml` step (before existing rsync)

```yaml
- name: Build Go sidecar
  uses: actions/setup-go@v5
  with: { go-version: '1.22' }
- name: Compile gilby125 server
  run: |
    git clone --depth 1 https://github.com/gilby125/google-flights-api /tmp/gf
    cd /tmp/gf && go build -o google-flights-server ./cmd/server
    mkdir -p $GITHUB_WORKSPACE/server/bin
    cp google-flights-server $GITHUB_WORKSPACE/server/bin/
```

VPS receives binary via existing rsync (`server/bin/` must be included in the rsync include-list — verify in current `deploy.yml` and add if missing). PM2 picks up new binary on `pm2 reload`.

### `nginx`

Unchanged. Sidecar binds `127.0.0.1:5002` only.

## Testing

| Layer | Scope |
|---|---|
| Unit | `googleFlightsService.parse()` against captured Go-sidecar JSON fixture; `itaMatrixService.parse()` against captured ITA JSON fixture; `orchestrator` with mocked sources verifying fallback order and stale-cache behaviour |
| Integration | `flightController` end-to-end against locally-running Go sidecar, single LIS→JFK route |
| Canary (CI) | 6-hourly scheduled workflow against production endpoint validating schema |

Coverage target: orchestrator at 100% (it's the SLO-critical bit).

## Migration

- New env: `FLIGHT_API='google'` becomes default for the **search** path (orchestrator chain).
- The **booking** path (`flightController.createOrder` → `duffelService.createOrder`) is unaffected — Duffel remains the booking provider regardless of `FLIGHT_API`.
- Legacy `FLIGHT_API='amadeus'` and `'duffel'` values for search are no longer functional (Amadeus has no credentials; Duffel-as-search has too narrow coverage). They are removed from the search code path; setting them is treated as `'google'`.
- No frontend changes.
- `project_no_users_yet.md` — no grandfathering needed.

## Open questions / risks

1. **ITA Matrix endpoint may have changed.** Worst case: `itaMatrixService` becomes a Playwright-based scraper (~2h pivot). Plan accommodates this by isolating ITA behind the orchestrator interface.
2. **gilby125 sidecar reliability under captcha.** Mitigation: 5-min cooldown after `429`, fall through to ITA. Cookie persistence handled inside Go process.
3. **Google Protobuf schema breakage.** Mitigation: schema canary in CI + fallback to ITA. Acceptance: temporary degraded coverage during fix is OK.
4. **Go binary size.** ~15MB compiled — acceptable for rsync deploy.

## Out of scope (explicit)

- Adding SerpApi or any paid source.
- Replacing Duffel for booking flow.
- Removing dormant `amadeusService.js`.
- Frontend changes.
- Performance work beyond what the cache layer provides.

## Deferred — ITA Matrix live HTTP wire-up

The ITA Matrix parser ships fully tested. The live `search()` returns `null`,
so the orchestrator falls through to travelpayouts whenever Google is down.
Effectively a one-source live system today.

Wire-up requires:
- multipart/mixed `gapi-batch` body construction
- `bgProgramResponse` WAA token strategy (likely headless-browser warmup)
- additional fixture coverage (multi-slice round-trip, codeshare, direct, intra-region)

Trigger to revisit: when production telemetry shows Google failure rate
above ~5% on a sustained basis, OR when a parsable failure mode (Google
HTTP 429 / 403) becomes routine.
