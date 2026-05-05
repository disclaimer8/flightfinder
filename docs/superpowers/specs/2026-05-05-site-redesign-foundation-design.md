# Site redesign — Foundation (layout + design language + homepage)

**Status:** Draft
**Date:** 2026-05-05
**Owner:** Denys Kolomiiets
**Scope:** First spec of a 7-part site redesign roadmap (variant C: full UX redesign).

---

## Context

Independent audits by UX Researcher, UI Designer, and Product Manager (run on the
live production site `https://himaxym.com` on 2026-05-05) converged on the same
diagnosis: **internal pages are islands without a global header or footer**, the
homepage doesn't communicate what the product does, and the visual design
oscillates between a SaaS landing template (`/`) and bare Wikipedia drafts
(`/safety/*`, `/aircraft/*`, `/routes/*`, `/pricing`).

This spec is the foundation. Subsequent specs in the roadmap will address:

- #2 Cross-linking pass (FlightCard ↔ landings, Pro upgrade prompts)
- #3 Safety pages redesign (SafetyFeed cards, SafetyGlobal mobile, EventDetail)
- #4 Aircraft / Route landing pages redesign
- #5 Pricing / Trips / Legal polish
- #6 Design system extraction
- #7 Mobile responsiveness audit (rolled into earlier specs as needed)

---

## Goals

1. Every page renders the same global chrome (navy top bar + 3-column footer).
2. The product has a coherent visual identity: editorial aviation-industrial,
   not consumer-travel.
3. The homepage communicates "aircraft- and safety-aware flight search" within
   2 seconds of landing.
4. The dead `/by-aircraft` link becomes a real index page.
5. `RouteLandingPage` keeps its promise of an inline search CTA.

## Non-goals

- Redesigning `SafetyFeed` cards, `SafetyGlobal` table, `AircraftLandingPage`
  body, `RouteLandingPage` body, `Pricing`, `MyTrips`, or legal pages.
- Fixing the NTSB feed data pipeline ("Other / Operator unknown").
- Fixing the broken embedded route map on `/aircraft/boeing-787`.
- Fixing the `/safety/global` mobile filter rail.
- Adding Pro upgrade prompts inside FlightCard.
- Adding `/airlines/:iata` landing pages.

These are tracked in §10 *Known follow-ups* and addressed in later specs.

---

## §1 Design tokens v2

Edit `client/src/index.css`. Existing tokens (radius, shadow, semantic
green/orange/red, navy, bg, border, text scale) stay. Three additions:

### 1.1 Type system

```css
--font-display: 'Source Serif 4', Charter, Georgia, serif;
--font-ui:      'Inter Tight', system-ui, -apple-system, 'Segoe UI', sans-serif;
--font-mono:    'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
```

Loaded via Google Fonts `<link>` tags in `client/index.html`:

- `Source Serif 4` weight 600 only, subset latin (~25KB WOFF2)
- `Inter Tight` weights 400/500/600 latin (~30KB WOFF2)
- `IBM Plex Mono` weights 400/500 latin (~15KB WOFF2)
- One `<link rel="preload" as="font">` for Inter Tight 500 (critical path)
- Others load with `font-display: swap`

`body` default font becomes `var(--font-ui)`. Headlines (H1, H2 on landing
pages and homepage hero) use `var(--font-display)`. Tail numbers, ICAO/IATA
codes, dates, fatality counts in tabular contexts use `var(--font-mono)`.

### 1.2 Indigo demoted

Currently `--primary: #6366f1` is used as: brand, primary CTA, link, active
tab, eyebrow chip background, hover underline. Split:

```css
--primary:     #6366f1;  /* primary action button + active segment indicator only */
--link:        #4f46e5;  /* text links, breadcrumbs */
--accent-soft: #eef2ff;  /* very subtle backgrounds (existing --primary-light) */
```

Eyebrow chips and hover underlines move to `var(--text-2)` (slate `#475569`).

### 1.3 Severity tokens

