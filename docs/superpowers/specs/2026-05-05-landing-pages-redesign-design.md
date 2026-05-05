# Site redesign — Landing pages (Aircraft + Route + By-aircraft index)

**Status:** Draft
**Date:** 2026-05-05
**Owner:** Denys Kolomiiets
**Scope:** Fourth spec of the 7-part site redesign roadmap. Builds on
[Foundation](./2026-05-05-site-redesign-foundation-design.md) +
[Cross-linking](./2026-05-05-cross-linking-pass-design.md) (PR #70 merged) +
[Safety redesign](./2026-05-05-safety-redesign-design.md) (PR #72 in review).

---

## Context

Three independent agents (UX Researcher, UI Designer, Product Manager) re-audited
the live himaxym.com landing pages after PR #70 deploy. They converged on
this finding:

> **Spec #1 only landed on `/by-aircraft`.** AircraftLandingPage and
> RouteLandingPage are still pre-spec system-sans marketing layouts. The
> spec #2 RouteOperators table shipped as one floating mono row, not a table.

Plus they surfaced new issues invisible in spec #1's pre-chrome audit:

- `AircraftRouteMap` embedded widget hijacks SPA navigation when clicked —
  user gets pulled away from landing page mid-session (UX Researcher).
- `/routes/lhr-jfk` (Earth's busiest transatlantic route) silently drops
  RouteOperators + Aircraft sections because sidecar returns empty arrays —
  components fail-closed without empty-state copy. Page reads as broken stub.
- 19 of 20 aircraft families have no bespoke landing-copy JSON; without a
  fallback, those slugs collapse to one-line hint + map.
- RouteLandingPage promises "compare airlines, aircraft types, AND fares on
  one page" — fare data is zero on the landing page itself.
- `/by-aircraft` tiles truncate mid-word and lack quantitative hooks.

This spec finishes the redesign of three landing surfaces:
`/aircraft/<slug>`, `/routes/<pair>`, `/by-aircraft`.

## Goals

1. Editorial design language (Source Serif H1, Inter Tight body, IBM Plex
   Mono for data, demoted indigo, hairline section rhythm) extends to all
   three landing surfaces — finishing what spec #1 started.
2. Aircraft pages render a normalized fact-card sidebar (manufacturer, type,
   engines, range, capacity, first flight, status) for every family,
   regardless of bespoke JSON presence.
3. Route pages render a hero stat strip (typical block time, daily
   frequency, cheapest fare) + an aircraft-mix bar (share-of-flights).
4. Empty data states render explicit honest copy ("No carrier data observed
   yet. We refresh weekly from live ADS-B.") instead of silently dropping
   sections.
5. AircraftRouteMap embedded mode opens a click-popover instead of pushing
   SPA navigation.
6. `/by-aircraft` tiles carry quantitative meta (`N ROUTES · M OPS ·
   K EVENTS / 90D`); a "Most flown · last 14 days" rail surfaces popularity;
   mobile filter chips scroll horizontally without cutoff.

## Non-goals

- Replace Leaflet runtime with server-rendered SVG/PNG (deferred to spec #6
  perf pass).
- `/airlines/<iata>` landing pages.
- Live booking widget on route page.
- "By manufacturer" filter on `/by-aircraft`.
- Mono auto-detection in narrative prose (skipped — only new structured
  data tokens get mono treatment).
- Route brief "block time" using actual `flight_observations` averages
  (v1 uses great-circle distance estimate).

---

## §1 Architecture summary

| # | File | Change | Backend? |
|---|------|--------|----------|
| 1.1 | `client/src/components/SectionHeader.jsx` (new) | Numbered eyebrow + hairline + h2 wrapper | No |
| 1.2 | `client/src/components/SectionHeader.css` (new) | Styles | No |
| 1.3 | `client/src/components/DataCard.jsx` (new) | Sticky sidebar with mono key/value `<dl>` | No |
| 1.4 | `client/src/components/DataCard.css` (new) | Styles | No |
| 1.5 | `client/src/components/AircraftMix.jsx` (new) | Share-of-flights bar component | No |
| 1.6 | `client/src/components/AircraftMix.css` (new) | Styles | No |
| 1.7 | `client/src/components/AircraftLandingPage.css` (modify) | Editorial typography + 12-col grid | No |
| 1.8 | `client/src/components/AircraftLandingPage.jsx` (modify) | Grid wrapper + DataCard + numbered sections + slug-fallback + map empty state | No |
| 1.9 | `client/src/components/AircraftRouteMap.jsx` (modify) | Accept `embedded` prop; click opens modal popover instead of `handleSelectDestination` | No |
| 1.10 | `client/src/components/RouteLandingPage.jsx` (modify) | Hero stat strip + AircraftMix replacing flat link rail + empty states | No |
| 1.11 | `client/src/components/RouteOperators.jsx` (modify) | Proper `<thead>` headers + explicit empty state | No |
| 1.12 | `client/src/components/RouteOperators.css` (modify) | Header row styles | No |
| 1.13 | `client/src/pages/AircraftIndex.jsx` (modify) | Tile quant strip + Most-flown rail + index-stats fetch | No |
| 1.14 | `client/src/pages/AircraftIndex.module.css` (modify) | Stat strip + popular rail + mobile filter scroll-snap | No |
| 1.15 | `server/src/models/aircraftFamilies.js` (modify) | Add `engines`, `capacity`, `firstFlight`, `status` to each family | Yes |
| 1.16 | `server/src/routes/map.js` (modify) | Register `/route-brief` | Yes |
| 1.17 | `server/src/controllers/mapController.js` (modify) | Add `getRouteBrief` controller | Yes |
| 1.18 | `server/src/routes/aircraft.js` (modify) | Register `/index-stats` | Yes |
| 1.19 | `server/src/controllers/aircraftController.js` (modify) | Add `getIndexStats` controller | Yes |
| 1.20 | `server/src/models/db.js` (modify) | Add `countRoutesByAircraft`, `countOperatorsByAircraft` prepared statements | Yes |
| 1.21 | `server/src/models/safetyEvents.js` (modify) | Add `countByAircraftCodes` helper | Yes |
| 1.22 | `scripts/build-aircraft-index.js` (modify) | Tagline length cap 90 chars | No |

8 new client files, 9 modified client files, 7 modified server files. Single
feature branch / single PR.

---

## §2 Critical bug fixes (map hijack + empty states)

### 2.1 AircraftRouteMap navigation hijack fix

**Problem (UX Researcher):** Embedded `<AircraftRouteMap>` on
`/aircraft/<slug>` lets users click destination dots, which triggers
`handleSelectDestination` → SPA navigation back to homepage search. Users
land on `/routes/dxb-jfk` mid-session after exploring `/aircraft/airbus-a320`.

**Fix:** Add `embedded` prop. When `true`, click handler opens a small
in-page modal popover instead of triggering search.

```jsx
// AircraftRouteMap.jsx — function signature
export default function AircraftRouteMap({
  family,
  familyName,
  date,
  passengers,
  originIatas,
  directOnly,
  onBack,
  embedded = false,  // NEW
}) {
  // ... existing setup ...
  const [popover, setPopover] = useState(null);

  const handleDotClick = useCallback((dep, arr) => {
    if (embedded) {
      setPopover({ dep, arr });
      return;
    }
    // existing search-navigation flow
    handleSelectDestination(arr);
  }, [embedded]);

  return (
    <>
      {/* existing map markup with handleDotClick wired to dot click */}
      {popover && (
        <RouteDotPopover
          dep={popover.dep}
          arr={popover.arr}
          onClose={() => setPopover(null)}
        />
      )}
    </>
  );
}
```

`<RouteDotPopover>` — minimal modal showing route IATA pair + 2 CTAs:
- **View this route** → `/routes/<dep>-<arr>` (lowercase)
- **Search flights on this route** → `/?mode=search&from=<dep>&to=<arr>`

In `AircraftLandingPage.jsx` pass `embedded={true}` to the embedded map.

### 2.2 RouteLandingPage silent section drops

**Problem:** `/api/map/route-operators?dep=LHR&arr=JFK` returns
`operators: []`. RouteOperators component returns `null`. Same for
`/api/map/route-aircraft?dep=LHR&arr=JFK` returning `families: []` —
RouteLandingPage silently omits the entire "Aircraft flying X → Y" section.

**Fix:** Replace `return null` with an explicit empty-state section.

`RouteOperators.jsx` (modify the `if (error)` branch):

```jsx
if (error || (ops && ops.length === 0)) {
  return (
    <section className="route-ops" aria-label="Operators on this route">
      <div className="route-ops__head">
        <span className="route-ops__eyebrow">OPERATORS ON THIS ROUTE</span>
      </div>
      <p className="route-ops__empty">
        No carrier data observed on this city pair yet. We refresh weekly from live ADS-B.
      </p>
    </section>
  );
}
```

Add CSS:
```css
.route-ops__empty {
  font: 400 14px/1.5 var(--font-ui);
  color: var(--text-3);
  padding: 16px 0;
}
```

`RouteLandingPage.jsx` (modify the aircraft section gating):

```jsx
{/* Replace "aircraft.length > 0 && (...)" with: */}
<section className="landing-section">
  <SectionHeader number="03" label="AIRCRAFT MIX" />
  <AircraftMix items={aircraftMixItems} />
</section>
```

Where `<AircraftMix>` (Section 5.4) renders empty-state copy when items is
falsy/empty:
```
No aircraft observations yet on this route. Live ADS-B data populates within 7-14 days of first observation.
```

### 2.3 AircraftLandingPage map empty state

When `/api/aircraft/routes?family=<slug>` returns `routes: []`, current
behavior shows an empty white Leaflet frame.

**Fix:** Conditionally render an empty-state block instead of the map:

```jsx
{routes && routes.length > 0 ? (
  <Suspense fallback={<SkeletonResults message="Loading map…" />}>
    <AircraftRouteMap
      embedded={true}
      family={fam.slug}
      familyName={fam.label}
      // ...existing props...
    />
  </Suspense>
) : (
  <p className="landing-empty">
    This aircraft has no live route observations in the past 14 days.
    Try popular families like the <Link to="/aircraft/boeing-787">Boeing 787</Link> or <Link to="/aircraft/airbus-a320">Airbus A320</Link>.
  </p>
)}
```

`routes` state populated from existing `fetch('${API_BASE}/api/aircraft/routes?family=${slug}')` call.

### 2.4 Empty state copy guidelines

All empty states follow this pattern:
1. State what we don't have ("No carrier data observed yet")
2. State why ("We refresh weekly from live ADS-B")
3. Provide an action (link or fallback)

Tokens: color `var(--text-3)`, padding 16px 0, font `400 14px/1.5 var(--font-ui)`.

---

## §3 Editorial design language extension

### 3.1 H1 + body typography

`AircraftLandingPage.css` is shared between AircraftLandingPage and RouteLandingPage. Modify:

```css
.landing-h1 {
  font-family: var(--font-display);  /* was: -apple-system, system-ui, sans-serif */
  font-weight: 600;                   /* was: 800 */
  font-size: 40px;                    /* was: 48px */
  line-height: 1.15;
  color: var(--text);
  margin-bottom: 12px;
}

@media (max-width: 768px) {
  .landing-h1 { font-size: 32px; }
}

.landing h2 {
  font: 600 24px/1.3 var(--font-display);
  color: var(--text);
  margin: 0 0 16px;
  /* hairline + section number now in SectionHeader component (§4) */
}

.landing p, .landing li {
  font: 400 16px/1.6 var(--font-ui);
  color: var(--text);
}

.landing-sub, .landing-map-hint {
  font: 400 16px/1.5 var(--font-ui);
  color: var(--text-2);
  max-width: 60ch;
}
```

### 3.2 Demote indigo CTA to navy

```css
.landing-cta {
  background: var(--navy);    /* was: var(--primary) */
  color: white;
  border: none;
  padding: 12px 20px;
  font: 500 15px var(--font-ui);
  border-radius: var(--r);
  cursor: pointer;
  text-decoration: none;
  display: inline-block;
}

.landing-cta:hover {
  background: var(--navy-2);
}
```

Indigo (`var(--primary)`) reserved for: inline text links (`var(--link)`),
SiteHeader active tab indicator, sample-card CTA arrow on homepage.

### 3.3 Numbered section eyebrows + hairlines

New shared component `<SectionHeader>` (Section 4 component spec). CSS for
the wrapper section:

```css
.landing-section {
  padding-top: 32px;
  margin-top: 48px;
  border-top: 1px solid var(--border-light);
}

.landing-section:first-of-type {
  border-top: none;
  padding-top: 0;
  margin-top: 0;
}
```

### 3.4 What we do NOT change

- `client/public/content/landing/aircraft/*.json` — narrative content stays
  as-is (no manual mono token rewriting).
- FAQ accordion structure.
- Existing breadcrumb component.

---

## §4 New shared components

### 4.1 `<SectionHeader>`

**File:** `client/src/components/SectionHeader.jsx`

```jsx
import './SectionHeader.css';

export default function SectionHeader({ number, label, accessory = null }) {
  return (
    <header className="section-header">
      <div className="section-header__eyebrow">
        <span className="section-header__number">{number}</span>
        <span className="section-header__sep"> / </span>
        <span className="section-header__label">{label}</span>
      </div>
      {accessory && <div className="section-header__accessory">{accessory}</div>}
    </header>
  );
}
```

`accessory` is an optional right-aligned slot for stats (e.g.
`14 cities · 4 continents · 90d window` next to a `02 / OPERATORS` header).

**File:** `client/src/components/SectionHeader.css`

```css
.section-header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 16px;
  margin-bottom: 16px;
}

.section-header__eyebrow {
  font: 500 11px var(--font-mono);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.section-header__number {
  color: var(--text-3);
}

.section-header__sep {
  color: var(--border);
}

.section-header__label {
  color: var(--text-2);
}

.section-header__accessory {
  font: 400 12px var(--font-mono);
  color: var(--text-3);
}
```

### 4.2 `<DataCard>`

**File:** `client/src/components/DataCard.jsx`

```jsx
import './DataCard.css';

export default function DataCard({ rows }) {
  return (
    <aside className="data-card">
      <dl className="data-card__list">
        {rows.map(([label, value]) => (
          <div key={label} className="data-card__row">
            <dt className="data-card__label">{label}</dt>
            <dd className="data-card__value">{value || '—'}</dd>
          </div>
        ))}
      </dl>
    </aside>
  );
}
```

**File:** `client/src/components/DataCard.css`

```css
.data-card {
  border-top: 2px solid var(--text);
  padding-top: 16px;
}

.data-card__list { margin: 0; padding: 0; }

.data-card__row {
  display: flex;
  justify-content: space-between;
  padding: 10px 0;
  border-bottom: 1px solid var(--border-light);
  gap: 16px;
}

.data-card__row:last-child { border-bottom: none; }

.data-card__label {
  font: 500 11px var(--font-mono);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-3);
  flex-shrink: 0;
}

.data-card__value {
  font: 500 14px var(--font-mono);
  color: var(--text);
  text-align: right;
  margin: 0;
}
```

### 4.3 `<AircraftMix>`

**File:** `client/src/components/AircraftMix.jsx`

```jsx
import { Link } from 'react-router-dom';
import './AircraftMix.css';

export default function AircraftMix({ items }) {
  if (!items || items.length === 0) {
    return (
      <p className="aircraft-mix__empty">
        No aircraft observations yet on this route. Live ADS-B data populates within 7-14 days of first observation.
      </p>
    );
  }
  return (
    <ul className="aircraft-mix">
      {items.map(item => (
        <li key={item.slug} className="aircraft-mix__row">
          <Link to={`/aircraft/${item.slug}`} className="aircraft-mix__name">
            {item.label}
          </Link>
          <div className="aircraft-mix__bar" aria-hidden="true">
            <div className="aircraft-mix__bar-fill" style={{ width: `${item.share * 100}%` }} />
          </div>
          <span className="aircraft-mix__pct">{Math.round(item.share * 100)}%</span>
          <span className="aircraft-mix__count">({item.count} obs)</span>
        </li>
      ))}
    </ul>
  );
}
```

**File:** `client/src/components/AircraftMix.css`

```css
.aircraft-mix { list-style: none; padding: 0; margin: 0; }

.aircraft-mix__row {
  display: grid;
  grid-template-columns: 200px 1fr 60px 80px;
  gap: 12px;
  align-items: center;
  padding: 8px 0;
  border-bottom: 1px solid var(--border-light);
}

.aircraft-mix__row:last-child { border-bottom: none; }

.aircraft-mix__name {
  font: 500 14px var(--font-ui);
  color: var(--link);
  text-decoration: none;
}

.aircraft-mix__name:hover { text-decoration: underline; }

.aircraft-mix__bar {
  height: 8px;
  background: var(--border-light);
  border-radius: 4px;
  overflow: hidden;
}

.aircraft-mix__bar-fill {
  height: 100%;
  background: var(--navy);
  border-radius: 4px;
}

.aircraft-mix__pct, .aircraft-mix__count {
  font: 500 13px var(--font-mono);
  color: var(--text-2);
  text-align: right;
}

.aircraft-mix__empty {
  font: 400 14px/1.5 var(--font-ui);
  color: var(--text-3);
  padding: 16px 0;
}

@media (max-width: 640px) {
  .aircraft-mix__row { grid-template-columns: 1fr; gap: 4px; }
}
```

---

## §5 AircraftLandingPage: 12-col grid + DataCard + slug-fallback

### 5.1 Layout

12-col grid: 8-col main + 4-col sticky sidebar (DataCard). Hero spans full
width above the grid. Below 1024px, grid collapses to single column.

```jsx
<div className="landing">
  <Breadcrumb />
  <Hero />
  <div className="aircraft-landing-grid">
    <main className="aircraft-landing-main">
      <section className="landing-section">
        <SectionHeader number="01" label="OVERVIEW" />
        {/* existing narrative paragraphs from JSON */}
      </section>
      <section className="landing-section">
        <SectionHeader number="02" label="OPERATORS" />
        {/* existing operators block */}
      </section>
      <section className="landing-section">
        <SectionHeader number="03" label="SAFETY" />
        {/* existing safety events block */}
      </section>
      <section className="landing-section">
        <SectionHeader number="04" label="ROUTES" />
        {routes && routes.length > 0 ? (
          <AircraftRouteMap embedded={true} /* ... */ />
        ) : (
          <p className="landing-empty">No live route observations in past 14 days. {' '}
            <Link to="/by-aircraft">Browse other aircraft →</Link>
          </p>
        )}
      </section>
      <section className="landing-section">
        <SectionHeader number="05" label="FAQ" />
        {/* existing FAQ accordion */}
      </section>
      <section className="landing-section">
        <SectionHeader number="06" label="RELATED AIRCRAFT" />
        {/* existing sibling rail */}
      </section>
    </main>
    <DataCard rows={[
      ['Manufacturer', family.manufacturer],
      ['Type',         categoryLabel],
      ['Engines',      family.engines],
      ['Range',        family.maxRange ? `${family.maxRange.toLocaleString()} nm` : null],
      ['Capacity',     family.capacity],
      ['First flight', family.firstFlight],
      ['Status',       family.status],
    ]} />
  </div>
</div>
```

Append to `AircraftLandingPage.css`:

```css
.aircraft-landing-grid {
  display: grid;
  grid-template-columns: 8fr 4fr;
  gap: 48px;
  max-width: 1280px;
  margin: 0 auto;
  padding: 0 24px;
}

@media (max-width: 1024px) {
  .aircraft-landing-grid {
    grid-template-columns: 1fr;
    gap: 32px;
  }
  .aircraft-landing-grid .data-card {
    position: static;
  }
}

.aircraft-landing-grid .data-card {
  position: sticky;
  top: 88px;            /* SiteHeader 64px + 24px gap */
  align-self: start;
}

.landing-empty {
  font: 400 14px/1.5 var(--font-ui);
  color: var(--text-3);
  padding: 16px 0;
}
```

### 5.2 `family` data — backend extension

`server/src/models/aircraftFamilies.js` — add 4 new fields per family:

```js
'Boeing 787': {
  label: 'Boeing 787 Dreamliner',
  manufacturer: 'Boeing',
  type: 'wide-body',
  maxRange: 14140,
  codes: new Set([/* existing */]),
  // NEW (Spec #4):
  engines: '2 × turbofan',
  capacity: '248-336 pax',
  firstFlight: '2009-12',
  status: 'In production',
},
```

20 families × 4 new fields. Implementer fills from Wikipedia + FAA TCDS.

`getFamilyList()` already returns full objects → automatic propagation.

### 5.3 Slug-fallback content normalization

Currently `AircraftLandingPage` fetches
`/content/landing/aircraft/${slug}.json` and renders sections from that file.
For slugs without bespoke JSON (the majority), the page collapses to a stub.

**Fix:** Build a fallback content object from the `family` data when the
fetch returns 404.

```jsx
function buildFallbackCopy(family) {
  return {
    summary: `${family.label} is a ${family.type.replace('-', ' ')} ${family.manufacturer} aircraft with a typical range of ${family.maxRange?.toLocaleString() ?? '—'} nautical miles.`,
    sections: [],  // empty — page renders only DataCard + map + safety + FAQ + related
    faq: null,
  };
}

// In useEffect after `family` is resolved:
fetch(`/content/landing/aircraft/${slug}.json`)
  .then(r => r.ok ? r.json() : null)
  .then(data => {
    setLandingCopy(data ?? buildFallbackCopy(family));
  })
  .catch(() => setLandingCopy(buildFallbackCopy(family)));
```

Result: every slug renders consistently — Hero + DataCard + safety + map (or
empty state) + related — even without bespoke JSON. Slugs with JSON get
additional `sections` array rendered.

---

## §6 RouteLandingPage: hero stat strip + AircraftMix

### 6.1 Hero stat strip

After H1 + sub-paragraph, before CTA:

```jsx
{routeBrief && (
  <div className="route-stat-strip">
    <div className="route-stat">
      <span className="route-stat__label">TYPICAL</span>
      <span className="route-stat__value">{formatBlockTime(routeBrief.blockTimeMinutes)}</span>
    </div>
    <div className="route-stat">
      <span className="route-stat__label">FREQUENCY</span>
      <span className="route-stat__value">{routeBrief.frequencyDaily ? `${routeBrief.frequencyDaily}/day` : '—'}</span>
    </div>
    <div className="route-stat">
      <span className="route-stat__label">FROM</span>
      <span className="route-stat__value">{formatFare(routeBrief.cheapestFare)}</span>
    </div>
  </div>
)}
```

Helpers:
```js
function formatBlockTime(minutes) {
  if (!minutes) return '—';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${m}m`;
}

function formatFare(fare) {
  if (!fare || !fare.amount) return '—';
  const symbols = { GBP: '£', USD: '$', EUR: '€' };
  return `${symbols[fare.currency] ?? fare.currency}${fare.amount}`;
}
```

CSS:
```css
.route-stat-strip {
  display: flex;
  gap: 32px;
  margin: 16px 0 24px;
  padding: 16px 0;
  border-top: 1px solid var(--border-light);
  border-bottom: 1px solid var(--border-light);
}

.route-stat { display: flex; flex-direction: column; gap: 4px; }

.route-stat__label {
  font: 500 11px var(--font-mono);
  letter-spacing: 0.08em;
  color: var(--text-3);
  text-transform: uppercase;
}

.route-stat__value {
  font: 500 18px var(--font-mono);
  color: var(--text);
}

@media (max-width: 640px) {
  .route-stat-strip { gap: 16px; flex-wrap: wrap; }
  .route-stat__value { font-size: 16px; }
}
```

### 6.2 New endpoint `GET /api/map/route-brief`

**Response shape:**

```json
{
  "success": true,
  "dep": "LHR",
  "arr": "JFK",
  "windowDays": 90,
  "blockTimeMinutes": 390,
  "frequencyDaily": 18,
  "cheapestFare": { "amount": 342, "currency": "GBP" },
  "aircraftMix": [
    { "slug": "boeing-777", "label": "Boeing 777", "count": 32, "share": 0.68 },
    { "slug": "boeing-787", "label": "Boeing 787 Dreamliner", "count": 8, "share": 0.18 },
    { "slug": "airbus-a330", "label": "Airbus A330", "count": 4, "share": 0.10 },
    { "slug": "airbus-a350", "label": "Airbus A350", "count": 2, "share": 0.04 }
  ]
}
```

**Backend logic** (`server/src/controllers/mapController.js`):

```js
exports.getRouteBrief = async (req, res) => {
  const dep = String(req.query.dep || '').toUpperCase();
  const arr = String(req.query.arr || '').toUpperCase();
  if (!/^[A-Z]{3}$/.test(dep) || !/^[A-Z]{3}$/.test(arr) || dep === arr) {
    return res.status(400).json({ success: false, message: 'dep and arr IATA codes required (3 letters, distinct)' });
  }

  const cacheKey = `map:route-brief:${dep}:${arr}`;
  const cached = cacheService.get(cacheKey);
  if (cached) return res.json(cached);

  try {
    // Block time: great-circle distance × 0.014 + 30min approximation
    const depAirport = openFlights.getAirport(dep);
    const arrAirport = openFlights.getAirport(arr);
    let blockTimeMinutes = null;
    if (depAirport?.lat && arrAirport?.lat) {
      const distNm = haversineNm(depAirport.lat, depAirport.lon, arrAirport.lat, arrAirport.lon);
      blockTimeMinutes = Math.round(distNm * 0.014 + 30);
    }

    // Frequency daily: distinct flights in last 7 days / 7
    const sinceMs7d = Date.now() - 7 * 86400000;
    const flights7d = db.countDistinctFlightsByRoute(dep, arr, sinceMs7d) ?? 0;
    const frequencyDaily = flights7d > 0 ? Math.round(flights7d / 7) : null;

    // Aircraft mix: top 5 families with share
    const sinceMs90d = Date.now() - 90 * 86400000;
    const mixRaw = db.observedAircraftByRoute(dep, arr, sinceMs90d) || [];
    const aircraftMix = computeAircraftMix(mixRaw); // group by family slug, top 5, normalised share

    // Cheapest fare via Travelpayouts (1.5s timeout)
    let cheapestFare = null;
    try {
      cheapestFare = await travelpayouts.fetchCheapestFare(dep, arr, 1500);
    } catch (err) {
      // best-effort: leave null
    }

    const payload = {
      success: true,
      dep, arr, windowDays: 90,
      blockTimeMinutes,
      frequencyDaily,
      cheapestFare,
      aircraftMix,
    };

    cacheService.set(cacheKey, payload, 30 * 60 * 1000);
    res.json(payload);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
```

Helper `haversineNm(lat1, lon1, lat2, lon2)` — implementer adds inline (or
finds existing helper in codebase).

`db.countDistinctFlightsByRoute(dep, arr, sinceMs)` — new prepared
statement, counts `flight_observations` rows for the route.

`computeAircraftMix(rows)` — pure function: groups observation rows by
ICAO type, maps to family slug via `aircraftFamilies` codes Set, sums counts,
sorts desc, takes top 5, computes `share = count / total`.

`travelpayouts.fetchCheapestFare(dep, arr, timeoutMs)` — implementer extends
the existing service per memory `project_travelpayouts.md` (token + marker
709966). If service does not yet expose a route-cheapest helper, add one.
Soft-fail timeout returns null.

**Register route** in `server/src/routes/map.js`:
```js
router.get('/route-brief', ctrl.getRouteBrief);
```

### 6.3 RouteLandingPage data fetch

```jsx
const [routeBrief, setRouteBrief] = useState(null);

useEffect(() => {
  if (!from?.iata || !to?.iata) return;
  let active = true;
  fetch(`${API_BASE}/api/map/route-brief?dep=${from.iata}&arr=${to.iata}`)
    .then(r => r.ok ? r.json() : null)
    .then(body => { if (active) setRouteBrief(body); })
    .catch(() => {});
  return () => { active = false; };
}, [from?.iata, to?.iata]);
```

Then pass `routeBrief.aircraftMix` to `<AircraftMix items={...} />`. Stat
strip uses `routeBrief.blockTimeMinutes` etc.

### 6.4 Replace existing aircraft link rail

Remove the existing `<section className="landing-top-routes">` block (with
`<ul className="landing-siblings-list">` of family links). Replace with:

```jsx
<section className="landing-section">
  <SectionHeader number="03" label="AIRCRAFT MIX" />
  <AircraftMix items={routeBrief?.aircraftMix} />
</section>
```

When `routeBrief` is null (fetch failed/loading), AircraftMix renders empty
state copy.

### 6.5 Travelpayouts integration risk

Mitigation:
- 1.5s timeout
- Soft-fail to `cheapestFare: null`
- Stat strip displays `FROM —` instead of crashing
- Optional: feature flag `ROUTE_BRIEF_FARES_ENABLED='1'` (default off until
  prod verifies stability)

If implementer finds the existing `travelpayoutsService.js` does not expose a
cheapest-fare-by-route helper, they extend it; otherwise reuse.

---

## §7 `/by-aircraft` polish

### 7.1 Tile quant strip

Modify `AircraftIndex.jsx` tile structure to add a stat strip between tagline
and footer:

```jsx
<Link to={`/aircraft/${item.slug}`} className={styles.tile}>
  <div className={styles.eyebrow}>{item.manufacturer.toUpperCase()}</div>
  <h2 className={styles.familyName}>{item.label}</h2>
  {item.tagline && <p className={styles.tagline}>{item.tagline}</p>}
  <div className={styles.statStrip}>
    <span>{stats[item.slug]?.routeCount ?? '—'} ROUTES</span>
    <span className={styles.dotSep}>·</span>
    <span>{stats[item.slug]?.operatorCount ?? '—'} OPS</span>
    <span className={styles.dotSep}>·</span>
    <span>{stats[item.slug]?.safetyCount90d ?? 0} EVENTS / 90D</span>
  </div>
  <div className={styles.tileFooter}>
    <span className={styles.categoryBadge}>{item.category.replace('-', ' ')}</span>
    <span className={styles.cta}>View routes →</span>
  </div>
</Link>
```

Append to `AircraftIndex.module.css`:

```css
.statStrip {
  display: flex;
  gap: 8px;
  font: 500 11px var(--font-mono);
  letter-spacing: 0.06em;
  color: var(--text-3);
  text-transform: uppercase;
  margin-top: 8px;
}

.dotSep { color: var(--border); }
```

### 7.2 New endpoint `GET /api/aircraft/index-stats`

**Response shape:**
```json
{
  "success": true,
  "stats": {
    "boeing-787":  { "routeCount": 47, "operatorCount": 12, "safetyCount90d": 0 },
    "airbus-a320": { "routeCount": 86, "operatorCount": 31, "safetyCount90d": 2 }
  },
  "popular": [
    { "slug": "airbus-a320", "label": "Airbus A320 (all variants)", "routes14d": 86 },
    { "slug": "boeing-737", "label": "Boeing 737 (all variants)", "routes14d": 78 }
  ]
}
```

**Backend logic** (`server/src/controllers/aircraftController.js`):

```js
exports.getIndexStats = (req, res) => {
  const cacheKey = 'aircraft:index-stats';
  const cached = cacheService.get(cacheKey);
  if (cached) return res.json(cached);

  const sinceMs90d = Date.now() - 90 * 86400000;
  const sinceMs14d = Date.now() - 14 * 86400000;
  const families = getFamilyList();
  const stats = {};
  const popularRaw = [];

  for (const fam of families) {
    const codes = Array.from(famDict[fam.label]?.codes ?? []);
    if (codes.length === 0) continue;

    const routeCount     = db.countRoutesByAircraft(codes, sinceMs90d);
    const operatorCount  = db.countOperatorsByAircraft(codes, sinceMs90d);
    const safetyCount90d = safety.countByAircraftCodes(codes, sinceMs90d);
    const routes14d      = db.countRoutesByAircraft(codes, sinceMs14d);

    stats[fam.slug] = { routeCount, operatorCount, safetyCount90d };
    popularRaw.push({ slug: fam.slug, label: fam.label, routes14d });
  }

  const popular = popularRaw
    .filter(p => p.routes14d > 0)
    .sort((a, b) => b.routes14d - a.routes14d)
    .slice(0, 8);

  const payload = { success: true, stats, popular };
  cacheService.set(cacheKey, payload, 60 * 60 * 1000);
  res.json(payload);
};
```

**Register** in `server/src/routes/aircraft.js`:
```js
router.get('/index-stats', aircraftController.getIndexStats);
```

**New SQL** in `server/src/models/db.js`:

```js
countRoutesByAircraft: db.prepare(`
  SELECT COUNT(DISTINCT dep_iata || '-' || arr_iata) AS n
  FROM observed_routes
  WHERE aircraft_icao IN (${codePlaceholders})
    AND seen_at >= ?
`),
// (placeholder pattern — actual implementation builds the IN list dynamically)

countOperatorsByAircraft: db.prepare(`
  SELECT COUNT(DISTINCT airline_iata) AS n
  FROM observed_routes
  WHERE aircraft_icao IN (${codePlaceholders})
    AND seen_at >= ?
    AND airline_iata IS NOT NULL AND airline_iata != ''
`),
```

⚠️ `IN` clause with dynamic codes — better-sqlite3 doesn't bind arrays
directly. Implementer either:
- Builds the IN clause string dynamically (`?,?,?` × codes.length)
- Loops in JS and sums
- Uses a temp table

**Easiest:** loop in JS:
```js
function countRoutesByAircraft(codes, sinceMs) {
  let total = 0;
  for (const code of codes) {
    total += stmts.countRoutesForCode.get(code, sinceMs)?.n ?? 0;
  }
  return total;
}
```

But this overcounts if same route was flown by two ICAO subtypes of the same
family. Actual implementation: SELECT all matching rows, dedupe in JS by
`dep||'-'||arr`, count. Implementer picks the right balance.

`safety.countByAircraftCodes(codes, sinceMs)` — analogous helper in
`server/src/models/safetyEvents.js`. Iterates codes, counts safety_events
matching `aircraft_icao_type`.

### 7.3 "Most flown · last 14 days" rail

Above category tabs in AircraftIndex:

```jsx
<section className={styles.popularStrip} aria-label="Most flown aircraft, last 14 days">
  <div className={styles.popularStripHead}>
    <span className={styles.popularStripEyebrow}>MOST FLOWN · LAST 14 DAYS</span>
  </div>
  <ul className={styles.popularStripRail}>
    {popular.map(p => (
      <li key={p.slug}>
        <Link to={`/aircraft/${p.slug}`} className={styles.popularStripPill}>
          <span className={styles.popularStripPillName}>{p.label}</span>
          <span className={styles.popularStripPillCount}>{p.routes14d}</span>
        </Link>
      </li>
    ))}
  </ul>
</section>
```

CSS:
```css
.popularStrip {
  margin-bottom: 24px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--border-light);
}

.popularStripEyebrow {
  font: 500 11px var(--font-mono);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-3);
  display: block;
  margin-bottom: 12px;
}

.popularStripRail {
  display: flex;
  gap: 8px;
  list-style: none;
  padding: 0;
  margin: 0;
  overflow-x: auto;
  scroll-snap-type: x mandatory;
  -webkit-overflow-scrolling: touch;
}

.popularStripPill {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 12px;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--r);
  text-decoration: none;
  scroll-snap-align: start;
  flex-shrink: 0;
}

.popularStripPill:hover { border-color: var(--link); }

.popularStripPillName {
  font: 500 13px var(--font-ui);
  color: var(--text);
}

.popularStripPillCount {
  font: 500 11px var(--font-mono);
  color: var(--text-2);
}
```

When `popular` array is empty (cold DB), the section silently hides via
`if (popular.length === 0) return null;` early-return inside the JSX.

### 7.4 Mobile filter chip overflow fix

Modify `.tabs` rule in `AircraftIndex.module.css`:

```css
.tabsWrap {
  position: relative;
}

.tabsWrap::after {
  content: '';
  position: absolute;
  right: 0; top: 0; bottom: 0;
  width: 24px;
  background: linear-gradient(to right, transparent, var(--bg));
  pointer-events: none;
}

@media (min-width: 641px) {
  .tabsWrap::after { display: none; }
}

@media (max-width: 640px) {
  .tabs {
    flex-wrap: nowrap;
    overflow-x: auto;
    scroll-snap-type: x mandatory;
    padding-right: 24px;
    -webkit-overflow-scrolling: touch;
  }

  .tab {
    flex-shrink: 0;
    scroll-snap-align: start;
  }
}
```

Wrap the existing `<nav className={styles.tabs}>` in
`<div className={styles.tabsWrap}>...</div>`.

### 7.5 Tagline length cap

`scripts/build-aircraft-index.js` — modify `loadTagline()`:

```js
function loadTagline(slug) {
  // existing JSON read logic
  if (!firstSentence) return '';
  return firstSentence.length > 90 ? firstSentence.slice(0, 87) + '…' : firstSentence;
}
```

90 chars instead of 140 → fits 2 lines on standard tile width without mid-word cut.

### 7.6 Index-stats fetch in AircraftIndex

```jsx
const [stats, setStats] = useState({});
const [popular, setPopular] = useState([]);

useEffect(() => {
  let active = true;
  fetch('/api/aircraft/index-stats')
    .then(r => r.ok ? r.json() : null)
    .then(body => {
      if (!active || !body) return;
      setStats(body.stats ?? {});
      setPopular(Array.isArray(body.popular) ? body.popular : []);
    })
    .catch(() => {});
  return () => { active = false; };
}, []);
```

Tile renders `stats[item.slug]?.routeCount ?? '—'` — handles loading state
gracefully (em-dash until fetch resolves).

---

## §8 Roll-out, testing, follow-ups

### 8.1 Branch + commit order

Branch from updated main (after PR #72 merges). Single feature branch
`feat/landing-redesign`.

**Phase A — Foundation (shared components + tokens)**
1. `feat(landing): SectionHeader shared component`
2. `feat(landing): DataCard sticky sidebar component`
3. `chore(landing): editorial CSS pass — Source Serif H1, demoted indigo CTA, hairline rhythm`

**Phase B — Aircraft landing**
4. `feat(aircraft-data): extend families with engines/capacity/firstFlight/status`
5. `fix(aircraft-map): embed mode prop — clicks open modal, no SPA navigation`
6. `feat(aircraft-landing): 12-col grid + DataCard sidebar + numbered sections`
7. `feat(aircraft-landing): slug-fallback content normalization + map empty state`

**Phase C — Route landing**
8. `feat(api): /api/map/route-brief endpoint`
9. `feat(route-landing): hero stat strip (mono key/value)`
10. `feat(route-landing): AircraftMix bar component`
11. `feat(route-landing): wire route-brief data into stat strip + AircraftMix`
12. `fix(route-operators): proper table headers + explicit empty state`

**Phase D — `/by-aircraft` polish**
13. `feat(api): /api/aircraft/index-stats endpoint`
14. `feat(aircraft-index): tile quant strip + Most-flown rail`
15. `fix(aircraft-index): mobile filter scroll-snap + fade gradient`
16. `chore(build): tagline length cap 90 chars`

**Phase E — Final**
17. Manual smoke + push + PR description update

Single PR → merge → GitHub Actions deploy.

### 8.2 Manual smoke checklist

**Aircraft landings:**
- [ ] `/aircraft/boeing-787` H1 in Source Serif (not sans-serif).
- [ ] DataCard sidebar visible on desktop, sticky on scroll.
- [ ] DataCard mobile becomes static (stacks under main).
- [ ] All 6 sections numbered (`01 / OVERVIEW`, `02 / OPERATORS`, etc.) with hairlines.
- [ ] CTA navy (not indigo).
- [ ] `/aircraft/airbus-a319` (slug without bespoke JSON) renders fallback content + DataCard, doesn't collapse.
- [ ] Embedded route map click → modal popover, NOT SPA navigation.
- [ ] Route map empty state copy when 0 routes.

**Route landings:**
- [ ] `/routes/lhr-jfk` hero stat strip shows TYPICAL · FREQUENCY · FROM (or em-dash).
- [ ] AircraftMix bar — share-of-flights visual.
- [ ] RouteOperators with proper table headers (`CARRIER · FLIGHTS / 90D · SAFETY EVENTS`).
- [ ] Empty state copy when no operator/aircraft data — no silent drops.

**`/by-aircraft`:**
- [ ] "MOST FLOWN · LAST 14 DAYS" rail above grid.
- [ ] Each tile shows quant strip (`47 ROUTES · 12 OPS · 0 EVENTS / 90D`).
- [ ] Mobile filter chips scroll horizontally (Regional/Turboprop reachable via swipe).
- [ ] Tagline not truncated mid-word.

**Cross-page consistency:**
- [ ] H1 typography identical on `/aircraft/*`, `/routes/*`, `/by-aircraft`.
- [ ] CTA color identical (navy).

### 8.3 Performance

Spec #1 + #2 + #3 main bundle: ~20.4 KB brotli. Spec #4 expected delta:
- New components: ~2 KB combined gzipped.
- CSS additions: ~1 KB.
- AircraftLandingPage logic: ~1 KB.
- Backend: zero impact on bundle.

**Budget:** home initial brotli ≤ 97 KB (96 budget after spec #3 + 1 KB headroom).

### 8.4 Rollback

`git revert <merge-sha>` + redeploy. New backend endpoints additive (no
schema changes). Travelpayouts integration optionally feature-flag-gated.

### 8.5 Known follow-ups

| # | Issue | Future spec |
|---|-------|------|
| 1 | Replace AircraftRouteMap Leaflet runtime with SVG/PNG | Spec #6 (perf pass) |
| 2 | `/airlines/<iata>` landing pages | Future spec |
| 3 | Live booking widget on route page | Out of roadmap |
| 4 | Route block time using actual flight_observations averages | Future, when data density justifies |
| 5 | Mono auto-detection in narrative prose | Future polish |
| 6 | "By manufacturer" filter on `/by-aircraft` | Future spec if data warrants |

---

## §9 Data flow

```
/aircraft/<slug>:
  ├─→ /api/aircraft/families  (existing) → resolve slug to family object
  │   (now extended with engines/capacity/firstFlight/status)
  │   └─→ DataCard sidebar
  ├─→ /content/landing/aircraft/<slug>.json (existing, may 404)
  │   └─→ buildFallbackCopy(family) when 404
  ├─→ /api/aircraft/routes?family=<slug> (existing)
  │   └─→ AircraftRouteMap embedded={true} OR empty state
  └─→ /api/safety/global/accidents (existing) — recent safety events block

/routes/<pair>:
  ├─→ /api/aircraft/airports/search (existing) — resolve dep+arr names
  ├─→ /api/map/route-brief?dep=&arr= (NEW)
  │   ├─→ depAirport coords → great-circle distance → blockTime estimate
  │   ├─→ db.countDistinctFlightsByRoute → frequencyDaily
  │   ├─→ db.observedAircraftByRoute → computeAircraftMix → top 5 with shares
  │   └─→ travelpayouts.fetchCheapestFare (1.5s timeout)
  ├─→ /api/map/route-operators?dep=&arr= (existing, spec #2) — RouteOperators table
  └─→ Hero stat strip + AircraftMix bar + (existing FAQ + chips)

/by-aircraft:
  ├─→ /content/aircraft-index.json (existing static, build-time, tagline length capped)
  └─→ /api/aircraft/index-stats (NEW)
      ├─→ stats: { slug → {routeCount, operatorCount, safetyCount90d} }
      └─→ popular: top 8 by 14d route count
```

---

## §10 Error handling

| Surface | Failure | Behavior |
|---------|---------|----------|
| `/api/aircraft/families` | network | family resolve fails; AircraftLandingPage shows existing 404-ish "aircraft not found" |
| `/content/landing/aircraft/<slug>.json` | 404 (most slugs) | buildFallbackCopy(family) — page renders DataCard + map + safety + related |
| `/api/aircraft/routes` | empty array | Map empty state with link to /by-aircraft |
| `/api/aircraft/routes` | network/5xx | Same empty state as 0 routes |
| `/api/map/route-brief` | network/5xx | Stat strip silently hides (returns null on routeBrief) |
| Travelpayouts within route-brief | timeout/5xx | cheapestFare null → stat strip shows `FROM —` |
| `/api/map/route-operators` | empty array | RouteOperators renders explicit empty-state copy |
| `/api/aircraft/index-stats` | network/5xx | Tiles render `—` for stats; popular rail hides |
| AircraftRouteMap embedded mode | dot click | Opens modal popover, never navigates |
| Modal popover | close (ESC, click outside, X button) | dismisses, stays on landing page |

---

## §11 Open questions

None blocking. Two implementation discoveries deferred to implementer:

1. **`travelpayoutsService.fetchCheapestFare`** — verify signature and
   fallback. If service exposes route-cheapest helper already, reuse;
   otherwise extend per memory `project_travelpayouts.md`.
2. **`db.countRoutesByAircraft` IN-clause** — pick approach (dynamic
   placeholders / loop+dedupe / temp table) based on codebase conventions.

---

## §12 Acceptance criteria

This spec is done when:

- [ ] AircraftLandingPage renders 12-col grid with sticky DataCard sidebar.
- [ ] DataCard shows Manufacturer / Type / Engines / Range / Capacity / First flight / Status.
- [ ] All 20 aircraft families have `engines`/`capacity`/`firstFlight`/`status` populated in `aircraftFamilies.js`.
- [ ] Slug without bespoke JSON renders fallback content (Hero + DataCard + safety + map + related).
- [ ] AircraftRouteMap embedded click opens modal popover, not SPA navigation.
- [ ] Aircraft route map renders explicit empty state when 0 routes.
- [ ] All 6 sections on aircraft + 5 sections on route landings carry numbered eyebrows + hairlines.
- [ ] H1 uses Source Serif 4 weight 600 on all landing pages.
- [ ] Primary CTA uses navy fill (not indigo).
- [ ] RouteLandingPage hero shows TYPICAL · FREQUENCY · FROM stat strip.
- [ ] AircraftMix component renders share-of-flights bars OR explicit empty state.
- [ ] RouteOperators renders proper `<thead>` headers + explicit empty state.
- [ ] `/by-aircraft` tiles render `N ROUTES · M OPS · K EVENTS / 90D` strip.
- [ ] `/by-aircraft` mobile filter chips scroll horizontally without cutoff.
- [ ] "MOST FLOWN · LAST 14 DAYS" rail visible above grid.
- [ ] All client tests pass (1 pre-existing AuthModal flake from earlier specs allowed).
- [ ] `npm run build` succeeds; main brotli ≤ 97 KB.
- [ ] Manual smoke checklist (§8.2) passes in Chrome and Safari iOS.
