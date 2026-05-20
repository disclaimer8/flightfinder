# Interactive Flight Map Redesign

**Date:** 2026-05-20
**Status:** Approved, ready for plan
**Owner:** Denys

## Problem

The `/map` page renders **3,091 polylines flat on a dark world tile**, all the same color and 0.15 opacity. Visually it reads as a blue smog across Europe and the US instead of an aviation network. Audit of user complaints (2026-05-20 brainstorm) surfaced five concrete issues:

| Code | Issue |
|------|-------|
| A | Visual chaos — all routes drawn identically, no hierarchy |
| B | 6,072 airports exist in the dataset but aren't rendered |
| D | Filters are two text inputs above the map — no chips, no map-driven selection |
| E | Hover/click is shallow — tooltip is `IATA → IATA · N airlines · M aircraft`, click jumps straight to `/search` |
| G | No zoom-aware density — same routes rendered at world zoom and at zoom 8 |

The map is also constrained to 60vh, leaving the dominant page element in roughly half the viewport.

## Goal

Replace the flat polyline soup with a **network map** where airports are the primary entity and routes are secondary, with a Network ↔ Density view toggle, click-driven exploration via a side panel, chip-based filtering, and zoom-aware visibility culling.

**Success criteria:**

1. At world zoom (z=2) the map renders at most ~200 airport dots (top hubs by route degree) and ~300 route lines.
2. Zooming to z=5 reveals all 6,072 airports and all 3,091+ routes, sized and opaque to match scale.
3. Clicking an airport dot opens a right-hand panel showing name/city/country, destination/airline/aircraft counts, and the top 10 destinations sorted by frequency. The clicked airport's spokes are highlighted in amber; everything else is dimmed.
4. Clicking a route line opens a compact popup with `dep → arr`, airline/aircraft mix, and a CTA to `/search?from=…&to=…`.
5. Filters are chips above the map (semi-transparent, floating over the canvas). A `+ Add filter` opens a searchable combobox; selecting an option adds a chip; `×` removes it. State persists in URL params (`?airline=BAW&aircraft=A380&view=density`).
6. A Network/Density toggle sits in the bottom-right of the map. Density mode renders a heatmap weighted by route frequency; same data, same filters.
7. Map container fills `calc(100vh - var(--site-header-height))`; filter chips and view toggle float over the canvas via absolute positioning.
8. No regression in existing observed_routes ingest or `/api/admin/ingest-status` metrics.

## Non-goals

- **Replacing Leaflet with deck.gl / kepler.gl / Mapbox GL.** Leaflet's canvas renderer is sufficient at 3K routes + 6K airports. Future GPU rewrite stays out of scope.
- **Server API changes.** The existing endpoints (`/api/map/routes`, `/api/map/airports`, `/api/map/filters`, `/api/map/route-brief`, `/api/map/route-aircraft`, `/api/map/route-operators`) cover everything we need. Degree, top-K, and culling are computed client-side.
- **SSR changes.** `/map` SEO bake remains unchanged (already serves nav+footer to bots via SiteLayout; SPA hydrates over it post-mount).
- **Mobile-native gestures beyond what Leaflet provides by default.**
- **3D / globe view.**
- **New tile providers.** CartoDB dark stays.
- **Great-circle curves are out of scope** for this redesign (user did not pick C in diagnosis). Polylines remain straight; bezier curves can be a follow-up.
- **Live ADS-B layer / animated planes.** This is a static-network view of observed routes (90-day window), not a real-time radar.

## Approach

### 1. Airport degree + top-K (client-side compute)

When `/api/map/routes` and `/api/map/airports` resolve, compute:

```js
// airport degree = count of distinct routes (dep or arr)
const degree = new Map();
for (const r of routes) {
  degree.set(r.dep.iata, (degree.get(r.dep.iata) || 0) + 1);
  degree.set(r.arr.iata, (degree.get(r.arr.iata) || 0) + 1);
}

const airportsByDegree = airports
  .map(a => ({ ...a, degree: degree.get(a.iata) || 0 }))
  .sort((x, y) => y.degree - x.degree);

const TOP_HUBS = airportsByDegree.slice(0, 200);
```

