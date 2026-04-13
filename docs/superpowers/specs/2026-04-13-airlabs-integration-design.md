# AirLabs Integration Design

**Date:** 2026-04-13  
**Status:** Approved

## Problem

The route map currently relies on three sources:
- **OpenSky** — only 12h lookback window, returns 1–3 routes per airport (ADS-B gaps)
- **Wikidata** — effectively 0 routes in database, dead source
- **routes.dat** (OpenFlights, 2017) — stale historical data, misleading to users

Aircraft and airline enrichment in flight search is coded but inactive (`airlabsService.js` exists, `AIRLABS_API_KEY` not set).

Amadeus is shutting down free/self-service access — no new production keys available.

## Solution

Activate AirLabs ($19/month) as the primary data source for:
1. **Route map** — replace routes.dat + Wikidata with AirLabs `/routes` (current scheduled routes)
2. **Aircraft enrichment** — activate existing `airlabsService.getAircraftInfo()` code
3. **Airline enrichment** — activate existing `airlabsService.getAirlineInfo()` code

Keep **OpenSky** as a live supplement: destinations seen departing in the last 12h get the `live` tier (green) on top of AirLabs scheduled routes.

## Architecture

### Confidence Tiers (simplified from 3 to 2)

| Tier | Source | Colour | Meaning |
|---|---|---|---|
| `live` | OpenSky (12h window) | Green | Confirmed departure in last 12h |
| `scheduled` | AirLabs `/routes` | Blue | Current scheduled airline route |

No more `historical` tier. If AirLabs has no data for an airport, the map shows an empty state with a clear message — not stale 2017 routes.

### Server Changes

#### `server/src/services/airlabsService.js` — add `getRoutes(iata)`
New function alongside existing `getAircraftInfo` / `getAirlineInfo`:
```
GET https://airlabs.co/api/v9/routes?dep_iata={IATA}&api_key={KEY}
```
- Returns `Set<arr_iata>` of direct destinations
- In-memory cache: 24h TTL (airline schedules change at most weekly)
- Graceful empty return on 401/429/network error — never throws

#### `server/src/services/routesService.js` — replace sources
Remove: `wikidataService`, `openFlights.getDirectDestinations()`  
Add: `airlabsService.getRoutes(iata)`

Merge logic:
1. Fetch OpenSky departures (12h) → Map `destIata → lastSeen`
2. Fetch AirLabs routes → Set of scheduled destinations
3. Union of both sets as `destinations[]`
4. Confidence: if in OpenSky map → `live`; else → `scheduled`

If AirLabs returns empty and OpenSky returns empty → return `{ destinations: [], confidences: {} }` (client shows "No routes found").

#### `server/src/services/openFlightsService.js` — remove routes.dat
- Delete `routesMap` and all routes.dat parsing code (lines ~60–80)
- Delete `exports.getDirectDestinations()`
- Keep everything else: airport lookup, airline lookup, ICAO→IATA map

#### Dead code to delete
| File | Reason |
|---|---|
| `server/src/services/wikidataService.js` | Zero data, replaced by AirLabs |
| `server/src/data/wikidata-routes.json` | Empty stub |
| `server/src/data/routes.dat` | Stale 2017 data, replaced by AirLabs |
| `scripts/refresh-wikidata-routes.js` | No longer needed |
| `.github/workflows/wikidata-routes-refresh.yml` | No longer needed |

#### Environment / Secrets
- Add `AIRLABS_API_KEY` to `server/.env` (local)
- Add `AIRLABS_API_KEY` to GitHub Secrets (production deploy)
- Update `deploy.yml`: add `AIRLABS_API_KEY` to `env:` block and `sed -i '/^AIRLABS_/d'` + `echo` pattern in deploy script (same pattern already used for `OPENSKY_`)

### Client Changes

#### `client/src/components/RouteMap.jsx`
- Remove `showHistorical` state and `showHistoricalRef`
- Remove "Hide/Show historical" toggle button
- Remove auto-enable historical logic in `loadRoutes`
- Remove redraw-on-showHistorical `useEffect`
- `ARC_STYLE`: keep only `scheduled` (blue `rgba(99,140,200,0.55)`) and `live` (green `rgba(52,211,153,0.85)`)
- Arc drawing loop: all routes draw unconditionally (no tier filtering needed)
- Hint text: remove "historical" references
- Legend: 2 rows — Scheduled / Live

#### `client/src/components/RouteMap.css`
- Remove `.rm-legend-dot--historical` rule

## What Is Not Changing

- **Duffel** flight search and booking — untouched
- **OpenSky service** (`openSkyService.js`) — untouched, stays as live supplement
- **Explore destinations** and **Aircraft search stream** — currently non-functional without Amadeus prod key, left for a separate design session
- **ValidityCalendar** — already returns graceful empty state when Amadeus absent

## Error Handling

| Scenario | Behaviour |
|---|---|
| `AIRLABS_API_KEY` not set | Warn on startup; routes endpoint returns empty destinations with no error thrown |
| AirLabs 429 rate-limit | Return stale cache if available; else empty destinations |
| AirLabs 401 | Log warning, return empty — do not expose to client |
| OpenSky 403 | Already handled — falls through to scheduled-only, no live tier |
| Both sources empty | `{ destinations: [], confidences: {} }` — client shows "No routes found for this airport" |

## Testing

- Unit: `airlabsService.getRoutes()` — mocked axios, verifies cache hit/miss, 401 graceful return
- Unit: `routesService.getRoutes()` — stubs both AirLabs and OpenSky, verifies merge logic and correct tier assignment
- Manual: set `AIRLABS_API_KEY`, click LHR on route map → blue scheduled arcs appear; live green arcs appear where OpenSky has data
