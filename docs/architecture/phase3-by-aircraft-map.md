# Phase 3 — Map-as-output for by-aircraft search

## Problem

The by-aircraft search before Phase 3 worked as follows: user picks a family (e.g. "Airbus A340"), a city, and optionally a radius; the backend fans out Amadeus searches across nearby airports; the client renders a vertically scrolling list of flight cards. For AvGeek users this fails on two counts. First, the list doesn't tell you **where** the A340 flies — it only answers the narrow question "is there an A340 flight I can book between these two specific points right now?" Second, when nothing is found the user gets an empty-state card and no recovery path — no hint that LHR or FRA 200 km away regularly runs the aircraft. The interesting question ("where in the world is this jet still flying?") was lost in a UI tuned for booking.

## Solution at a glance

Phase 3 replaces the flight-card list with a world map. The user fills in the same form; the client resolves origins (either an exact IATA or a city + radius expanded to a set of nearby airports); a single backend call returns every `(dep, arr)` pair the family has been observed flying from those origins in the last 14 days; the map draws one geodesic arc per route, colour-coded by origin. Clicking an arc or a destination dot opens a side panel and kicks the existing SSE flight-search stream for that specific leg — so the booking path still exists but it's downstream of the discovery moment.

```
                              ┌──────────────────────────────────────┐
                              │  AircraftSearchForm                  │
                              │    familyName, city|iata, radius     │
                              └──────────────────────┬───────────────┘
                                                     │ onSearch(params)
                                                     ▼
                       ┌─────────────────────────────────────────────┐
                       │  App.handleAircraftSearch                   │
                       │    1. /api/aircraft/airports/search         │  resolve city → anchor
                       │    2. /api/map/radius?lat=…&lon=…&radius=N  │  fan out to IATAs
                       │    3. setAcView('map')                      │
                       └──────────────────────┬──────────────────────┘
                                              │ originIatas[]
                                              ▼
                       ┌─────────────────────────────────────────────┐
                       │  AircraftRouteMap                           │
                       │    GET /api/aircraft/routes                 │
                       │      family, origins (CSV), windowDays=14   │
                       │    → { origins, airports, routes,           │
                       │         suggestions }                       │
                       │    → canvas-arc render (geodesic, batched)  │
                       └──────────────────────┬──────────────────────┘
                                              │ user clicks an arc/dot
                                              ▼
                       ┌─────────────────────────────────────────────┐
                       │  DestinationPanel (side or bottom sheet)    │
                       │    useAircraftSearch() → SSE stream         │
                       │      /api/flights/aircraft-search/stream    │
                       │      ?familyName=…&iata=<dep>&date=…        │
                       │    filter results to arr === panel.arr      │
                       │    → real priced flight cards               │
                       └─────────────────────────────────────────────┘
```

## Data flow

The `observed_routes` table is the single source of truth for which `(dep, arr, aircraft_icao)` tuples have actually been seen in the last N days. Two workers write to it:

- **adsb.lol** — polls live ADS-B; when a callsign resolves to a route via `/routeset`, upserts a row. ~87% callsign hit rate on commercial transatlantic.
- **AirLabs scheduled** — fills rows for future flights that aren't currently airborne.

The row key is `(dep_iata, arr_iata, aircraft_icao)` and `seen_at` is updated on every re-observation, so a route naturally ages out of the `windowDays` filter when it stops flying.

Family-to-ICAO mapping lives in [server/src/models/aircraftFamilies.js](../../server/src/models/aircraftFamilies.js). The user-facing name and its `codes` set (a mix of IATA-ish short codes and 4-letter ICAO type designators) is defined once per family; the `/api/aircraft/routes` controller filters `fam.codes` down to just ICAO designators (`/^[A-Z][A-Z0-9]{3}$/`) because `observed_routes.aircraft_icao` stores only 4-char codes. Phase 3 added the A340 entry (was missing — blocked the Marek use-case) and the `resolveFamily(input)` helper which accepts either a slug (`a340`) or a display name (`Airbus A340`). `getFamilyList()` now ships each entry with its `slug` so the frontend never has to duplicate slug logic.

