# Aircraft × Airline Matrix — Design

## Goal

Generate 256 indexable landing pages at `/airline/{iata}/aircraft/{icao}` — one per (airline, aircraft type) combination that has ≥5 distinct dep-arr pairs in the last 90 days of `observed_routes`. Each page shows the actual route set, a mini map, and programmatic FAQ. Long-tail SEO targeting queries like "British Airways A380 routes" or "Ryanair 737 destinations".

## Background

`observed_routes` over 90d contains 4,517 rows / 3,468 unique pairs / 399 airlines (ICAO codes despite the column name) / 43 aircraft types.

Distribution by combination size:
- ≥3 pairs: 434 combinations
- ≥5 pairs: **256 combinations** (target)
- ≥10 pairs: 123 combinations
- ≥20 pairs: 45 combinations

Top combinations: Ryanair B738 (53 pairs), IndiGo A20N (51), SkyWest E75L (48), Southwest B737 (46), Volaris A20N (44).

## Architecture

New URL pattern `/airline/{iata}/aircraft/{icao}` matched in `seoMetaService.js`. Server SSR generates the body via new `bAirlineAircraft()` in `seoContentBuilders.js`. Client SPA gets a new lazy-loaded `<AirlineAircraftLanding>` route. Sitemap enumerator emits the 256 whitelisted combos.

## URL contract

- Airline code in URL = **IATA** (e.g., `/airline/BA/aircraft/A380`) — matches existing `/airline/:iata` Amadeus surface
- Aircraft code in URL = **ICAO** type (`A380`, `B738`, `A20N`) — matches existing aircraft system
- Resolution: `observed_routes.airline_iata` actually stores ICAO; convert via `openFlightsService.getAirlineByIcao(icao).iata` to derive the IATA used in URL/canonical
- Case: URL accepts mixed case; normalise to uppercase internally
- Combos with unresolvable ICAO→IATA mapping (no IATA assigned) are excluded from sitemap and return 404 if hit directly

## Threshold rule

A combination is "valid" iff it has **≥5 distinct dep-arr pairs** in the last 90 days AND the airline ICAO resolves to an IATA. Only valid combos:
- Get a sitemap entry
- Get `noindex: false` meta
- Have meaningful content

Invalid combos (someone navigating to e.g. `/airline/XX/aircraft/YY`) return a generic "No routes found" page with `noindex: true, follow`.

## Page content

### 1. Hero
H1: `{Airline name} routes on the {Aircraft name}`
- e.g., "British Airways routes on the Airbus A380"
- Resolves airline name via `getAirlineByIcao` and aircraft name via `aircraftFamilies.getFamilyByCode`

Subtitle paragraph: "In the last 90 days, {Airline} operated {Aircraft} on {N} distinct city pairs across {N} airports."

### 2. Routes list table
Columns: **Departure | Arrival | Route | Last seen**
- Sorted by frequency (most-flown first)
- Each row: dep_iata (e.g., LHR), arr_iata (e.g., JFK), city pair string ("London → New York"), date of last_seen
- Show up to 30 rows in initial render; with "Load more" button for combos with >30 routes (Ryanair B738 has 53)
- Each row links to `/search?from=DEP&to=ARR`

### 3. Mini route map
Reuse Leaflet canvas + polyline rendering from `RouteMapLayer.jsx`. Show only this combination's routes. Default zoom calibrated to fit the route bounds.

### 4. Airline summary card
- Name, ICAO, IATA
- Country (from openFlights)
- Total observed routes site-wide (link to `/airline/{iata}` parent page)
- Active aircraft types in our data (link to other matrix pages for this airline)

### 5. Aircraft summary card
- Family label, ICAO type, manufacturer
- Number of operators in our data (link back to `/aircraft/{slug}/airlines`)
- Aircraft category (wide-body / narrow-body / regional / turboprop)

### 6. Programmatic FAQ (4 questions)
1. "How many routes does {Airline} fly on the {Aircraft}?" — with concrete N
2. "What is the longest {Airline} {Aircraft} route?" — compute from haversine distance using airport coords; show route + km
3. "What is the shortest {Airline} {Aircraft} route?" — same
4. "Which airports does {Airline} use for the {Aircraft}?" — list of top 5 dep airports + top 5 arr airports

All 4 Q&A → FAQPage JSON-LD.

### 7. Internal links cluster
- ← Back to {Airline} all routes (`/airline/{iata}`)
- ← Back to {Aircraft} all routes (`/aircraft/{slug}`)
- Other aircraft this airline flies in our data
- Other airlines flying this aircraft in our data

