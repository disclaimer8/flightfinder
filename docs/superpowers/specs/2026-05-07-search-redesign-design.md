# Search Page Redesign — Design Spec

**Date:** 2026-05-07
**Owner:** Solo (denyskolomiiets)
**Status:** Approved (pending implementation)
**Scope:** Holistic redesign of flight search UX — split `/` and `/search` routes, fix back-button state loss, restructure home page, modernize filters, paginate results.

---

## 1. Goal

Make flight search on `himaxym.com` feel like a deliberate product instead of a single overgrown landing page. Specifically:

- Restore back-button safety: clicking back from any flight detail returns to the exact same search state (form values, filters, sort, scroll position).
- Pre-fill the form from URL on every navigation, so a saved/shared search link reproduces the original results.
- Remove distractions from the search flow (the three "For Avgeeks / For Travelers / For Researchers" promo cards mid-page).
- Replace the 26,752 px single-scroll dump of 52+ flight cards with a controlled "Show more" progression.
- Establish three equally-weighted entry points to the product (Search, By aircraft, Map) as proper routes — not tabs hidden in a hero form.

**Success criteria:**

- `/search?from=…&to=…&date=…&…` is fully restorable from URL — opening the link cold renders the exact same results, filters, sort, and scroll position.
- Clicking any flight card → browser back returns the user to the same scroll Y on `/search` with all form/filter state intact.
- Home page (`/`) renders ≤ 1500 px tall, contains zero promotional "article-style" links between search and results.
- Three top-level routes (`/search`, `/aircraft`, `/map`) are linked from the SiteHeader nav and accessed without query-string mode params.
- Mobile (375 px) renders all three pages without horizontal overflow (`scrollWidth ≤ innerWidth + 1`).

---

## 2. Baseline pain (what's broken now)

User-reported issues triggering the redesign:

1. **Back button breaks state.** Click any flight → flight detail → click back → form is empty, results gone, scroll is at top.
2. **Form fields disappear after navigation.** Only `from` and `to` round-trip through the URL; `date`, `passengers`, `tripType`, and every filter live in component state and reset on remount.
3. **Promotional links inside the search flow.** Three `<SampleCards>` blocks (For Avgeeks / For Travelers / For Researchers) sit between the form and results, distracting from the task.
4. **Single-scroll dump.** All 52 result cards render at once — page is 26,752 px tall, scroll position cannot be restored, mobile rendering is heavy.

Architectural baseline:

- Everything (form, mode tabs, results, sample cards, recent safety) lives on `/`.
- Mode switching uses query-string param `?mode=search|by-aircraft|map`.
- Header link "By aircraft" points to `/by-aircraft` — no such route exists; falls through to the catch-all and silently breaks.
- `cabin` and `flexible_dates` aren't represented anywhere in the form.

---

## 3. Architecture decisions

Decisions reached through brainstorming session 2026-05-07 (six visual A/B/C questions, all confirmed):

| # | Decision | Choice |
|---|---|---|
| 1 | Page architecture | **B** — split `/search` into its own route |
| 2 | Three search modes | **B** — each mode is a separate route (`/search`, `/aircraft/:slug` already exists, `/map`) |
| 3 | Home page role | **B** — hybrid landing: hero search bar + Aircraft browser chips + Recent safety events |
| 4 | `/search` filter UI | **B** — horizontal filter chips above results (Skyscanner-style); no sidebar |
| 5 | Results list | **B** — "Show more" button (initial 7, +30 chunks); no pagination, no infinite scroll |
| 6 | URL state contract | full set + `cabin` + `flex_dates` |

---

## 4. Routes

Final route map after redesign:

| Route | Page | Status |
|---|---|---|
| `/` | Home (hero + search bar + aircraft chips + safety events) | **Rewrite** |
| `/search` | Flight search (form bar + filter chips + result cards) | **New** (extracted from `/`) |
| `/map` | Global route explorer (Leaflet) | **New** (extracted from `/?mode=map`) |
| `/aircraft` | Index of aircraft families | Existing — no changes |
| `/aircraft/:slug` | Per-aircraft hub | Existing — no changes |
| `/aircraft/:slug/airlines` | Airlines that operate X | Existing — no changes |
| `/routes/:from-:to/:aircraft` | Programmatic combo (5,107 SEO pages) | Existing — no changes |
| `/safety/global`, `/safety/feed`, `/safety/events/:id` | Safety surfaces | Existing — no changes |
| `/about`, `/pricing`, `/legal/*` | Content pages | Existing — no changes |