The response **embeds an `airports[]` dictionary** covering every IATA referenced in `origins[]` plus every distinct `dep`/`arr` in `routes[]`. The client uses this to render dots and look up arc endpoint coords without issuing a second roundtrip to `/api/map/airports`. For a 4-origin radius query returning ~50 routes, this is the difference between one network round trip and two.

## Client rendering strategy

Two `<canvas>` layers overlaid on a Leaflet tile map — one for arcs, one for dots/labels. Canvas rather than SVG because:

- a fully connected 4-origin radius query can easily push 80+ arcs × 60 geodesic steps = ~5000 line segments, which stutters SVG;
- batching — we collect all arcs by colour into buckets, then emit one `beginPath()`/`stroke()` per colour, cutting per-path overhead from O(routes) to O(colours);
- transform tracking — we translate the canvas element with `map.containerPointToLayerPoint([0, 0])` on every Leaflet pan/zoom event and redraw, which is cheap with a single drawing context.

Geodesic arcs use `geodesicPoints(lat1, lon1, lat2, lon2, 60)` in [client/src/components/mapArcHelpers.js](../../client/src/components/mapArcHelpers.js) — 60 intermediate points is enough for smooth great-circles at typical zoom levels, including long polar routes. AABB viewport culling happens inline in the draw loop: each projected path tracks its bounding box and the whole path is skipped if its AABB misses the canvas by more than 20 px. This is what keeps a zoomed-in European view from paying for transatlantic arcs that won't render.

Origin colours come from the 10-entry `ORIGIN_PALETTE` (see `mapArcHelpers.js`) — periwinkle, emerald, pink, amber, violet, orange, cyan, coral, green, fuchsia. All chosen for contrast against the dark `#0d0d1a` basemap. Arcs inherit their colour from their `dep` airport (each origin gets one palette slot, cycled `i % 10`). When the user clicks a legend entry to filter to a single origin, all other-origin arcs get `globalAlpha = 0.12` and `lineWidth = 1` (vs `0.85` / `1.8` for bright) and the buckets are drawn dimmed-first so the active colour paints on top.

## Multi-origin handling

The form emits one of three shapes:

- `{ iata }` — single exact origin. Skip radius expansion.
- `{ iata, radius }` — exact IATA with a radius ring. Resolve `iata` to lat/lon via `/api/aircraft/airports/search?q=<iata>&limit=1`, then fan out via `/api/map/radius?lat=…&lon=…&radius=N` to get the full IATA set.
- `{ city, radius }` — free-text city. Resolve city to airport coords via `/api/aircraft/airports/search?q=<city>&limit=1`, then the same radius fan-out.

See [client/src/App.jsx](../../client/src/App.jsx) — `handleAircraftSearch`. The resolved `originIatas[]` is passed as a prop to `AircraftRouteMap`, which CSV-joins it into the `origins` query parameter to `/api/aircraft/routes` (capped at 10 — the validator hard-rejects larger sets). Every origin in the response gets its own palette colour, and each route in `routes[]` is coloured by its `dep` — so a radius view around Prague with 6 airports shows 6 colour bands, and the user can see at a glance which hub drives which destinations.

## Empty-state fallback

Done server-side so the client gets a single response to render from. When `routes[].length === 0` the controller runs `geocodingService.nearbyAirports(lat, lon, 1000, 30)` for each origin, collects up to 25 candidate IATAs, scores each one with `db.countFamilyRoutesFromOrigin()`, and returns the top 5 by `routeCount desc, distanceKm asc` as `suggestions[]`. Doing this server-side means the client doesn't have to chain a second request, the chips render with accurate `routeCount` labels, and the candidate scan is bounded (≤25 lookups even for dense origin sets).

On the client, each chip dispatches a `window.CustomEvent('arm-swap-origin', { detail: { iata } })`. `App.jsx` listens for this event and replaces `acMapProps.originIatas` with just the chosen suggestion, which re-triggers the map's fetch effect. No full reload, no form state change.

## Trade-offs and known limits

