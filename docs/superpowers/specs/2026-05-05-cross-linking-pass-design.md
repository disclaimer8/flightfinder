# Site redesign — Cross-linking pass

**Status:** Draft
**Date:** 2026-05-05
**Owner:** Denys Kolomiiets
**Scope:** Second spec of the 7-part site redesign roadmap. Builds on
[Foundation](./2026-05-05-site-redesign-foundation-design.md) (PR #70).

---

## Context

Independent audits in spec #1 converged on this finding (PM-finding #4): pages
on FlightFinder are coherent islands but not a connected product. A user on
`/aircraft/boeing-787` cannot reach the safety record of that aircraft type
from the page; a user on a `SafetyEventDetail` cannot pivot to flights on the
same aircraft or other events from the same operator; a free user running a
search has no in-context signal that Pro enriched data exists.

This spec turns the existing pages into a connected graph by adding 6 targeted
cross-links and surfacing the Pro upgrade path at the natural moment of
intent.

## Goals

1. Every safety event with a known aircraft model links to its `/aircraft/<slug>`
   landing page.
2. Every safety event with a known operator links to that operator's full
   `/safety/global?op=<code>` history.
3. The inline `OperatorSafetyBlock` (rendered on FlightCard) becomes a
   gateway to the operator's full safety history, not a dead-end summary.
4. `RouteLandingPage` shows top operators on the route + their 90-day safety
   record — turning the route page from a thin SEO doorway into a real
   research destination.
5. Free users running a flight search see what Pro adds, with a contextual
   CTA at the moment of intent (inside the FlightCard).

## Non-goals

- `/airlines/<iata>` landing pages (researcher journey #2 from PM-audit) —
  future spec.
- Backend data fixes for empty-state SafetyFeed cards — spec #3.
- Embedded route map fix on `AircraftLandingPage` — spec #4.
- New analytics events for Pro-prompt conversion tracking.
- Visual redesign of FlightCard / OperatorSafetyBlock / SafetyEventDetail
  beyond what these inline cross-links require.

---

## §1 Architecture summary

| # | File | Change | Touches backend |
|---|------|--------|-----------------|
| 1.1 | `client/src/components/OperatorSafetyBlock.jsx` | Add `?op=<iata\|icao>` to existing `/safety/global` link | No |
| 1.2 | `client/src/utils/aircraftFamilies.js` | New utility for `model → familySlug` matching | No |
| 1.3 | `client/public/content/aircraft-family-models.json` | New build-step output (extends `build-aircraft-index.js`) | No |
| 1.4 | `client/src/pages/safety/SafetyEventDetail.jsx` | Add 2 inline cross-links (aircraft + operator) | No |
| 1.5 | `server/src/controllers/mapController.js` | New `getRouteOperators` controller | Yes |
| 1.6 | `server/src/routes/map.js` | Register `/api/map/route-operators` | Yes |
| 1.7 | `client/src/components/RouteOperators.jsx` | New tabular component for RouteLandingPage | No |
| 1.8 | `client/src/components/RouteLandingPage.jsx` | Render `<RouteOperators>` | No |
| 1.9 | `client/src/components/EnrichedTeaser.jsx` | New Pro-upgrade teaser component | No |
| 1.10 | `client/src/components/EnrichedPanel.jsx` | Free-user branch renders `<EnrichedTeaser>` | No |
| 1.11 | `client/src/components/FlightResults.jsx` | Pass `showProTeaser={i === 0}` to first FlightCard | No |

7 client files modified, 4 new client files, 2 new server files, 1 modified
server file. Single feature branch / single PR / single deploy per
`feedback_deploy_batching`.

---

## §2 OperatorSafetyBlock + aircraft-family helper

### 2.1 OperatorSafetyBlock change

`client/src/components/OperatorSafetyBlock.jsx:90` currently:

```jsx
<Link to="/safety/global" className="operator-safety__link operator-safety__link--global">
  View all events →
</Link>
```

Replace with:

```jsx
<Link
  to={`/safety/global?op=${encodeURIComponent(iataCode || icaoCode || '')}`}
  className="operator-safety__link operator-safety__link--global"
>
  View all events →
</Link>
```

`iataCode` / `icaoCode` come from props that the component already consumes.
If the codes are empty (rare), fall through to `/safety/global` with empty
`?op=` — the destination page silently ignores invalid filters.

`SafetyGlobal` already accepts `?op=<code>` URL param (verified by PM-audit;
the page has an `op` filter). No backend changes needed.

### 2.2 Client-side family-matching utility

New file `client/src/utils/aircraftFamilies.js`:

```js
let _families = null;
let _promise = null;

export function loadFamilies() {
  if (_families) return Promise.resolve(_families);
  if (_promise) return _promise;
  _promise = fetch('/content/aircraft-family-models.json')
    .then(r => r.ok ? r.json() : [])
    .then(data => { _families = data; return data; })
    .catch(() => { _families = []; return []; });
  return _promise;
}

export function findFamilySlugForModel(model, families) {
  if (!model || !Array.isArray(families)) return null;
  const m = String(model);
  for (const fam of families) {
    if (!Array.isArray(fam.modelPrefixes)) continue;
    for (const prefix of fam.modelPrefixes) {
      if (m.toLowerCase().startsWith(String(prefix).toLowerCase())) return fam.slug;
    }
  }
  return null;
}

// Test-only reset
export function _resetForTests() {
  _families = null;
  _promise = null;
}
```

Single shared promise (same pattern as `useFilterOptions` from spec #1).

### 2.3 Build-step extension

Modify `scripts/build-aircraft-index.js` (created in spec #1 task 10):

```js
// at the top, expose famDict for prefix extraction
const { families: famDict, getFamilyList } = require(FAMILIES_FILE);

// after the existing main() that writes aircraft-index.json,
// also write aircraft-family-models.json:

const familyModels = families.map(f => {
  const famData = famDict[f.label] || famDict[f.name] || {};
  const codes = famData.codes ? Array.from(famData.codes) : [];
  // Prefixes used for prefix-match against safety-event aircraft_model strings.
  // Order matters — most specific (full family label) first.
  const labelPrefix = f.label.split(' (')[0]; // strip " (all variants)"
  return {
    slug: f.slug,
    label: f.label,
    modelPrefixes: [labelPrefix, ...codes],
  };
});

const MODELS_OUTPUT = path.join(REPO_ROOT, 'client', 'public', 'content', 'aircraft-family-models.json');
fs.writeFileSync(MODELS_OUTPUT, JSON.stringify(familyModels, null, 2) + '\n', 'utf8');
console.log(`[build-aircraft-index] wrote ${familyModels.length} family-model entries → ${path.relative(REPO_ROOT, MODELS_OUTPUT)}`);
```

Same `prebuild` hook in `client/package.json` (already wired in spec #1) regenerates both files on every Vite production build.

---

## §3 SafetyEventDetail cross-links

`client/src/pages/safety/SafetyEventDetail.jsx`. The existing `<dl>`
definitions list renders Operator/Aircraft/Phase fields. Augment two of them
with conditional inline cross-links.

### 3.1 State

```jsx
import { loadFamilies, findFamilySlugForModel } from '../../utils/aircraftFamilies';

// inside SafetyEventDetail():
const [familySlug, setFamilySlug] = useState(null);

useEffect(() => {
  if (!event?.aircraft?.model) return;
  let active = true;
  loadFamilies().then(list => {
    if (!active) return;
    setFamilySlug(findFamilySlugForModel(event.aircraft.model, list));
  });
  return () => { active = false; };
}, [event?.aircraft?.model]);
```

### 3.2 Aircraft row

Current:
```jsx
<div><dt>Aircraft</dt><dd>{event.aircraft.model || '—'}</dd></div>
```

After:
```jsx
<div>
  <dt>Aircraft</dt>
  <dd>
    {event.aircraft.model || '—'}
    {familySlug && (
      <Link to={`/aircraft/${familySlug}`} className="safety-detail__crosslink">
        View aircraft history →
      </Link>
    )}
  </dd>
</div>
```

### 3.3 Operator row

Current:
```jsx
<div><dt>Operator</dt><dd>{event.operator.name || event.operator.icao || '—'}</dd></div>
```

After:
```jsx
<div>
  <dt>Operator</dt>
  <dd>
    {event.operator.name || event.operator.icao || '—'}
    {(event.operator.iata || event.operator.icao) && (
      <Link
        to={`/safety/global?op=${encodeURIComponent(event.operator.iata || event.operator.icao)}`}
        className="safety-detail__crosslink"
      >
        All events from this operator →
      </Link>
    )}
  </dd>
</div>
```

### 3.4 CSS

Add to `client/src/pages/safety/SafetyEventDetail.css`:

```css
.safety-detail__crosslink {
  display: block;
  margin-top: 4px;
  font: 500 13px var(--font-ui);
  color: var(--link);
  text-decoration: none;
}

.safety-detail__crosslink:hover {
  text-decoration: underline;
}
```

### 3.5 Edge cases

- Aircraft model is `null` / "Other" / "Unknown" → no family match → link
  silently omitted.
- Operator has neither `iata` nor `icao` → operator link silently omitted.
- These match the empty-state contract from `RecentSafetyEvents` in spec #1
  (em-dash, no fake data).

---

## §4 `/api/map/route-operators` + `<RouteOperators>`

### 4.1 Backend endpoint

**File:** `server/src/controllers/mapController.js` (modify).

```js
// ─── GET /api/map/route-operators?dep=LHR&arr=JFK ─────────────────────────────
// Returns up to 5 operators observed on the route in the last 90 days,
// each with its 90-day safety event count. Used by RouteLandingPage.
// Response shape:
//   { dep, arr, windowDays, operators: [{ iata, icao, name, count, safetyCount90d }] }
exports.getRouteOperators = (req, res) => {
  const dep = String(req.query.dep || '').toUpperCase();
  const arr = String(req.query.arr || '').toUpperCase();
  if (!/^[A-Z]{3}$/.test(dep) || !/^[A-Z]{3}$/.test(arr) || dep === arr) {
    return res.status(400).json({ success: false, message: 'dep and arr IATA codes required (3 letters, distinct)' });
  }

  const windowDays = 90;
  const cacheKey = `map:route-operators:${dep}:${arr}:${windowDays}`;
  const cached = cacheService.get(cacheKey);
  if (cached) return res.json(cached);

  try {
    const sinceMs = Date.now() - windowDays * 86400000;
    const rows = db.observedAircraftByRoute(dep, arr, sinceMs) || [];

    const byOp = new Map();
    for (const r of rows) {
      const key = r.airline_iata || r.airline_icao || r.airline_name;
      if (!key) continue;
      const existing = byOp.get(key) || {
        iata: r.airline_iata || null,
        icao: r.airline_icao || null,
        name: r.airline_name || null,
        count: 0,
      };
      existing.count += 1;
      byOp.set(key, existing);
    }

    const topOps = [...byOp.values()].sort((a, b) => b.count - a.count).slice(0, 5);

    const enriched = topOps.map(op => {
      const safetyCount = safety.countByOperator({
        iata: op.iata,
        icao: op.icao,
        sinceMs: Date.now() - 90 * 86400000,
      });
      return { ...op, safetyCount90d: safetyCount?.total ?? 0 };
    });

    const payload = { success: true, dep, arr, windowDays, operators: enriched };
    cacheService.set(cacheKey, payload, 30 * 60 * 1000); // 30 min
    res.json(payload);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
```

Imports needed (add to top of `mapController.js` if not present):
```js
const safety = require('../models/safetyEvents');
```
or whichever module exposes `countByOperator` — verify the existing import in
`server/src/controllers/safetyController.js`.

**File:** `server/src/routes/map.js` (modify):

```js
router.get('/route-operators', ctrl.getRouteOperators);
```

### 4.2 Implementation prerequisite — verify observation columns

Before writing the controller, the implementer must verify that
`db.observedAircraftByRoute()` rows include `airline_iata` / `airline_icao` /
`airline_name` columns. Check `server/src/models/observations.js`. If the
columns differ:

- If observations have `operator_iata` etc. → adapt key names.
- If observations only carry aircraft data (no airline) → escalate; we'd need
  to enrich at observation-write time or use a different source.

This is the main risk of the §4 backend work. Implementer should confirm
schema before writing the controller.

### 4.3 Frontend component

**New file:** `client/src/components/RouteOperators.jsx`:

```jsx
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { API_BASE } from '../utils/api';
import './RouteOperators.css';

export default function RouteOperators({ from, to }) {
  const [ops, setOps] = useState(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!from || !to) return;
    let active = true;
    fetch(`${API_BASE}/api/map/route-operators?dep=${from}&arr=${to}`)
      .then(r => r.ok ? r.json() : Promise.reject(r.statusText))
      .then(body => {
        if (!active) return;
        const list = Array.isArray(body?.operators) ? body.operators : [];
        if (list.length === 0) setError(true);
        else setOps(list);
      })
      .catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [from, to]);

  if (error) return null;
  if (!ops) {
    return (
      <section className="route-ops" aria-busy="true">
        <div className="route-ops__loading">Loading operators…</div>
      </section>
    );
  }

  return (
    <section className="route-ops" aria-label="Operators on this route">
      <div className="route-ops__head">
        <span className="route-ops__eyebrow">OPERATORS ON THIS ROUTE</span>
        <span className="route-ops__sub">Last 90 days · top {ops.length}</span>
      </div>
      <table className="route-ops__table">
        <tbody>
          {ops.map(op => {
            const code = op.iata || op.icao;
            return (
              <tr key={code}>
                <td className="route-ops__name">{op.name || code}</td>
                <td className="route-ops__count">{op.count} flights</td>
                <td className="route-ops__safety">
                  {op.safetyCount90d > 0 ? (
                    <Link to={`/safety/global?op=${encodeURIComponent(code)}`} className="route-ops__safety-link">
                      {op.safetyCount90d} safety event{op.safetyCount90d === 1 ? '' : 's'} →
                    </Link>
                  ) : (
                    <span className="route-ops__safety-none">No recorded events</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
```

### 4.4 CSS

**New file:** `client/src/components/RouteOperators.css`:

```css
.route-ops {
  max-width: 880px;
  margin: 32px 0;
}

.route-ops__head {
  display: flex;
  align-items: baseline;
  gap: 16px;
  margin-bottom: 12px;
}

.route-ops__eyebrow {
  font: 500 11px var(--font-mono);
  letter-spacing: 0.08em;
  color: var(--text-2);
}

.route-ops__sub {
  font: 400 12px var(--font-mono);
  color: var(--text-3);
}

.route-ops__table {
  width: 100%;
  border-collapse: collapse;
  font: 400 14px var(--font-ui);
}

.route-ops__table tr { border-bottom: 1px solid var(--border-light); }
.route-ops__table tr:last-child { border-bottom: 0; }
.route-ops__table td { padding: 12px 8px; vertical-align: middle; color: var(--text); }

.route-ops__name { font-weight: 500; }
.route-ops__count { font-family: var(--font-mono); color: var(--text-2); width: 140px; }
.route-ops__safety { width: 240px; text-align: right; }

.route-ops__safety-link {
  font: 500 13px var(--font-ui);
  color: var(--link);
  text-decoration: none;
}

.route-ops__safety-link:hover { text-decoration: underline; }

.route-ops__safety-none {
  font: 400 13px var(--font-ui);
  color: var(--text-3);
}

.route-ops__loading {
  padding: 16px 0;
  font: 400 14px var(--font-ui);
  color: var(--text-2);
}

@media (max-width: 640px) {
  .route-ops__safety { width: auto; }
  .route-ops__count { width: auto; }
}
```

### 4.5 Wire-up in RouteLandingPage

`client/src/components/RouteLandingPage.jsx`. Import:

```jsx
import RouteOperators from './RouteOperators';
```

Render between the "About this route" section and the "Other aircraft you can
search" rail (which currently exists per spec #1 task 13). Exact placement is
the implementer's call but it should appear after the route description and
before the cross-link rail.

```jsx
<RouteOperators from={from.iata} to={to.iata} />
```

### 4.6 Edge cases

- Route with zero observations in last 90 days → endpoint returns empty array
  → component returns `null` (silent hide). Don't show users an empty section.
- Operator with `safetyCount90d === 0` → render "No recorded events" text
  (not a link). This is a positive signal worth showing — symmetry with
  events present makes the 0-case a feature, not an absence.
- Cache TTL 30 min via existing `cacheService` (matches `route-aircraft`
  cache pattern from `mapController.js`).

---

## §5 `<EnrichedTeaser>` Pro upgrade

### 5.1 Behavior

`EnrichedPanel` currently renders enriched data (livery, on-time, CO2) when
all of: feature flag enabled, user is Pro, data fetch successful. Free users
see nothing. We change the no-Pro branch to render `<EnrichedTeaser />`.

| User state | Render |
|------------|--------|
| Pro user | Existing enriched data (no change) |
| Free user, enriched feature enabled | `<EnrichedTeaser />` |
| Pro feature disabled (kill-switch) | Nothing (current behavior) |

### 5.2 Component

**New file:** `client/src/components/EnrichedTeaser.jsx`:

```jsx
import { Link } from 'react-router-dom';
import './EnrichedTeaser.css';

const FEATURES = [
  'Airline livery + aircraft photo',
  'On-time performance for this exact flight',
  'CO₂ estimate by class',
  'Delay prediction for departure',
];

export default function EnrichedTeaser() {
  return (
    <div className="enriched-teaser" role="region" aria-label="Pro features preview">
      <div className="enriched-teaser__head">
        <span className="enriched-teaser__eyebrow">ENRICHED FLIGHT DATA</span>
        <span className="enriched-teaser__badge">Pro</span>
      </div>
      <ul className="enriched-teaser__list">
        {FEATURES.map(f => <li key={f}>{f}</li>)}
      </ul>
      <Link to="/pricing" className="enriched-teaser__cta">
        Unlock for $4.99/mo →
      </Link>
    </div>
  );
}
```

### 5.3 CSS

**New file:** `client/src/components/EnrichedTeaser.css`:

```css
.enriched-teaser {
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  padding: 16px;
  background: var(--card);
  margin-top: 12px;
}

.enriched-teaser__head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.enriched-teaser__eyebrow {
  font: 500 11px var(--font-mono);
  letter-spacing: 0.08em;
  color: var(--text-2);
}

.enriched-teaser__badge {
  font: 500 10px var(--font-mono);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  background: var(--primary);
  color: white;
  padding: 2px 8px;
  border-radius: var(--r-sm);
}

.enriched-teaser__list {
  list-style: none;
  padding: 0;
  margin: 0 0 12px;
}

.enriched-teaser__list li {
  font: 400 14px/1.5 var(--font-ui);
  color: var(--text);
  padding: 4px 0;
  position: relative;
  padding-left: 16px;
}

.enriched-teaser__list li::before {
  content: '·';
  position: absolute;
  left: 4px;
  color: var(--text-3);
  font-weight: 700;
}

.enriched-teaser__cta {
  display: inline-block;
  font: 500 14px var(--font-ui);
  color: var(--link);
  text-decoration: none;
}

.enriched-teaser__cta:hover { text-decoration: underline; }
```

### 5.4 Wire-up in EnrichedPanel

`client/src/components/EnrichedPanel.jsx`. Add early-return for free users.
The exact `isPro` check matches the existing pattern in this codebase — likely
`user?.tier` from `AuthContext`. Implementer must locate and reuse the
existing pro-detection helper rather than introduce a new one.

```jsx
import { useAuth } from '../context/AuthContext';
import EnrichedTeaser from './EnrichedTeaser';

export default function EnrichedPanel({ showProTeaser, ...rest }) {
  const { user } = useAuth();
  const isPro = /* match existing isPro helper for client side */;

  if (!isPro) {
    return showProTeaser ? <EnrichedTeaser /> : null;
  }

  // existing Pro rendering ...
}
```

### 5.5 Anti-fatigue — first card only

`<EnrichedTeaser>` shows only on the first FlightCard in the result list,
not on every one. Mechanism:

`client/src/components/FlightResults.jsx` — pass `showProTeaser={i === 0}` to
`<FlightCard>`:

```jsx
{flights.map((flight, i) => (
  <FlightCard key={flight.id ?? i} flight={flight} showProTeaser={i === 0} ... />
))}
```

`FlightCard` forwards `showProTeaser` to `EnrichedPanel`:

```jsx
<EnrichedPanel ... showProTeaser={showProTeaser} />
```

Free users see one teaser per result page, top of list. Pro users still get
enriched data on every card.

### 5.6 Edge cases

- User logs in / upgrades to Pro mid-session → `useAuth` re-renders
  EnrichedPanel; teaser disappears, real data renders. No reload needed.
- Single-flight result → first-card teaser still shown.
- Empty results → nothing renders (no FlightCard at all).

---

## §6 Roll-out, testing, follow-ups

### 6.1 Branch / commit order

Single feature branch `feat/cross-linking-pass`, sequential commits:

1. **chore(build): emit aircraft-family-models.json** — extends existing
   `build-aircraft-index.js` script.
2. **feat(utils): aircraft-family slug matching helper** — `aircraftFamilies.js` + tests.
3. **fix(operator-safety): ?op= deeplink to /safety/global** — small
   `OperatorSafetyBlock.jsx` change.
4. **feat(safety-detail): aircraft + operator cross-links** — SafetyEventDetail with the two new links + CSS.
5. **feat(api): /api/map/route-operators endpoint** — server controller +
   route + cache wiring.
6. **feat(route-landing): RouteOperators table** — new component + RouteLandingPage wire-up.
7. **feat(pricing): EnrichedTeaser component** — new component + CSS + tests.
8. **feat(pricing): EnrichedPanel renders teaser for free users** — wire teaser into EnrichedPanel + first-card propagation through FlightResults.

Single PR → merge → GitHub Actions deploy.

### 6.2 Manual smoke

Run `cd client && npm run start` + a backend with a populated `observations`
table. Walk through:

- [ ] FlightCard with operator → click "View all events →" in OperatorSafetyBlock
      → lands on `/safety/global?op=BA` (or whatever IATA) with the operator
      filter active.
- [ ] `/safety/events/<known-id>` for an event with a known aircraft model
      (e.g. Boeing 737-800) → "View aircraft history →" link visible →
      navigates to `/aircraft/boeing-737`.
- [ ] Same event with `iata` → "All events from this operator →" link
      visible → navigates to `/safety/global?op=<iata>`.
- [ ] Safety event with no aircraft match (e.g. "Cessna 172") → no "View
      aircraft history" link.
- [ ] `/routes/lhr-jfk` → "OPERATORS ON THIS ROUTE" section renders ≥ 1
      operator with flight count and safety summary.
- [ ] Operator with 0 safety events → "No recorded events" text (not a
      broken link).
- [ ] `/routes/zzz-yyy` (unobserved route) → RouteOperators section silently
      hidden (component returns null).
- [ ] Free user runs a search → first FlightCard shows EnrichedTeaser
      with "Unlock for $4.99/mo →" → click → `/pricing`.
- [ ] Same search, same user, FlightCards 2-N → no teaser (anti-fatigue).
- [ ] Pro user runs the same search → all cards render full enriched data,
      no teaser anywhere.

### 6.3 Automated tests

- `client/src/utils/__tests__/aircraftFamilies.test.js` — `findFamilySlugForModel`
  with various inputs (exact match, prefix match, miss, null).
- `client/src/components/__tests__/RouteOperators.test.jsx` — fetch fixture,
  empty fixture, error fallback, link href.
- `client/src/components/__tests__/EnrichedTeaser.test.jsx` — renders
  4 features, CTA links to `/pricing`, badge says "Pro".
- `client/src/pages/safety/__tests__/SafetyEventDetail.crosslinks.test.jsx`
  (or extend existing test if any) — aircraft link present when family
  matches, absent when no match; operator link present when iata/icao
  available.
- Server: `server/test/route-operators.test.js` (if test infra exists for
  controllers; skip if not — rely on manual smoke).

### 6.4 Performance

- New `/api/map/route-operators` endpoint: cached 30 min, single SQL via
  existing `db.observedAircraftByRoute`, plus 5 small `safety.countByOperator`
  lookups. Expected p95 < 50ms server-side.
- Client: `loadFamilies()` fetches `/content/aircraft-family-models.json`
  (~5KB, CDN-cached `immutable 1y` per existing nginx config). One fetch per
  session.
- `EnrichedTeaser` adds ~1KB JS+CSS to the FlightCard chunk. Not in home
  initial bundle.
- `RouteOperators` is part of the lazy `RouteLandingPage` chunk — no impact
  on home initial.

### 6.5 Rollback

All changes ship in one PR. Rollback = `git revert <merge-sha>` + redeploy.

The new `/api/map/route-operators` endpoint is purely additive — no schema
changes, no data migrations. Reverting the PR removes the route safely.

---

## §7 Data flow

```
User on /safety/events/123
  └─→ event fetched from /api/safety/events/123 (existing)
      └─→ aircraft.model = "Boeing 737-800"
          └─→ loadFamilies() fetches /content/aircraft-family-models.json (cached)
              └─→ findFamilySlugForModel() → "boeing-737"
                  └─→ <Link to="/aircraft/boeing-737">

User on /routes/lhr-jfk
  └─→ RouteOperators fetches /api/map/route-operators?dep=LHR&arr=JFK
      └─→ controller: db.observedAircraftByRoute() → group by airline
          └─→ for each top-5: safety.countByOperator()
              └─→ response: [{iata,icao,name,count,safetyCount90d}]
                  └─→ table renders; each row links to /safety/global?op=

User (free) on FlightResults
  └─→ first FlightCard receives showProTeaser=true
      └─→ EnrichedPanel detects !isPro
          └─→ renders <EnrichedTeaser />
              └─→ "Unlock for $4.99/mo →" → /pricing
```

---

## §8 Error handling

| Surface | Failure mode | Behavior |
|---------|--------------|----------|
| `/content/aircraft-family-models.json` | 404 / network | `loadFamilies()` resolves to `[]`. Cross-links silently omitted. |
| `/api/map/route-operators` | non-2xx / network | RouteOperators sets `error=true` → returns null (section hidden). |
| `/api/map/route-operators` | empty `operators` array | Same as fetch error: section hidden. Don't show "no operators found". |
| `safety.countByOperator` throws | Server-side try/catch returns 500. Client treats as fetch error → section hidden. |
| EnrichedPanel + `/pricing` not reachable in native app | Existing native-app gating in EnrichedPanel still applies; teaser respects same gate (no Pricing link in native). Implementer must check existing native-app branch. |

---

## §9 Known follow-ups (next specs)

| # | Issue | Spec |
|---|-------|------|
| 1 | `/airlines/<iata>` landing pages don't exist | Future spec, not in roadmap |
| 2 | SafetyFeed cards 100% empty-state | Spec #3 |
| 3 | `/aircraft/<slug>` embedded route map blank | Spec #4 |
| 4 | `/safety/global` mobile filter rail too wide | Spec #3 |
| 5 | EnrichedTeaser anti-fatigue is per-page-load only — no session-level dismiss tracking | Future iteration if conversion data warrants |

---

## §10 Open questions

None. Implementation choices that came up during brainstorming were resolved:

- Top-N operators: 5
- Operators with 0 safety events: render "No recorded events" text (positive signal)
- Pro-teaser frequency: first card only (anti-fatigue)
- Pro-teaser style: explicit feature list with price (not blurred imitation)
- Cross-link CSS placement: block-level inline under `<dd>` value (not
  separate Related row)

---

## §11 Acceptance criteria

This spec is done when:

- [ ] OperatorSafetyBlock link points to `/safety/global?op=<code>`
- [ ] SafetyEventDetail renders `View aircraft history →` link when aircraft
      model matches a known family
- [ ] SafetyEventDetail renders `All events from this operator →` link when
      operator iata or icao is available
- [ ] `/api/map/route-operators?dep=&arr=` returns top-5 operators with
      `safetyCount90d` field
- [ ] RouteLandingPage renders `<RouteOperators>` with operators table
- [ ] Operators with `safetyCount90d > 0` render as link to filtered
      `/safety/global?op=`
- [ ] Operators with 0 events render "No recorded events" text
- [ ] Free user's first FlightCard renders `<EnrichedTeaser>` with `/pricing`
      CTA
- [ ] Free user's 2nd-Nth FlightCards do NOT render the teaser
- [ ] Pro user sees full enriched data on all cards (no regression)
- [ ] All client tests pass
- [ ] Bundle size: home initial brotli ≤ 95 KB (current 92, +1 KB budget)
- [ ] Manual smoke checklist (§6.2) passes in Chrome and Safari iOS