Reuse existing semantic colors, alias for safety contexts:

```css
--sev-fatal:    var(--red);     /* fatal accident */
--sev-hull:     var(--orange);  /* hull loss / serious incident */
--sev-incident: var(--text-3);  /* incident / minor / unclassified */
```

These are introduced now but only referenced in §4.4 (Recent safety events
section). Full propagation to `SafetyFeed` and `SafetyGlobal` happens in
spec #3.

---

## §2 `<SiteLayout>` architecture

Three new presentational components. No state providers; sign-in modal state
lives inside `SiteLayout` because the trigger (Sign in button) is in the header.

### 2.1 Files

- `client/src/components/SiteLayout.jsx` + `SiteLayout.css`
- `client/src/components/SiteHeader.jsx` + `SiteHeader.css`
- `client/src/components/SiteFooter.jsx` + `SiteFooter.css`

### 2.2 Shape

```jsx
<SiteLayout variant="default" | "transparent-over-hero">
  <SiteHeader variant={...} />
  <main><Outlet /></main>          {/* react-router v6 Outlet */}
  <SiteFooter />
  {authModalOpen && <AuthModal ... />}
</SiteLayout>
```

`variant="default"` — solid navy bar, `position: sticky; top: 0`. Used on
internal pages.

`variant="transparent-over-hero"` — bar starts transparent, becomes solid
navy + drop shadow when an `IntersectionObserver` sentinel placed at the
bottom of the hero exits the viewport. Used on `/` only.

`isNativeApp()` short-circuit: if true, render only `<Outlet />` (no header,
no footer; native shell provides chrome).

### 2.3 Routing wire-up

`client/src/index.jsx`:

```jsx
<Routes>
  <Route element={<SiteLayout />}>          {/* default variant */}
    <Route path="/aircraft/:slug"  element={<Suspense ...><AircraftLandingPage /></Suspense>} />
    <Route path="/routes/:pair"    element={<Suspense ...><RouteLandingPage /></Suspense>} />
    <Route path="/by-aircraft"     element={<Suspense ...><AircraftIndex /></Suspense>} />
    <Route path="/trips"           element={<Suspense ...><MyTrips /></Suspense>} />
    <Route path="/pricing"         element={<Suspense ...><Pricing /></Suspense>} />
    <Route path="/subscribe/return"element={<Suspense ...><SubscribeReturn /></Suspense>} />
    <Route path="/legal/terms"     element={<Suspense ...><Terms /></Suspense>} />
    <Route path="/legal/privacy"   element={<Suspense ...><Privacy /></Suspense>} />
    <Route path="/legal/attributions" element={<Suspense ...><Attributions /></Suspense>} />
    <Route path="/safety/feed"     element={<Suspense ...><SafetyFeed /></Suspense>} />
    <Route path="/safety/events/:id" element={<Suspense ...><SafetyEventDetail /></Suspense>} />
    <Route path="/safety/global"   element={<Suspense ...><SafetyGlobal /></Suspense>} />
  </Route>
  {/* Home renders its own SiteLayout in transparent-over-hero variant */}
  <Route path="*" element={<App />} />
</Routes>
```

App.jsx wraps its existing content in `<SiteLayout variant="transparent-over-hero">`.
The duplicated `<nav>` and `<footer>` blocks currently in App.jsx (lines
110-174 and 316-339) are deleted.

### 2.4 State that moves

- `<AuthModal />` ownership moves from App.jsx to SiteLayout. App.jsx still
  owns `verifyState` (email-verify URL handler) because it's homepage-specific.
- `<APIStatus />` rendering moves to SiteHeader. The status field currently
  piggybacks on the `/api/flights/filter-options` response (App.jsx line 89,
  reads `data.apiStatus`). To avoid duplicate requests, extract a shared
  module-level promise into `client/src/hooks/useFilterOptions.js`:
  - First call fetches `/api/flights/filter-options` and caches the promise.
  - SiteHeader's `useApiStatus()` reads `data.apiStatus` from the same promise.
  - App.jsx's existing filter-options consumer reads the same promise and
    extracts `filterOptions` (everything except `apiStatus`).
  - On internal pages where filter options are not used, only the
    `apiStatus` field is consumed but the same response is cached for
    future visits to `/`.