- **`observed_routes` is still warming.** The table has ~2 weeks of data at launch. Regional and turboprop families will look suspiciously sparse for another month or two. The suggestions branch exists partly to compensate. The hub-network overlay's `minDests` threshold is temporarily lowered from 20 to 5 for the same reason — see [server/src/controllers/mapController.js](../../server/src/controllers/mapController.js) (`getHubNetwork`).
- **Variant precision is coarse.** `Airbus A340` collapses A340-300 and A340-600 into one family. `routes[].icaoTypes` surfaces the actual ICAO designators seen (`A343` vs `A346`) for users who care, but the family picker itself doesn't split them. Splitting would fracture already-sparse data; revisit once `observed_routes` has 6+ months of history.
- **Mobile fat-finger on dense arc clusters.** At tight zoom around a busy hub, 20 arcs fan out within a few tap-target diameters. The mitigation is the mobile bottom drawer — a scrollable list of destinations with explicit tap targets — rather than trying to make the arcs tappable. Desktop uses the same underlying hit-test (dot radius plus 8 px) on the dots canvas.
- **Cache key shape.** The 30-minute TTL plus `family:sorted-origins:windowDays` key means that a user swapping `PRG → VIE` + radius-800 for `VIE → PRG` + radius-800 (same resolved IATA set) hits the same cache entry, which is correct. But a request changing `windowDays` from 14 to 7 cold-starts even though the 7-day result is a subset of the 14-day result. Not worth optimising until cache pressure shows up.
- **No pagination on `routes[]`.** Hard cap of 500 rows. A popular family from 10 mega-hubs will approach this. The `LIMIT 500` clause in [db.js → getAircraftRoutes](../../server/src/models/db.js) is deliberate — the map becomes unreadable well before 500 arcs. If we ever hit it in practice, prefer server-side top-N-per-origin over offset pagination.

## File map

| File | Role |
|---|---|
| [server/src/routes/aircraft.js](../../server/src/routes/aircraft.js) | Route registration — `GET /routes` placed before the `/:iataCode` catchall so it doesn't shadow. |
| [server/src/controllers/aircraftController.js](../../server/src/controllers/aircraftController.js) | `getAircraftRoutes` — resolves family + origins, queries `observed_routes`, builds `airports[]` dictionary, produces `suggestions[]` when empty. |
| [server/src/middleware/validate.js](../../server/src/middleware/validate.js) | `aircraftRoutesQuery` — validates `family`, CSV `origins` (1–10 IATAs), `windowDays` (1–90). |
| [server/src/models/aircraftFamilies.js](../../server/src/models/aircraftFamilies.js) | Added A340 family. New `resolveFamily(input)` accepts slug or display name. `slugify()` and `getFamilyList()` (now includes `slug` per entry) are exported. |
| [server/src/models/db.js](../../server/src/models/db.js) | Added `getAircraftRoutes` and `countFamilyRoutesFromOrigin` — aggregate read + existence-check helpers over `observed_routes`. |
| [server/src/__tests__/aircraftRoutes.test.js](../../server/src/__tests__/aircraftRoutes.test.js) | 6 Jest + Supertest cases — happy path, multi-origin sort, unknown family, >10 origins, all-unknown-origins, suggestions branch. |
| [client/src/components/AircraftRouteMap.jsx](../../client/src/components/AircraftRouteMap.jsx) | The map view. Leaflet host + two canvas layers (arcs, dots) + legend + bottom drawer + destination side panel that kicks SSE. |
| [client/src/components/AircraftRouteMap.css](../../client/src/components/AircraftRouteMap.css) | Scoped `.arm-*` tokens — layout, colours, responsive breakpoints. |
| [client/src/components/mapArcHelpers.js](../../client/src/components/mapArcHelpers.js) | Extracted `haversineKm`, `geodesicPoints`, `ORIGIN_PALETTE` — shared between `RouteMap.jsx` and `AircraftRouteMap.jsx`. |
| [client/src/App.jsx](../../client/src/App.jsx) | New `acView` state (`'form' \| 'map'`). `handleAircraftSearch` resolves origins via `/api/aircraft/airports/search` + `/api/map/radius`. Listens for `arm-swap-origin` `CustomEvent` to swap origins without re-mounting. |

## See also

- [API reference for `/api/aircraft/routes`](../api/aircraft-routes.md)
- [README — Features section](../../README.md#features)