### SiteHeader nav

```
[FlightFinder]   Search · By aircraft · Map     │ Safety  Pricing │ [Sign in]
```

Three primary entries link to `/search`, `/aircraft`, `/map`. Active state via `useMatch` (highlight current route). Mobile drawer keeps the same layout vertically.

### Backwards compatibility

301 redirects (server-side, nginx) to preserve any external links:

| Old URL | New URL |
|---|---|
| `/?mode=by-aircraft&family=787` | `/aircraft/boeing-787` |
| `/?mode=by-aircraft` | `/aircraft` |
| `/?mode=map` | `/map` |
| `/?from=LHR&to=JFK&...` | `/search?from=LHR&to=JFK&...` (preserve all params) |
| `/by-aircraft` (broken header link) | `/aircraft` |

Client-side fallback in `App.jsx` for any redirect that nginx misses (defense in depth).

---

## 5. Home page (`/`)

Target height ≤ 1500 px. Three sections:

### 5.1 Hero with search bar

```
H1: "The aircraft- and safety-aware flight search engine"
subtitle: "See which airline, which aircraft, what its safety record looks like — before you book."

┌──────────────────────────────────────────────────────────┐
│ [From ▾] [To ▾] [Depart 📅] [Return 📅] [Pax ▾]    [🔍] │
│ ☐ Direct only      ☐ ±3 day flexibility                  │
└──────────────────────────────────────────────────────────┘
```

Component: new `<HomeSearchBar>` in `client/src/components/HomeSearchBar.jsx`.

- 5 inputs (From, To, Depart, Return, Pax) + 2 checkboxes (Direct, Flex dates).
- `cabin` is **not** in the home bar (advanced; users who care will adjust on `/search`). `cabin` defaults to `economy` on submit.
- Validation before submit: `from !== to`, `date >= today`, `return >= date` (if present).
- Submit handler does NOT call `/api/flights/search` — it calls `navigate('/search?from=…&to=…&…')`.

### 5.2 Browse by aircraft

```
BROWSE BY AIRCRAFT                                        See all →
[787] [A380] [A350] [777] [A330] [747] [737] [A320] [+9]
```

Component: new `<AircraftBrowser>` in `client/src/components/AircraftBrowser.jsx`.

- Reads aircraft families from `/api/aircraft/families` (existing endpoint) or static fallback list.
- 8–12 most popular families as chip links; "See all →" links to `/aircraft`.
- Each chip → `/aircraft/:slug`.
- Mobile: horizontal scroll instead of grid (more discoverable).

### 5.3 Recent safety events

Existing `<RecentSafetyEvents>` component — keep as-is.

- 3 most recent items with link to `/safety/feed`.
- Component already handles loading / empty state.

### 5.4 What's removed

- `<SampleCards>` (3 promo blocks) — removed entirely.
- Mode-toggle tabs `[Search flights / By aircraft / Route map]` inside hero — moved to header nav.
- All "marketing" links between sections (now lives in footer).

---

## 6. `/search` page

### 6.1 Layout (single layout for all viewports)

```
┌───────────────────────────────────────────────────────────────┐
│ SiteHeader (solid variant)                                    │
├───────────────────────────────────────────────────────────────┤
│ FORM BAR (sticky on scroll, collapses to 1 row when stuck)   │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ [From: LHR ▾] [To: JFK ▾] [15 May 📅] [22 May 📅] [1] [🔍] │
│ │ ☐ Direct only   ☐ ±3 day flex   [Cabin: economy ▾]       │ │
│ └──────────────────────────────────────────────────────────┘ │
├───────────────────────────────────────────────────────────────┤
│ FILTER CHIP ROW                                               │
│ [Aircraft: 787 ✕] [+ Airlines] [+ Time] [+ Stops]    Sort: ▾ │
├───────────────────────────────────────────────────────────────┤
│ RESULTS HEADER                                                │
│ 52 flights · LHR → JFK · 15 May 2026 · 1 passenger · economy │
├───────────────────────────────────────────────────────────────┤
│ FlightCard × 7 (initial)                                      │
│ [ Show 30 more results (45 remaining) ↓ ]                     │
├───────────────────────────────────────────────────────────────┤
│ SiteFooter                                                    │
└───────────────────────────────────────────────────────────────┘
```