`TOP_HUBS` is the set rendered at z≤3. From z=4 we render more (top 1000 by degree). From z=6 we render everything.

### 2. New components

| File | Responsibility |
|------|----------------|
| `client/src/pages/map/AirportLayer.jsx` | NEW. Renders airport dots (radius scaled by degree), IATA labels at z≥3. Handles click → emit `onAirportSelect(iata)`. Filters by current zoom + selected filters. |
| `client/src/pages/map/HeatmapLayer.jsx` | NEW. Wraps Leaflet.heat plugin. Builds weighted points from routes (each dep/arr endpoint weighted by ~ln(degree+1)). Same filter set applies. |
| `client/src/pages/map/AirportPanel.jsx` | NEW. Slide-in right-side panel, fixed-width 360px (full-width mobile). Renders airport name, city, country, three big stats (destinations/airlines/aircraft), top-10 destination list, "Search flights from X" CTA. Close on Esc or backdrop click. |
| `client/src/pages/map/RoutePopup.jsx` | NEW. Compact popup anchored to clicked route midpoint. Uses existing `/api/map/route-brief` (already implemented). |
| `client/src/pages/map/MapFilters.jsx` | NEW. Floating chip row + `+ Add filter` combobox. Replaces the existing `RouteMapFilters.jsx` (which is deleted as part of this work). |
| `client/src/pages/map/MapViewToggle.jsx` | NEW. Segmented control (Network/Density). Persists `view` in URL. |
| `client/src/pages/map/computeMapData.js` | NEW. Pure functions: `computeDegree(routes)`, `filterByZoom(airports, zoom)`, `filterByActiveFilters(routes, airline, aircraft)`, `topDestinations(routes, iata, k)`. All unit-tested without Leaflet. |
| `client/src/pages/map/RouteMapLayer.jsx` | MODIFY. Strips out filter UI (moves to MapFilters), keeps polyline rendering. Reads `selectedAirport` prop; when set, highlights its spokes amber and dims others to opacity 0.02. |
| `client/src/pages/Map.jsx` | MODIFY. Becomes the orchestrator: holds `selectedAirport`, `view`, filter state. Reads/writes URL. Composes the layers. |
| `client/src/pages/map/Map.module.css` | MODIFY. Drops the `max-width: 1280px; padding: 32px 24px 64px` constraints. Map fills viewport. Adds floating chip bar, side panel, toggle styles. |

### 3. Data flow

```
URL params (?airline=BAW&aircraft=A380&view=network&selected=LHR)
    │
    ▼
Map.jsx (URL state, single source of truth via useSearchParams)
    │
    ├──► fetchRoutes() ─► computeDegree() ─► AirportLayer (Network mode)
    │                                     ─► HeatmapLayer  (Density mode)
    │                                     ─► RouteMapLayer (both modes; opacity varies)
    │
    ├──► fetchFilters() ─► MapFilters (chip combobox)
    │
    ├──► onAirportSelect(iata) ─► AirportPanel (slide-in)
    │                          ─► RouteMapLayer (highlight spokes)
    │
    └──► onRouteClick(dep, arr) ─► RoutePopup ─► /api/map/route-brief
```

### 4. Zoom-aware culling

Implemented in `AirportLayer` and `RouteMapLayer` via a Leaflet `zoomend` listener. The layers re-key off `zoom` and recompute the visible set:

| Zoom | Airports rendered | Routes rendered |
|------|------------------|------------------|
| ≤ 3 | top 200 by degree | only routes between visible airports (~300) |
| 4-5 | top 1000 by degree | routes between visible airports (~2000) |
| ≥ 6 | all 6072 | all 3091+ |

Airport labels (IATA code as text) appear from z≥3 for top 50 hubs, z≥5 for everything visible.

### 5. Filter chips

Replaces the two text inputs. Structure:

```
┌────────────────────────────────────────────────────────────────┐
│ [+ Add filter]  [Airline: BAW ×]  [Aircraft: A380 ×]           │
└────────────────────────────────────────────────────────────────┘
```

- `+ Add filter` opens a popover combobox with two tabs: "Airline" / "Aircraft".
- Combobox shows top results from `/api/map/filters` (already implemented, top-200 airlines + 43 aircraft families) with autocomplete.
- Selecting an option adds a chip; existing chip for that dimension is replaced.
- `×` on a chip removes that filter.
- URL: `?airline=BAW&aircraft=A380`. Both optional.