---

## §3 Top-nav contents and behavior

### 3.1 Desktop layout (left to right)

```
[FF logo + "FlightFinder"]   Search · By aircraft · Safety · Pricing      [APIStatus]   [My Trips* · email · Sign out  |  Sign in · Sign up]
```

Items:

| Item | Link | Active state |
|------|------|--------------|
| Logo + wordmark | `/` | always white |
| Search | `/?mode=search` | on `/` when URL `?mode` is `search` or absent |
| By aircraft | `/by-aircraft` | on `/by-aircraft` OR `/aircraft/*` OR on `/` when URL `?mode=by-aircraft` |
| Safety | `/safety/global` | on any `/safety/*` |
| Pricing | `/pricing` (hidden in native app) | on `/pricing` |
| APIStatus | n/a (component) | always rendered |
| My Trips | `/trips` (only when `user`) | on `/trips` |
| Sign in / Sign up | opens `AuthModal` | n/a |

**URL as source of truth for tab state on `/`.** When the user clicks a tab
inside the homepage hero (Search / By aircraft / Route map), App.jsx writes
the new mode to the URL via `history.replaceState({}, '', '?mode=...')` —
not `pushState`, to avoid history pollution. SiteHeader reads `mode` via
`useSearchParams()` to derive its active link. This unifies external
deeplinks (§4.6) and internal tab clicks under one mechanism.

### 3.2 Visual style

- Bar background `var(--navy)` (default variant) or transparent (over-hero).
- Bar height 64px desktop, 56px mobile.
- Nav items: `var(--font-ui)` 14px weight 500. Inactive `rgba(255,255,255,0.7)`,
  hover `white` + bg `rgba(255,255,255,0.06)`. Active state — 2px underline
  (`var(--primary)`) 12px wide, centered under text.
- No "pill" backgrounds. Editorial text-link treatment.

### 3.3 Mobile (<640px)

- Show: logo + APIStatus dot (no text) + hamburger button (right).
- Hamburger opens full-screen drawer, slide-from-right, navy bg, 16px text /
  48px tap targets.
- Drawer items: same as desktop nav + auth actions.
- Close on: ESC, click outside, click any link (`useEffect` on
  `useLocation()`), tap close button.
- `aria-modal="true"`, focus trap, body scroll lock.

### 3.4 Sticky behavior

- Default variant: `position: sticky; top: 0; z-index: 50`. Below `--z-modal`
  (1000), above `--z-dropdown` (200).
- Transparent variant: `<SiteHeader>` reads a context value
  (`isOverHero: boolean`) provided by `<SiteLayout>` via an `IntersectionObserver`
  on a 1px sentinel placed under the hero. Fade between transparent and solid
  navy with 200ms transition.

---

## §4 Homepage redesign

### 4.1 Hero copy

`client/src/App.jsx` lines 203-206. Replace:

```
Find flights by aircraft type
Search routes worldwide, filtered by aircraft model
```

With:

```
The aircraft- and safety-aware flight search engine
See which airline, which aircraft, and what its safety record looks like — before you book.
```

Strings move into `client/public/content/landing/home.json` (new file) under
key `hero` to match the existing JSON-driven copy pattern from
`project_perf_2026_04_30`. Fetched on App mount with a static fallback string
in case of fetch failure.

H1: `var(--font-display)` 48px desktop / 32px mobile / weight 600 / color
white. Subhead: `var(--font-ui)` 18px / 16px / `rgba(255,255,255,0.75)` /
max-width 56ch.

### 4.2 Search workspace cosmetics

Existing tabs (Search / By aircraft / Route map) and SearchForm stay
structurally. Cosmetic changes only:

- Active tab: 2px `var(--primary)` underline indicator instead of filled pill.
- Inactive tab: text only, no background.
- "Search Flights" submit button: full width, height 52px, font 16px weight 600.
  Currently it sits below the fold on mobile (UX Researcher finding); raising
  the form's intrinsic height is out of scope, but a taller button is more
  thumb-friendly when the user does scroll to it.

### 4.3 Sample-cards section

New section, between hero and search workspace, on the same navy background.

Three cards in a horizontal row (desktop), stacked (mobile):

| Eyebrow | Headline | Body | CTA → |
|---------|----------|------|-------|
| `FOR AVGEEKS` | Where does the Boeing 787 fly? | See every route, every airline. | View routes → `/aircraft/boeing-787` |
| `FOR TRAVELERS` | Know what aircraft you'll fly | Filter your search by aircraft type before you book. | Search flights → `/?mode=search` |
| `FOR RESEARCHERS` | Browse 5,200+ historical accidents | NTSB + Aviation Safety Network — searchable. | Open database → `/safety/global` |

Below the row: a single thin link "Browse all aircraft →" → `/by-aircraft`.

Card styling:

- White card on navy hero, border `1px solid rgba(255,255,255,0.1)`,
  `border-radius: var(--r-lg)`, padding 24px.
- Hover: lift with `var(--shadow-md)`, transition 150ms.
- Eyebrow: `var(--font-mono)` 11px uppercase letter-spacing 0.08em color
  `var(--text-2)`.
- Headline: `var(--font-display)` 22px weight 600 color `var(--text)`.
- Numbers in headlines (5,200+, 787): `var(--font-mono)` for that token only.
- Body: `var(--font-ui)` 16px color `var(--text-2)`.
- CTA: `var(--font-ui)` 14px weight 500 color `var(--link)` with arrow.

Strings live in `home.json` under `sampleCards` for easy editing.

### 4.4 "Recent safety events" section

New section, rendered inside `<main>` below results, only when
`!hasSearched && exploreResults === null` (clean homepage state). Removed
from view once a search produces results, to not clutter the workflow.

Tabular layout with 5 most recent events. Component name:
`<RecentSafetyEvents />`. Fetches `${API_BASE}/api/safety/global/accidents?limit=5`
on mount. Shows skeleton during fetch, falls back to a single CTA "Browse the
full safety database →" if fetch fails or returns < 1 event.

```
RECENT SAFETY EVENTS                                                  View all events →

2026-04-24    Serious incident   Boeing 737-800     PH-EME       LEMD → EHAM
2026-04-22    Incident           Cessna 172         N4136E       —    → —
2026-04-21    Incident           ATR 72-600         CP-1935      SLLP → SLCB
```

Typography:

- Section heading: `var(--font-mono)` 11px uppercase letter-spacing 0.08em
  color `var(--text-2)`.
- Date, tail, route codes: `var(--font-mono)` 13px.
- Aircraft, severity: `var(--font-ui)` 14px.
- Severity coloring uses `--sev-fatal` / `--sev-hull` / `--sev-incident` from
  §1.3.
- Empty fields render as `—` (em dash), never as "Other" or "Unknown".

⚠️ Because the NTSB feed has known empty-state issues (§10), this section may
render only 0–2 events at first deploy. Acceptable — the empty fallback CTA
covers that case. The full fix lands in spec #3.

### 4.5 Mobile

- Hero `min-height: 60vh` (down from current `70vh` desktop equivalent), so
  on iPhone (390x844) the hero is ~506px and accommodates H1 + subhead + 3
  stacked sample cards with one card visible above the fold.
- Sample cards stack vertically, full-width with 16px page margins.
- Sample card height capped at `auto` — let content drive.

### 4.6 Mode/parameter deeplinks (consumed by App.jsx)

App.jsx parses `useSearchParams()` on mount:

