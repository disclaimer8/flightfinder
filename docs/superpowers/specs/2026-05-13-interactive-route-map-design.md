# Interactive Route Map (/map) — Design

## Goal

Replace the current `/map` stub (which renders `<Home />`) with a real interactive Leaflet map that shows observed flight routes worldwide, with airline and aircraft filters. Clicking a route deep-links to `/search?from=DEP&to=ARR`.

## Background

`/map` is in the primary site navigation but currently renders the homepage. SEO title says "Interactive Flight Route Map — FlightFinder", which is misleading. The `observed_routes` table on prod has 4,517 rows over 90 days (3,468 unique dep-arr pairs, 399 airlines, 43 aircraft ICAO types). Airport coordinates are available in-process via `openFlightsService.getAirport(iata)`. Existing Leaflet integration in `SafetyGlobalMap.jsx` (157 LOC) is the styling/wiring template.

## Architecture

React page at `/map` lazy-loads a Leaflet route layer. One server endpoint streams aggregated route rows (airport-coord-joined). Filters are URL-persistent, two single-select typeaheads (airline / aircraft). Canvas-rendered polylines so 3,500 lines stay smooth.

## Data flow

1. Client mounts `Map.jsx`, reads `airline` + `aircraft` from URL search params.
2. Client fetches `GET /api/map/routes?airline=BA&aircraft=A320` (omitted params = no filter). Filter options come from a separate `GET /api/map/filters`.
3. Server queries `observed_routes`:
   ```sql
   SELECT dep_iata, arr_iata, airline_iata, aircraft_icao
   FROM observed_routes
   WHERE seen_at > ?  -- now - 90d
     AND (?airline IS NULL OR airline_iata = ?airline)
     AND (?aircraft IS NULL OR aircraft_icao = ?aircraft)
   ```
4. In JS, groups rows by `(dep_iata, arr_iata)`, joins `openFlightsService.getAirport(iata)` for both ends. Rows where either side is missing coords are dropped (logged).
5. Returns:
   ```json
   {
     "routes": [
       {
         "dep": {"iata":"LHR","lat":51.47,"lon":-0.46,"city":"London"},
         "arr": {"iata":"JFK","lat":40.64,"lon":-73.78,"city":"New York"},
         "airline_count": 8,
         "aircraft_count": 3,
         "last_seen_at": 1747000000000
       }
     ]
   }
   ```
6. Client renders one `L.polyline` per route on a canvas renderer. Click → `navigate('/search?from=DEP&to=ARR')`. Hover → `L.tooltip` with route summary.

## Components

### Client (new)

- `client/src/pages/Map.jsx` (REPLACE) — page shell, filter row, lazy `<RouteMapLayer>`, URL sync.
- `client/src/pages/map/RouteMapLayer.jsx` — Leaflet container with `preferCanvas:true`, renders polylines.
- `client/src/pages/map/RouteMapFilters.jsx` — two typeahead comboboxes (airline / aircraft).
- `client/src/pages/map/mapApi.js` — fetch helpers, promise-cache pattern from `safetyApi.js`.

### Server (new)

- `server/src/routes/map.js` — mounts `/api/map/*` router.
- `server/src/controllers/mapRoutesController.js` — request handlers, cache wiring.
- `server/src/models/observedRoutes.js` (MODIFY) — add `aggregateForMap({airline, aircraft, sinceMs})`.

## Interactions

- **Click polyline**: `navigate('/search?from=DEP&to=ARR')`. No date prefilled.
- **Hover polyline**: tooltip text =
  - No filter: `"LHR → JFK · 8 airlines · 3 aircraft types"`
  - Filter active: `"LHR → JFK · British Airways · A380"`
- **Hover visual**: weight `1.5 → 4`, opacity `0.15 → 0.9`.
- **Default render**: every route at opacity `0.15`, weight `1.5`. World view zoom level ~2.
- **Filtered render**: non-matching routes not sent by server (no client-side dimming).

## API contract

### `GET /api/map/routes`

Query params (all optional):
- `airline` — IATA code (e.g. `BA`). Case-insensitive.
- `aircraft` — ICAO type code (e.g. `A320`). Case-insensitive.

Response: `{ routes: [...] }` as shown above. 5-min server cache keyed on filter combo. Returns 200 with `routes: []` on no match.

### `GET /api/map/filters`

Response:
```json
{
  "airlines": [{"iata":"BA","name":"British Airways","count":312}, ...],
  "aircraft": [{"icao":"A320","label":"Airbus A320","count":987}, ...]
}
```
- Airlines: top 200 by row count (covers >99% of routes; tail is operator-of-record noise).
- Aircraft: all 43 (small set, no truncation).
- Same 5-min cache.

## Performance & edge cases

- Leaflet `preferCanvas: true` so polylines render to one canvas, not 3,500 SVG nodes.
- IATA → coord lookups that miss (~2% per past spot-checks) are silently dropped server-side; backend logs total drop count once per request.
- **Antimeridian**: when `|dep.lon − arr.lon| > 180`, add `±360` to the further endpoint so Leaflet draws the shorter geodesic. Client-side fix in `RouteMapLayer.jsx`.
- Loading state: skeleton over map area while routes fetch is in flight.
- Empty state: thin banner `"No routes match these filters — try clearing one"`.
- Debounce filter typeahead 200ms before refetch.

## SEO

- `seoMetaService.js` already has a `/map` entry. Extend:
  - Default (`/map`): title "Interactive Flight Route Map — FlightFinder", description "Explore flight routes worldwide by airline or aircraft type."
  - With filters (`/map?airline=BA&aircraft=A380`): title "British Airways A380 route map · FlightFinder", desc "All routes flown by British Airways on the Airbus A380 in the last 90 days."
- `noindex` for `/map?...` combos (combinatorial URL space). Whitelist a few popular ones in a follow-up plan.

## Testing

- **Server unit**:
  - `observedRoutes.aggregateForMap.test.js` — 4 cases: no filters, airline-only, aircraft-only, both. Mock airports map; verify coord-miss rows drop.
  - `mapRoutesController.test.js` — endpoint smoke: 200 with empty filters, 200 with each filter combo, cache header set.
- **Client**: `Map.test.jsx` — page mounts, fetches once, renders Filter row + lazy-loaded layer shell. (Leaflet itself is mocked.)
- **Manual**: post-deploy hit `/map`, search "Lufthansa" → only LH routes visible.

## Out of scope (v1)

- Airport markers (only polylines).
- Time-window slider (fixed 90d).
- All-time toggle.
- Route-thickness scaled by frequency (uniform thickness).
- Mobile-specific perf optimizations (canvas should suffice).
- Whitelisted SEO-indexable filter combos (v2).
- Multi-select filters.

## Reversibility

The `Map.jsx` stub stays alive as a one-commit revert target. The new files are additive (no schema changes, no destructive migrations). All endpoints are new under `/api/map/*` — no existing API contracts touched.