### 6. View toggle (Network ↔ Density)

`MapViewToggle.jsx` — segmented control in bottom-right of map canvas.

- **Network mode (default):** AirportLayer + RouteMapLayer.
- **Density mode:** HeatmapLayer + a dimmed RouteMapLayer (opacity 0.04) so route shape is still hinted. Heatmap fades out automatically at z≥5 — the map then visually behaves like Network mode regardless of toggle (the toggle doesn't change; we just stop drawing the heat at close zoom because it's misleading).
- State in URL `?view=network|density`.

### 7. AirportPanel

When `selectedAirport` is set:

- Slide in from the right, 360px wide on desktop, full-width modal on mobile (<768px).
- Backdrop click or Esc closes; closes also clear the `selected` URL param.
- Content:
  - Name (e.g., "London Heathrow"), IATA + country subtitle
  - Three stat tiles: destinations, airlines, aircraft types (computed from routes data)
  - Top 10 destinations: `IATA — City — N daily` (where N daily is derived from `r.last_seen_at` recency — out of scope to compute precisely; for v1 we show count of distinct routes per destination)
  - CTA button: "Search flights from LHR →" linking `/search?from=LHR`
- While panel is open, RouteMapLayer dims all non-spokes to opacity 0.02, draws spokes at opacity 0.8 in amber `#f59e0b`.

### 8. RoutePopup

Anchored at midpoint of clicked polyline. Compact (~280px wide). Shows:

- `LHR → JFK`
- Block time, frequency, fare hero (existing `/api/map/route-brief`)
- Airline list, aircraft list (existing `/api/map/route-operators`, `/api/map/route-aircraft`)
- "Search flights" CTA (existing behavior)

This consolidates what currently lives as separate hover tooltip + immediate-navigate click into a single popover with the option to dismiss.

## Layout / CSS

`Map.module.css` rewrites:

```css
.page {
  /* removed: max-width, padding, margins — was 1280px center column */
  position: relative;
  width: 100%;
  height: calc(100vh - var(--site-header-height, 64px));
  overflow: hidden;
}

.mapContainer { width: 100%; height: 100%; }

.filterBar {
  position: absolute;
  top: 12px;
  left: 12px;
  right: 12px;
  z-index: 500;
  pointer-events: none;  /* let chips themselves capture */
}
.filterBar > * { pointer-events: auto; }

.viewToggle {
  position: absolute;
  bottom: 16px;
  right: 16px;
  z-index: 500;
}

.airportPanel {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: 360px;
  z-index: 600;
  background: var(--card);
  border-left: 1px solid var(--border);
  transform: translateX(100%);
  transition: transform 200ms ease;
}
.airportPanel.open { transform: translateX(0); }
@media (max-width: 768px) {
  .airportPanel { width: 100%; }
}
```

The `<h1>Flight route map</h1>` is removed from visible UI (SR-only for accessibility); the map IS the H1's purpose, no need for redundant text.

## Error handling

| Failure | Behavior |
|---------|----------|
| `/api/map/routes` fails | Existing error banner in Map.jsx; no map drawn. Filters/toggle still interactive. |
| `/api/map/airports` fails | AirportLayer renders empty; RouteMapLayer falls back to today's behavior (just routes). |
| `/api/map/filters` fails | Combobox shows "Unable to load options" empty state; existing chips remain. |
| `/api/map/route-brief` fails (RoutePopup) | Popup shows IATA pair only + Search CTA; no enriched fields. |
| Leaflet plugin failure (`leaflet.heat`) | Density toggle is disabled with tooltip "Density view unavailable"; user stays in Network mode. |
| Empty filter result (no routes match) | Map shows zero polylines; AirportLayer dims to 30% opacity; empty-state ribbon at top of map "No routes match your filter — clear or adjust". |

## Testing

Jest + React Testing Library, no Leaflet rendering in tests (mock the map plugin layer):

1. **`computeMapData.test.js`** (pure functions):
   - `computeDegree(routes)` aggregates correctly
   - `filterByZoom(airports, 2)` returns top 200 by degree
   - `filterByZoom(airports, 5)` returns top 1000
   - `filterByZoom(airports, 6)` returns all
   - `topDestinations(routes, 'LHR', 10)` returns 10 sorted