## SEO

- **Title**: `{Airline} {Aircraft type} routes (2026) | FlightFinder` — e.g., "British Airways A380 routes (2026) | FlightFinder"
- **Description**: "All routes flown by {Airline} on the {Aircraft family} in the last 90 days. {N} destinations including {top1}, {top2}."
- **Canonical**: `${BASE}/airline/{iata}/aircraft/{icao}` (case-normalised)
- **robots**: `index, follow` for valid combos; `noindex, follow` for invalid
- **Schema**:
  - `BreadcrumbList`: Home › Airlines › {Airline} › Aircraft › {Aircraft}
  - `ItemList`: route enumeration (`itemListElement` with each route as a `Place` or `LinkedRoute`-ish entity)
  - `FAQPage`: 4 Q&A
- **OG image**: reuse existing aircraft OG (per slug) — generated dynamically would be nicer but out of scope

## Sitemap

`seoUrlEnumerator.js` gains a new function `enumerateAirlineAircraftMatrix()` that:
- Queries `observed_routes` aggregated by (airline_iata-as-ICAO, aircraft_icao) with HAVING distinct pairs ≥ 5
- Resolves each airline ICAO → IATA; drops rows where resolution fails
- Returns 256 URLs with `priority: 0.5, changefreq: weekly, lastmod: today`

In `routes/seo.js`, the sitemap-generation code joins these into the existing enumeration.

## API endpoint

`GET /api/airline/{iata}/aircraft/{icao}/routes` — returns:
```json
{
  "airline": { "iata": "BA", "icao": "BAW", "name": "British Airways", "country": "United Kingdom" },
  "aircraft": { "icao": "A380", "name": "Airbus A380", "category": "wide-body" },
  "routes": [
    { "dep": "LHR", "arr": "JFK", "dep_city": "London", "arr_city": "New York", "last_seen_at": ..., "distance_km": 5550 },
    ...
  ],
  "summary": { "n_pairs": 16, "n_airports": 22, "longest": {...}, "shortest": {...} }
}
```

5-min cache via `cacheService`. SSR builder uses the same data shape so the client just fetches it once on mount (skipping it if already in window state from initial HTML).

## Files

### CREATE
- `server/src/controllers/airlineAircraftController.js`
- `server/src/routes/airlineAircraft.js`
- `server/src/services/airlineAircraftService.js` — aggregation + summary + haversine helpers
- `server/src/__tests__/airlineAircraftService.test.js`
- `server/src/__tests__/seoBuilders.airlineAircraft.test.js`
- `client/src/pages/AirlineAircraftLanding.jsx`
- `client/src/pages/AirlineAircraftLanding.module.css`

### MODIFY
- `server/src/services/seoMetaService.js` — new URL regex + meta builder
- `server/src/services/seoContentBuilders.js` — new `bAirlineAircraft()`
- `server/src/services/seoUrlEnumerator.js` — append matrix URLs to sitemap
- `server/src/index.js` — mount `/api/airline/:iata/aircraft/:icao` router
- `client/src/AppRoutes.jsx` — new lazy route

### DO NOT TOUCH
- `bAirline()` (existing /airline/{iata} SSR) — out of scope
- `aircraftFamilies.js` model
- `observed_routes` schema

## Out of scope (v1)

- Time-series ("how routes changed over 12 months")
- Cross-airline comparison ("BA A380 vs Qatar A380")
- Liveries / aircraft photos
- Aircraft-variant breakdown (we know the family/type, not the registration)
- Live status / currently-airborne aircraft

## Reversibility

- Data-driven from `observed_routes` — nothing baked permanently. Combinations that fall below threshold drop from sitemap on next sitemap regeneration.
- Pages will auto-fade if routes disappear (combo with <5 pairs becomes a `noindex` fallback page).
- No DB migrations.
- Sitemap reverts to pre-matrix state by removing the enumerator call.

## Acceptance criteria

- Sitemap contains exactly 256 URLs under `/airline/*/aircraft/*` (give or take a couple if airline ICAO→IATA mapping fluctuates)
- `/airline/BA/aircraft/A388` (BA's A380 is ICAO A388): renders proper title, H1, routes table, FAQ
- `/airline/RYR/aircraft/B738`: same metrics with ≥30 route entries (Ryanair has the most)
- `/airline/XX/aircraft/YY` (invalid combo): generic "No routes found" with `noindex`
- All existing 119 server tests + new tests pass
- Client build is clean