### 6.2 Form bar

Component: new `<SearchFormBar>` in `client/src/components/SearchFormBar.jsx`.

- Two states: **expanded** (default) and **collapsed-sticky** (after scroll).
- Expanded state shows all fields + checkboxes + cabin select on a second row.
- Collapsed state (after `scrollY > 200`): single row `[From → To · 15 May · 1 pax · 🔍 Edit]`. Click any field or "Edit" → re-expands.
- Implemented via `position: sticky; top: 0` + CSS class toggle on scroll. **No JS scroll listener** (use `IntersectionObserver` on a sentinel element to flip the class — eliminates jank).

### 6.3 Filter chips

Component: new `<FilterChipRow>` in `client/src/components/FilterChipRow.jsx`.

Four chips (in order):

| Chip | Empty label | Filled label | Popover content |
|---|---|---|---|
| Aircraft | `+ Aircraft` | `Aircraft: 787, A350 ✕` | 4 categories (Wide / Narrow / Regional / Turboprop) + specific model checkboxes |
| Airlines | `+ Airlines` | `Airlines: BA, VS ✕` | Checkbox list, sorted by frequency in current results |
| Time | `+ Time` | `Time: morning, afternoon ✕` | 4 buttons (Morning 06–12, Afternoon 12–18, Evening 18–24, Red-eye 00–06) |
| Stops | `+ Stops` | `Stops: direct ✕` | Direct / 1 stop / 2+ stops checkboxes |

- Empty chip = outline button with `[+ Name]` text.
- Filled chip = solid (primary tint) with selection summary + ✕ click target to clear.
- Popover open on click, anchored below chip on desktop.
- **Mobile (≤768 px):** popover replaced with bottom-sheet modal (slide-up, swipe-to-dismiss). Reuse animation and structure from existing `<AircraftDetailModal>`.

Sort dropdown (single-select, separate component `<SortMenu>`):

- Cheapest first (default)
- Fastest first
- **Best safety first** ⭐ (new — differentiator: weighted score from existing operator/aircraft safety data)
- Departure: earliest
- Departure: latest

On mobile sort moves into the chip row as `[Sort: cheapest ▾]`.

### 6.4 Results

Component: refactor `<FlightResults>`.