2. **`AirportLayer.test.jsx`** (mock leaflet):
   - renders dots for visible airports
   - emits `onAirportSelect` on click

3. **`MapFilters.test.jsx`**:
   - chips render from filter state
   - clicking × removes filter (calls setFilters)
   - `+ Add filter` opens combobox
   - selecting option adds chip

4. **`MapViewToggle.test.jsx`**:
   - default state is `network`
   - clicking Density emits `view=density` to onChange
   - reflects current URL param

5. **`AirportPanel.test.jsx`**:
   - renders airport name, city, stats
   - top destinations list sorted by route count
   - Esc closes (calls onClose)
   - mobile breakpoint full-width

6. **`RoutePopup.test.jsx`** (mock route-brief fetch):
   - shows IATA pair, airlines, aircraft, CTA
   - graceful fallback when route-brief errors

7. **`Map.test.jsx` (orchestrator integration)**:
   - URL `?airline=BAW&view=density` initializes state correctly
   - selecting an airport updates URL
   - clearing a filter updates URL

8. **`AppRoutes.test.jsx`** (update existing test): the existing `mounts Map at /map wrapped in SiteLayout` test continues to assert header+footer.

## File structure

```
client/src/pages/Map.jsx                      ── MODIFY (orchestrator)
client/src/pages/map/
  ├── computeMapData.js                       ── NEW
  ├── computeMapData.test.js                  ── NEW
  ├── AirportLayer.jsx                        ── NEW
  ├── HeatmapLayer.jsx                        ── NEW
  ├── AirportPanel.jsx                        ── NEW
  ├── RoutePopup.jsx                          ── NEW
  ├── MapFilters.jsx                          ── NEW (replaces RouteMapFilters.jsx — that file is deleted)
  ├── MapViewToggle.jsx                       ── NEW
  ├── RouteMapLayer.jsx                       ── MODIFY (removes filter UI hooks, adds selectedAirport highlight)
  ├── RouteMapFilters.jsx                     ── DELETE (superseded by MapFilters)
  ├── mapApi.js                               ── UNCHANGED (API client functions)
  ├── Map.module.css                          ── REWRITE (new full-bleed layout)
  └── __tests__/
      ├── AirportLayer.test.jsx               ── NEW
      ├── HeatmapLayer.test.jsx               ── NEW (mock leaflet.heat)
      ├── AirportPanel.test.jsx               ── NEW
      ├── RoutePopup.test.jsx                 ── NEW
      ├── MapFilters.test.jsx                 ── NEW
      ├── MapViewToggle.test.jsx              ── NEW
      ├── Map.test.jsx                        ── NEW (orchestrator)
      ├── RouteMapLayer.test.jsx              ── MODIFY (drop filter assertions, add highlight assertions)
      └── RouteMapFilters.test.jsx            ── DELETE
```

## Dependencies

New npm package: `leaflet.heat` (for HeatmapLayer). Tiny (~9 KB gzip), no transitive deps.

`leaflet` itself is already a dependency.

## Deployment

Standard FlightFinder client deploy: push to `main` → automatic pm2 reload → `npm run build` rebuilds `client/dist/` → new bundle served. No env vars, no migrations.

## Rollback

If the redesign causes issues in prod, revert the merge commit. The old `RouteMapFilters.jsx` and pre-rewrite `Map.jsx` come back. No DB or server changes to undo.

## Open items

None — design fully scoped from brainstorm.

## References

- Brainstorm artifacts: `.superpowers/brainstorm/30720-1779270157/content/{diagnosis,approaches,final-layout}.html` (gitignored)
- Existing code:
  - `client/src/pages/Map.jsx`, `client/src/pages/map/RouteMapLayer.jsx`
  - `client/src/pages/map/RouteMapFilters.jsx`, `mapApi.js`, `Map.module.css`
  - Server: `server/src/controllers/mapController.js`, `server/src/controllers/mapRoutesController.js`, `server/src/routes/map.js`
- Memory: [[reference_flightfinder-paths]] — repo conventions, deploy mechanics