| Param | Effect |
|-------|--------|
| `mode=search` | `setSearchMode('search')` |
| `mode=by-aircraft` | `setSearchMode('by-aircraft')` |
| `mode=map` | `setSearchMode('map')` |
| `family=<slug>` | When `mode=by-aircraft`, pre-fills `AircraftSearchForm` family selection |
| `from=<IATA>` | When `mode=search`, pre-fills SearchForm departure (symmetric to existing `prefillArrival`) |
| `to=<IATA>` | When `mode=search`, pre-fills SearchForm arrival (uses existing `prefillArrival` mechanism) |

Unknown mode values fall back to `mode=search`. Unknown IATA codes are
ignored silently.

---

## §5 Aircraft index page `/by-aircraft`

### 5.1 Files

- `client/src/pages/AircraftIndex.jsx` + `AircraftIndex.module.css`
- `scripts/build-aircraft-index.js` (new build-step)
- `client/public/content/aircraft-index.json` (generated, gitignored or
  committed — pick one; recommend committed for deterministic builds)

### 5.2 Build step

`scripts/build-aircraft-index.js`:

1. Reads `client/public/content/landing/aircraft/*.json` (the per-slug
   landing copy files).
2. For each slug, looks up family metadata via the existing server module
   `server/src/models/aircraftFamilies.js` (imported as a local module at
   build time — both client/server share this file via Node `require`).
3. Outputs `client/public/content/aircraft-index.json`:

   ```json
   [
     { "slug": "boeing-787", "label": "Boeing 787 Dreamliner",
       "manufacturer": "Boeing", "category": "wide-body",
       "tagline": "Long-haul, twin-aisle composite-bodied workhorse." }
   ]
   ```

4. `tagline` comes from the per-slug JSON's `summary` field (truncated to
   first sentence) or from a hardcoded fallback in the build script.
5. Wired into `client/package.json` as a `prebuild` npm script:
   `"prebuild": "node ../scripts/build-aircraft-index.js"`.

This pattern matches how `landing-copy.json` is currently built per
`project_perf_2026_04_30`.

### 5.3 Page layout (inside `<SiteLayout variant="default">`)

```
[Site header — solid navy]

HERO (light, ~280px)
  H1 "Aircraft browser"
  Subhead "Explore routes, operators, and safety records — by aircraft type."

CATEGORY TABS (sticky under header)
  All  ·  Wide-body  ·  Narrow-body  ·  Regional  ·  Turboprop

GRID
  3 columns desktop, 2 tablet, 1 mobile
  Each tile = TileLink with eyebrow / family / tagline / category badge / CTA arrow

[Site footer]
```

### 5.4 Tile component

```jsx
<Link to={`/aircraft/${slug}`} className={styles.tile}>
  <div className={styles.eyebrow}>{manufacturer.toUpperCase()}</div>
  <h2 className={styles.familyName}>{label}</h2>
  <p className={styles.tagline}>{tagline}</p>
  <div className={styles.tileFooter}>
    <span className={styles.categoryBadge}>{categoryLabel}</span>
    <span className={styles.cta}>View routes →</span>
  </div>
</Link>
```

- Eyebrow: `var(--font-mono)` 11px uppercase
- Family name: `var(--font-display)` 24px weight 600
- Tagline: `var(--font-ui)` 14px color `var(--text-2)`
- Category badge: `var(--font-mono)` 10px uppercase, light bg, padding 2px 8px
- Hover: lift `var(--shadow-md)`, border becomes `var(--link)`

### 5.5 Category filter

Client-side. State `selectedCategory` (default `'all'`). Tab click sets state,
grid filters with `families.filter(f => selectedCategory === 'all' || mapCategory(f.category) === selectedCategory)`.

`mapCategory` converts aircraftFamilies `type` field to UI label:

```
'wide-body' → 'wide-body'
'jet'       → 'narrow-body'   (UI rename; data field stays 'jet')
'regional'  → 'regional'
'turboprop' → 'turboprop'
```

### 5.6 Entry points

- Top-nav "By aircraft" → `/by-aircraft`
- `AircraftLandingPage.jsx` breadcrumb "Aircraft" link → `/by-aircraft` (currently
  goes nowhere)