- Uses `useFlightSearch` hook (refactored to consume URL params, see §7).
- Renders `flights.slice(0, shown)` where `shown` comes from URL.
- Below cards: `<ShowMoreButton>` increments `shown` by 30 via `setSearchParams`.
- Button hidden when `shown >= flights.length`.
- Existing `<FlightCard>` component **unchanged** (already mobile-friendly post-Spec #7, has safety block, has aircraft type, has price).

### 6.5 Empty / loading / error states

| State | Render |
|---|---|
| URL missing required params (`from` / `to` / `date`) | "Search for flights" hero copy + form bar focused on first empty field |
| Search in progress | Existing `<SkeletonResults>` (preserve) |
| Zero results after filtering | "No flights match your filters." + `[Clear all filters]` button (resets aircraft/airlines/direct in URL but keeps from/to/date) |
| API error | Existing `<ErrorBanner>` + `[Try again]` button (re-runs search with same URL) |
| Zero flights from API (no cards before filter) | "No flights found for LHR → JFK on 15 May." + suggestion: "Try ±3 day flexibility" with checkbox shortcut |

---

## 7. URL state contract

The single source of truth for `/search` page state.

### 7.1 Param table

| Param | Type | Default | Class | Notes |
|---|---|---|---|---|
| `from` | IATA (3 letters) | — | search | required |
| `to` | IATA (3 letters) | — | search | required |
| `date` | YYYY-MM-DD | — | search | required |
| `return` | YYYY-MM-DD | empty | search | empty = one-way |
| `pax` | int 1–9 | `1` | search | passengers |
| `cabin` | enum | `economy` | search | `economy` / `premium-economy` / `business` / `first` |
| `flex_dates` | `0` / `1` | `0` | search | server broadens window ±3 days |
| `aircraft` | slug-list | empty | filter | comma: `boeing-787,airbus-a380` |
| `airlines` | iata-list | empty | filter | comma: `BA,VS,AA` |
| `direct` | `0` / `1` | `0` | filter | direct only |
| `sort` | enum | `cheapest` | display | `cheapest`/`fastest`/`safety`/`departure-asc`/`departure-desc` |
| `shown` | int | `7` | display | how many cards rendered |

`tripType` is **derived** from `return` presence — not stored separately.

### 7.2 Class semantics

| Class | Behavior on change |
|---|---|
| `search` | Re-fire `/api/flights/search`. Reset `shown` to 7. Clear cached results. |
| `filter` | No API call. Re-apply filters to cached results. Keep `shown`. |
| `display` | No API call. No filter. Re-render only. |

### 7.3 What's NOT in URL

- Open popovers (UI state, lives in component)
- Scroll position (saved to `history.state`, see §8)
- Search results themselves (always API)
- Form-validation errors (component state)

---

## 8. Data flow & back-button mechanics

### 8.1 Mount sequence on `/search`

```
1. Search.jsx mounts
2. const [params, setParams] = useSearchParams()
3. Read all 12 params, validate (from/to/date present?)
4. If required missing → render empty state
5. Else → call useFlightSearch.search(searchParams)
6. While loading → SkeletonResults
7. On success → cache flights in component state
8. Apply filter params → filteredFlights
9. Apply sort param → sortedFlights
10. Slice [0, shown] → renderedFlights
11. Render FlightCards
12. useEffect: if window.history.state?.scrollY → window.scrollTo(0, scrollY)
```

### 8.2 URL update strategies

| Action | Method | Why |
|---|---|---|
| Form bar input change | `setSearchParams(..., {replace: true})` | Don't pollute history with each keystroke |
| Submit button click | `navigate('/search?...', {replace: false})` | Push new history entry — back returns to previous search |
| Filter chip toggle | `setSearchParams({...}, {replace: true})` | Replace |
| Sort dropdown change | `setSearchParams({sort}, {replace: true})` | Replace |
| Show more click | `setSearchParams({shown: shown+30}, {replace: true})` | Replace |
| Click a flight card | Save scroll → `history.replaceState({scrollY}, '')` then `navigate('/flights/:id')` | Push new history; scroll restorable on back |

### 8.3 Back-button restoration

```javascript
// Triggered on click of any FlightCard
const onFlightClick = (flight) => {
  window.history.replaceState(
    { ...window.history.state, scrollY: window.scrollY },
    ''
  );
  navigate(`/flights/${flight.id}`);
};

// In Search.jsx after results render
useLayoutEffect(() => {
  const saved = window.history.state?.scrollY;
  if (saved && filteredFlights.length > 0) {
    requestAnimationFrame(() => window.scrollTo(0, saved));
  }
}, [filteredFlights.length]);
```

`useLayoutEffect` ensures scroll fires before paint. `requestAnimationFrame` guards against measuring before layout settles.

### 8.4 Server changes

Backend additions to support `cabin` and `flex_dates`:

- `flightController.search` accepts `cabin` (forward to adapters) and `flex_dates` flag.
- **Google Flights sidecar:** `cabin` already supported (the SerpApi wrapper accepts `travel_class`). `flex_dates` is implemented server-side as a 7-day fan-out: the controller fires 7 parallel 1-day searches (date-3 … date+3), merges results, dedupes by `(carrier, flight_no, depart_local)`. Flex never falls through to a vendor-specific date-grid API in this iteration to keep the contract uniform across adapters.
- **Travelpayouts adapter:** `cabin` maps to `cabin_class`. `flex_dates` uses TP's existing `flexible` flag.
- **AirLabs:** does not provide pricing, so `cabin` is a no-op for the AirLabs leg. `flex_dates` doesn't apply.
- **Duffel:** `cabin` maps to `cabin_class`. `flex_dates` not supported — fallback to client-side multi-search.

If any adapter doesn't support `flex_dates`, server feature-flags it off via env var `FLEX_DATES_ENABLED` and the home/search checkbox renders disabled with tooltip "Coming soon".

---

## 9. Component inventory

### New components

| Path | Purpose |
|---|---|
| `client/src/pages/Home.jsx` | Home page wrapper (hero + AircraftBrowser + RecentSafetyEvents) |
| `client/src/pages/Search.jsx` | `/search` route page (FormBar + FilterChipRow + Results) |
| `client/src/pages/Map.jsx` | `/map` route page (mounts existing `<RouteMap>`) |
| `client/src/components/HomeSearchBar.jsx` | Hero search bar (5 fields + 2 checkboxes) |
| `client/src/components/AircraftBrowser.jsx` | Chip grid → `/aircraft/:slug` |
| `client/src/components/SearchFormBar.jsx` | `/search` form bar (expanded + sticky-collapsed) |
| `client/src/components/FilterChipRow.jsx` | 4 filter chips + Sort menu |
| `client/src/components/FilterChip.jsx` | Single chip (button + popover/bottom-sheet) |
| `client/src/components/SortMenu.jsx` | Sort dropdown |
| `client/src/components/ShowMoreButton.jsx` | Increment `shown` URL param |

### Refactored components

| Path | Change |
|---|---|
| `client/src/App.jsx` | Becomes thin routing root; `<Routes>` mounts Home/Search/Map/Aircraft/Safety |
| `client/src/hooks/useFlightSearch.js` | Reads URL params instead of internal state; exposes `searchAffectingHash` to dedupe API calls |
| `client/src/components/FlightResults.jsx` | Receives sliced flights from Search.jsx; no internal `searchedAirlines` state (moved to URL via `airlines` chip) |
| `server/src/controllers/flightController.js` | Accepts `cabin` and `flex_dates`; propagates to adapters |
| `server/src/services/googleFlightsService.js` | Accepts `cabin` + `flex_dates`; orchestrates flex if needed |
| `server/src/services/travelpayoutsService.js` | Accepts `cabin` + `flex_dates` |

### Removed components

- `client/src/components/SampleCards.jsx` (3 promo blocks)
- Mode-tabs UI inside `App.jsx` (moved to header)
- `?mode=` query parsing in `App.jsx`

### Preserved components (no changes)

- `<FlightCard>`, `<AircraftFlightCard>`
- `<RecentSafetyEvents>`
- `<RouteMap>`, `<AircraftRouteMap>`
- `<SkeletonResults>`, `<ErrorBanner>`, `<ErrorBoundary>`
- `<SiteLayout>`, `<SiteFooter>`
- `<SiteHeader>` — adjusted only to update nav links (3 primary)

---

## 10. Phased migration

### Phase 1 — Routes scaffold (0 user-visible change)

- Add `/search`, `/map` routes in `App.jsx`. Mount existing `<SearchForm>` and `<RouteMap>` inside thin page wrappers.
- Add backwards-compat 301 redirects (nginx + client-side fallback).
- Update SiteHeader nav links.
- **Tests:** route mounting, redirect mapping. Existing tests pass unchanged.

### Phase 2 — URL state contract on `/search`

- Refactor `<Search>` to consume `useSearchParams`.
- Refactor `useFlightSearch` to read URL.
- Implement re-search vs re-filter vs display-only logic.
- Implement scrollY save/restore.
- Add `cabin` and `flex_dates` to backend search payload + adapters.
- **Tests:** URL → form binding, re-search trigger logic, scroll restore.

### Phase 3 — Filter chips UI

- Build `<FilterChipRow>` + `<FilterChip>` + `<SortMenu>`.
- Replace existing inline filters with chip row.
- Implement bottom-sheet variant for mobile.
- **Tests:** chip click → popover → selection → URL → label.

### Phase 4 — Home page redesign

- Build `<HomeSearchBar>` and `<AircraftBrowser>`.
- Replace App.jsx `/` render with new `<Home>` page.
- Remove `<SampleCards>` and mode tabs.
- **Tests:** form submit → navigate; aircraft chip → /aircraft/:slug.

### Phase 5 — Show more results

- Implement `<ShowMoreButton>`.
- Replace full-list render with `slice(0, shown)`.
- **Tests:** initial 7 cards, click adds 30, button hides at end.

### Phase 6 — Cleanup

- Remove dead code from old `App.jsx` mode logic.
- Update sitemap.xml generator if `/search` should be excluded (or include canonical examples).
- Verify Sentry breadcrumbs / GA pageviews fire on each new route.
- Final visual QA across all surfaces at 375 / 768 / 1280.

---

## 11. Testing strategy

### Unit (Jest)

**Client:**

- `client/src/pages/__tests__/Search.test.jsx` — URL param parsing, re-search trigger, filter application, scroll restore, sort, show more.
- `client/src/pages/__tests__/Home.test.jsx` — form submit triggers correct navigate URL, validation blocks invalid submits.
- `client/src/components/__tests__/FilterChipRow.test.jsx` — chip click → popover → selection → URL update.
- `client/src/components/__tests__/SearchFormBar.test.jsx` — sticky-collapsed transition; field changes use replaceState.

**Server:**

- `server/src/__tests__/cabin.flex.payload.test.js` — `cabin` and `flex_dates` propagate to adapter mocks; verify request shape per adapter.
- Existing search controller tests updated to include the new params with default values.

### E2E (Playwright via MCP, manual + post-deploy)

- Open `/search?from=LHR&to=JFK&date=2026-05-15` cold → form prefilled, results load.
- Click any FlightCard → navigate to `/flights/:id` → click back → URL identical, form prefilled, scroll Y restored.
- Toggle Aircraft chip on `/search?from=…&to=…` → URL gains `?aircraft=…` → results refilter — verify zero network calls in DevTools.
- Toggle date in form bar → re-search fires → verify network call in DevTools.
- 375 px viewport: form collapses on scroll, chips horizontally scrollable, popover renders as bottom sheet.
- Verify `documentElement.scrollWidth <= window.innerWidth + 1` on `/`, `/search`, `/map`, `/aircraft/boeing-787` at 375 px (regression sentinel — would have caught the mode-toggle bug from 2026-05-07 post-deploy).

### CI smoke test

Add a Playwright spec to GitHub Actions post-deploy step that hits the four canonical URLs at 375 px and asserts:

- HTTP 200
- `documentElement.scrollWidth <= window.innerWidth + 1`
- No console errors (Sentry-noise-tolerant: filter known Cloudflare beacon CSP).

---

## 12. Risks

| Risk | Mitigation |
|---|---|
| `flex_dates` unsupported by Google Flights adapter | Server-side fan-out: 7 sequential 1-day searches, dedupe by flight id. Feature-flag if perf is bad. |
| User has bookmarked `/?mode=…` link | 301 redirect (nginx) + client-side fallback in `App.jsx` for any missed paths. |
| Sticky form bar performance jank on scroll | `position: sticky` (CSS-only) + `IntersectionObserver` for class flip. No scroll listener. |
| Mobile bottom-sheet introduces new UX paradigm | Reuse existing `<AircraftDetailModal>` animation/structure. |
| Bundle size grows with new pages | `/map` already lazy-loaded; `/search` becomes lazy too. Track delta in CI (existing perf budget memory: `project_perf_2026_04_30`). |
| Sentry / GA pageview tracking misses new routes | Existing `useLocation` listener already piped — verify on each route during Phase 6 QA. |
| Sort by safety requires a numeric score per flight | Reuse existing `OperatorSafetyBlock` data. Score = `operator_score * 0.6 + aircraft_score * 0.4`, where each score is `1 - min(incidents_5y / 10, 1)` (10+ incidents in 5 years = 0). Lower is worse; higher sorts first. Documented in `safetyScore.js` as a single pure function used by both the chip and `<OperatorSafetyBlock>` so the score is consistent across UI. |

---

## 13. Out of scope

The following are deliberately deferred:

- Algorithmic grouping of results (Best value / Direct / 1-stop sections — Q5 option C).
- Saved searches / search history (requires auth + DB schema).
- Price alert subscriptions.
- "Track this flight" feature.
- Map deep-link params (`?center=…&zoom=…`).
- Multi-city itineraries (only one-way / round-trip in scope).
- Currency selection (always inherit from existing logic — locale or stored pref).
- Cabin-class-specific safety scoring.

---

## 14. References

- Brainstorming session: 2026-05-07 (Visual Companion screens A1–A6, all in `.superpowers/brainstorm/54455-1778148250/`).
- Related specs:
  - `2026-05-05-site-redesign-foundation-design.md` (design tokens that this redesign uses).
  - `2026-05-06-mobile-responsiveness-design.md` (Spec #7 — breakpoint tokens, touch targets).
  - `2026-05-06-aircraft-route-grid-design.md` (programmatic SEO landing pages).
- Memory pointers: `project_post_deploy_2026_05_07.md` (recent regression patterns), `feedback_verify_with_eyes.md` (always Playwright at 375 px before claiming done).