- Homepage "Browse all aircraft →" link (§4.3)

### 5.7 Dead-link fixes

In addition to creating the index, two targeted CTA fixes:

**`AircraftLandingPage.jsx`** — "Search flights on the {label}" CTA:
- Currently: `to="/by-aircraft"` (404)
- After: `to={`/?mode=by-aircraft&family=${slug}`}`
- App.jsx parses `mode` and `family` per §4.6, switches to By-aircraft tab
  with family pre-selected.

**`AircraftSearchForm.jsx`** — accept new prop `initialFamily?: string`. If
present, pre-select on mount via `useEffect` and (if a sensible default
origin is also available) advance the form state. If origin is not available,
just pre-fill family and let the user pick origin/date.

**`RouteLandingPage.jsx`** — copy "or run a full search for specific dates
below" referenced a non-existent search form. Replace with a CTA button:
- Text: "Run a search for these dates"
- `to={`/?mode=search&from=${origin}&to=${destination}`}`
- App.jsx parses `from`/`to` and pre-fills SearchForm (extends existing
  `prefillArrival` mechanism with a symmetric `prefillDeparture`).

### 5.8 Out of scope

- No `by-manufacturer` filter beyond the implicit eyebrow text.
- No search box on the index page (~20 families, scroll is fine).
- No `AircraftLandingPage` redesign (deferred to spec #4).
- No `/by-route` index page.

---

## §6 Roll-out plan and testing

### 6.1 Branch / commit order

Single feature branch `feat/site-redesign-foundation`, sequential commits:

1. **chore(tokens): add font-display/font-ui/font-mono, demote indigo**
   — `index.css` + `client/index.html` `<link>` tags. CSS-only, no behavior change.
2. **feat(layout): add SiteLayout/SiteHeader/SiteFooter components**
   — new files, not yet wired. Includes `useApiStatus` hook.
3. **feat(layout): wire SiteLayout into all routes**
   — `index.jsx` route restructure. Delete duplicate nav/footer from App.jsx.
   App.jsx wraps content in `<SiteLayout variant="transparent-over-hero">`.
4. **feat(home): mode/family/from/to URL deeplinks**
   — App.jsx parses `useSearchParams()`. `prefillDeparture` symmetric helper.
5. **feat(aircraft): /by-aircraft index page + build script**
   — new page, new build script, new aircraft-index.json. Route added.
6. **fix(landings): wire AircraftLandingPage CTA + RouteLandingPage CTA to deeplinks**
   — replaces dead `/by-aircraft` CTA target; replaces RouteLandingPage
   broken-promise copy.
7. **feat(home): new hero copy + sample-cards + recent-safety-events**
   — App.jsx homepage content. New `home.json`. New `RecentSafetyEvents`
   component.

Single PR → `main` merge → single GitHub Actions deploy (per
`feedback_deploy_batching`).

### 6.2 Manual smoke checklist (browser, post-deploy preview)

Run `npm run dev` in `client/`. With auth in dev mode, walk through:

- [ ] `/` desktop — hero with new copy renders, sample cards clickable, search
      tabs work, search submits, sticky header transitions transparent → solid
      on scroll.
- [ ] `/` mobile (390x844) — hamburger opens drawer, drawer links navigate
      and close, hero fits 60vh, sample cards stack readably.
- [ ] `/safety/global` — navy header + footer present, logo returns to `/`.
- [ ] `/safety/feed` — same chrome present.
- [ ] `/safety/events/<known-id>` — same chrome present.
- [ ] `/by-aircraft` — grid renders, category tabs filter, tile click opens
      `/aircraft/<slug>`.
- [ ] `/aircraft/boeing-787` — chrome present, breadcrumb "Aircraft" → `/by-aircraft`,
      "Search flights on the Boeing 787" CTA → `/?mode=by-aircraft&family=boeing-787`
      with family pre-selected.
- [ ] `/routes/lhr-jfk` — chrome present, "Run a search for these dates" CTA →
      `/?mode=search&from=LHR&to=JFK` with form pre-filled.
- [ ] `/pricing` — chrome present, plans render, checkout button works
      (regression — should not have changed).
- [ ] `/trips` (logged in) — chrome present, list renders.
- [ ] `/legal/terms`, `/legal/privacy`, `/legal/attributions` — chrome present.
- [ ] Sign-in modal opens from `/safety/global` header — proves auth modal
      works on every page, not just `/`.

Capture before/after screenshots for `/`, `/safety/global`,
`/aircraft/boeing-787`, mobile `/`. The `.playwright-mcp/` directory is
gitignored (per `d390fa9`), so screenshots stay local; upload them as PR
comments / drag-drop into the PR description, not as committed files.

### 6.3 Automated tests

`client/src/__tests__/SiteLayout.test.jsx` — Vitest + React Testing Library:

- Renders header + footer + outlet
- `isNativeApp() === true` renders only outlet
- Mobile burger toggles drawer
- Drawer closes on link click (location change)
- AuthModal opens when Sign in clicked

Run existing test suite (`npm test`) — must pass with no new failures.

⚠️ Per `feedback_frontend_contract`, unit tests cannot catch React error #31
(JSX child mismatch). Manual browser smoke remains the source of truth.

### 6.4 Performance budget

Per `project_perf_2026_04_30`, home initial brotli ≤ 92KB.

Net additions:

- Google Fonts (cross-origin, not in bundle): ~70KB WOFF2 total. One
  preload (~30KB) on critical path; others swap.
- SiteLayout/Header/Footer JS+CSS (gzipped): ~3KB.
- Sample-cards inline in App.jsx: ~1KB.
- AircraftIndex page: lazy chunk, ~5KB. Not in home initial.
- aircraft-index.json: ~5KB, served from CDN cache, not in critical path.

Expected home-initial delta: **+1–2 KB brotli**. Stays under budget.

Verify with `client && npm run build` — Vite reports per-chunk sizes; flag
if main chunk grows by >2KB brotli.

### 6.5 Rollback

All changes ship in one PR. Rollback = `git revert <merge-sha>` + redeploy
via GitHub Actions. CSS / token changes are pure additions; reverting
restores prior state with no data migrations.

---

## §7 Architecture summary

```
                  ┌──────────────────┐
                  │   index.jsx      │
                  │   (BrowserRouter)│
                  └────────┬─────────┘
                           │
                ┌──────────┴──────────┐
                │                     │
                ▼                     ▼
       ┌─────────────────┐   ┌────────────────┐
       │ <SiteLayout>    │   │ App.jsx        │
       │ default variant │   │ (wraps itself  │
       │                 │   │  in SiteLayout │
       │ <Outlet />      │   │  transparent)  │
       └────────┬────────┘   └────────────────┘
                │
   /aircraft/:slug, /by-aircraft, /routes/:pair,
   /pricing, /trips, /safety/*, /legal/*

       <SiteLayout>
         ├── <SiteHeader>
         │     ├── logo + wordmark
         │     ├── primary nav (Search/By aircraft/Safety/Pricing)
         │     ├── <APIStatus> (via useApiStatus)
         │     ├── auth actions (My Trips/Sign in/up/email/Sign out)
         │     └── mobile drawer (<640px)
         ├── <main><Outlet/></main>
         ├── <SiteFooter>
         │     └── 3 cols: Explore / Account / Legal
         └── <AuthModal> (mounted on demand)
```

---

## §8 Data flow

### 8.1 API status (Live flights pill)

`useApiStatus()` — single fetch on mount of any page that mounts `SiteHeader`.
Cached in module-level promise (similar pattern to `_globalAccidentsPromise`
in AircraftLandingPage.jsx). 60-second stale-while-revalidate via setTimeout
refresh. Returns `{ status, ok }`.

### 8.2 Aircraft index data

Static JSON at `/content/aircraft-index.json`. Fetched on AircraftIndex page
mount. Cached by browser (immutable 1y per existing nginx config from
`project_static_caching`).

### 8.3 Recent safety events

`fetch('/api/safety/global/accidents?limit=5')`. Existing endpoint, no
backend changes. Fail-soft: render fallback CTA on any non-2xx (per
`feedback_frontend_contract` and the recent enriched-card soft-fail fix
6eba5b0/dbc266a).

### 8.4 URL deeplinks

Parsed once in App.jsx `useEffect([])` via `useSearchParams()`. Setting
`searchMode`, prefill state, and `acQuery` as appropriate. URL is **not**
mutated back when state changes from clicks (avoid history pollution).

---

## §9 Error handling

| Surface | Failure mode | Behavior |
|---------|--------------|----------|
| Google Fonts | CDN unreachable | `font-display: swap` + system fallback. UI shifts ~50ms then settles. Acceptable. |
| `/api/aircraft/families` (unused in v1; only `aircraft-index.json` used) | n/a | Static JSON; no runtime fetch failure path. |
| `/content/aircraft-index.json` | 404 / network | AircraftIndex shows "Aircraft browser is loading…" then "Couldn't load aircraft list" CTA → `/`. |
| `/api/safety/global/accidents` | non-2xx | RecentSafetyEvents renders fallback "Browse the full safety database →" CTA. No error banner. |
| `useApiStatus` | non-2xx | APIStatus pill hides (current behavior). |
| Mode/family/from/to deeplink with bogus values | Unknown mode → fallback to 'search'; unknown IATA → ignored silently. | No error banner. |
| AuthModal open from any page | Always available via SiteLayout state. | n/a |

---

## §10 Known follow-ups (not in this spec)

Tracked for next specs in the roadmap:

| # | Issue | Spec |
|---|-------|------|
| 1 | `/safety/feed` 100% cards = "Other / Operator unknown" — data pipeline not enriching | Spec #3 (Safety pages redesign + data fix) |
| 2 | `/aircraft/boeing-787` embedded route map renders empty white box | Spec #4 (Aircraft landing redesign) |
| 3 | `/safety/global` mobile filter rail consumes 60% of viewport | Spec #3 |
| 4 | FlightCard has no Pro upgrade prompt for free users (PM finding #7) | Spec #2 (Cross-linking pass) |
| 5 | `OperatorSafetyBlock` should deeplink to `/safety/global?op={airline}` | Spec #2 |
| 6 | `SafetyEventDetail` should link to `/aircraft/{slug}` when model matches | Spec #2 |
| 7 | `RouteLandingPage` body lacks safety section (top operators on this route) | Spec #4 |
| 8 | `AircraftLandingPage` body has flat hierarchy — needs editorial redesign | Spec #4 |
| 9 | `/airlines/:iata` landing pages do not exist — researcher journey breaks | Future spec, not in roadmap |

---

## §11 Open questions

None blocking. One stylistic decision deferred to implementation:

1. AircraftIndex tile order — alphabetical by manufacturer-then-family for
   v1 (popularity data is not currently tracked). Revisit when usage data
   exists.

---

## §12 Acceptance criteria

This spec is done when:

- [ ] Every internal route renders `<SiteHeader>` and `<SiteFooter>`.
- [ ] `/by-aircraft` exists, lists ≥ 19 aircraft families with category filter.
- [ ] `AircraftLandingPage` "Search flights" CTA navigates to a working
      pre-filled form (no 404).
- [ ] `RouteLandingPage` has a working "Run a search for these dates" CTA.
- [ ] Homepage hero uses new copy and the three sample cards are clickable.
- [ ] Mobile (390x844) homepage shows hamburger that opens a navy drawer.
- [ ] Sticky header transitions transparent → solid on `/` scroll.
- [ ] Home initial bundle (brotli) ≤ 94 KB (current 92 + 2 KB budget).
- [ ] No regression in existing test suite.
- [ ] Manual smoke checklist (§6.2) passes in Chrome and Safari iOS.
