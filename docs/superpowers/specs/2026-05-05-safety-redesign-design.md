# Site redesign — Safety pages redesign + ingest enrichment

**Status:** Draft
**Date:** 2026-05-05
**Owner:** Denys Kolomiiets
**Scope:** Third spec of the 7-part site redesign roadmap. Builds on
[Foundation](./2026-05-05-site-redesign-foundation-design.md) +
[Cross-linking pass](./2026-05-05-cross-linking-pass-design.md) (PR #70).

---

## Context

UX Researcher (spec #1 audit) found that 100% of `/safety/feed` cards render
as `Other / Operator unknown / <tail>`. Root cause traced to
`server/src/services/safety/ntsbAdapter.js:138-142` — NTSB Carol v2 list-view
API stopped returning `cictt_category` and `operator_*` fields. The adapter
explicitly sets them to null with the comment "no longer in list view".

UI Designer (spec #1 audit) recommended a 4-column tabular redesign of
SafetyFeed cards (date | severity | aircraft | location/operator) using the
editorial aviation-industrial language already established in spec #1
(serif headlines, Inter Tight UI, IBM Plex Mono for tail numbers/ICAO codes,
em-dash for null fields).

UX Researcher also flagged `/safety/global` mobile breakage: filter rail
consumes ~60% of viewport at 390px, leaving the map as a postage stamp.

This spec addresses all three problems in one batch.

## Goals

1. SafetyFeed renders informative rows, not "Other / Operator unknown" walls.
2. SafetyFeed lead column communicates what the data IS (aircraft type,
   registration), not what it lacks (NTSB-dropped CICTT category).
3. SafetyGlobal is usable on a 390px mobile viewport.
4. NTSB ingestion attempts to recover dropped operator/CICTT via the
   detail-view API, behind a feature flag, with circuit-breaker safety.
5. SafetyEventDetail renders empty fields as `—` (em-dash), never as the
   string `"Operator unknown"` or `"N/A"`.

## Non-goals

- Backfill of existing 5,000+ rows — out of scope; one-off CLI if ever needed.
- SafetyFeed pagination / load-more.
- URL-state persistence for SafetyGlobal filters.
- "Related events" section in SafetyEventDetail.
- AirCrash sidecar enhancements (the global dataset is already populated).
- Any changes to AircraftLandingPage / RouteLandingPage / FlightCard.

---

## §1 Architecture summary

| # | File | Change | Touches backend |
|---|------|--------|-----------------|
| 1.1 | `client/src/pages/safety/SafetyFeed.jsx` | Replace `<ul>` of cards with `<table>` of rows | No |
| 1.2 | `client/src/pages/safety/SafetyFeed.css` | Tabular layout + severity dot + mobile-stack | No |
| 1.3 | `client/src/pages/safety/SafetyEventDetail.jsx` | Em-dash discipline; source attribution footer | No |
| 1.4 | `client/src/pages/safety/SafetyEventDetail.css` | Source footer styles | No |
| 1.5 | `client/src/pages/safety/SafetyGlobal.jsx` | Add `filtersCollapsed` state + auto-collapse | No |
| 1.6 | `client/src/pages/safety/SafetyGlobal.css` | Mobile collapsible filter toolbar styles | No |
| 1.7 | `server/src/services/safety/ntsbAdapter.js` | Add `fetchEventDetail`, `enrichWithDetail`, `resetDetailCircuitBreaker` | Yes |
| 1.8 | `server/src/__tests__/safety.ntsbAdapter.test.js` | Tests for circuit breaker + rate-limit + mock detail mapping | Yes |
| 1.9 | `server/src/workers/safetyIngestionWorker.js` | Wire `enrichWithDetail` into batch loop, gated by `SAFETY_DETAIL_ENRICHMENT_ENABLED` | Yes |
| 1.10 | `.github/workflows/deploy.yml` | Add `SAFETY_DETAIL_ENRICHMENT_ENABLED` secret | Deploy config |

7 client/server files modified, 1 test file extended, 1 deploy config update.
Single feature branch / single PR.

---

## §2 SafetyFeed — 4-column tabular redesign

### 2.1 Layout

Replace existing `<ul className="safety-feed__list">` (renders cards) with a
table:

```jsx
<table className="safety-feed__table">
  <thead>
    <tr>
      <th className="sf-col-date">Date</th>
      <th className="sf-col-severity">Severity</th>
      <th className="sf-col-aircraft">Aircraft</th>
      <th className="sf-col-route">Route / Location</th>
    </tr>
  </thead>
  <tbody>
    {events.map(e => (
      <tr key={e.id} className={`safety-feed__row safety-feed__row--${e.severity}`}>
        <td className="sf-col-date" onClick={() => navigate(`/safety/events/${e.id}`)}>
          {formatDate(e.occurredAt)}
        </td>
        <td className="sf-col-severity">
          <span className={`safety-feed__dot sf-dot--${e.severity}`} aria-hidden="true" />
          <span className="safety-feed__sev-label">{e.severityLabel}</span>
        </td>
        <td className="sf-col-aircraft">
          {dash(e.aircraft.icaoType)}
          {e.aircraft.registration && (
            <span className="safety-feed__reg"> {e.aircraft.registration}</span>
          )}
        </td>
        <td className="sf-col-route">
          <span className="safety-feed__iata">{dash(e.route.dep)}</span>
          <span className="safety-feed__arrow"> → </span>
          <span className="safety-feed__iata">
            {e.route.arr || e.location.country || '—'}
          </span>
        </td>
      </tr>
    ))}
  </tbody>
</table>
```

Whole row is wrapped in a `<Link>` for accessibility. The simplest pattern is
to use a single overlay link technique:

```jsx
<tr className="safety-feed__row">
  <td>...
    <Link to={`/safety/events/${e.id}`} className="safety-feed__row-link" aria-label={`View event ${e.id}`}>
      <span className="visually-hidden">View event</span>
    </Link>
  </td>
  ...
</tr>
```

with CSS `position: relative` on `<tr>` and `position: absolute; inset: 0` on
the link. Implementer can pick either approach (whole-row link via CSS
positioning, or per-cell link). Goal: entire row clickable.

### 2.2 Helpers

```js
function dash(v) { return v == null || v === '' ? '—' : v; }

function formatDate(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}
```

`formatDate` already exists in current SafetyFeed.jsx — reuse.

### 2.3 Color tokens

Reuse spec #1 severity tokens (`--sev-fatal`, `--sev-hull`, `--sev-incident`).

```js
const SEVERITY_DOT_CLASS = {
  fatal:            'sf-dot--fatal',
  hull_loss:        'sf-dot--hull',
  serious_incident: 'sf-dot--hull',
  incident:         'sf-dot--incident',
  minor:            'sf-dot--incident',
};
```

If the actual `e.severity` value isn't in the map, fall through to
`sf-dot--incident` (grey).

### 2.4 CSS

```css
.safety-feed__table {
  width: 100%;
  border-collapse: collapse;
  font: 400 14px var(--font-ui);
}

.safety-feed__table thead th {
  font: 500 11px var(--font-mono);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-2);
  text-align: left;
  padding: 0 8px 8px;
  border-bottom: 1px solid var(--border-light);
}

.safety-feed__row {
  border-bottom: 1px solid var(--border-light);
  position: relative;
  cursor: pointer;
  transition: background 100ms ease;
}

.safety-feed__row:hover {
  background: var(--accent-soft, var(--primary-light));
}

.safety-feed__row td {
  padding: 12px 8px;
  vertical-align: middle;
  color: var(--text);
}

.sf-col-date    { width: 110px; font-family: var(--font-mono); color: var(--text-2); }
.sf-col-severity { width: 200px; }
.sf-col-aircraft { /* flex */ }
.sf-col-route   { width: 220px; font-family: var(--font-mono); color: var(--text-2); white-space: nowrap; }

.safety-feed__dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-right: 8px;
  vertical-align: middle;
}

.sf-dot--fatal    { background: var(--sev-fatal); }
.sf-dot--hull     { background: var(--sev-hull); }
.sf-dot--incident { background: var(--sev-incident); }

.safety-feed__sev-label {
  font: 500 14px var(--font-ui);
}

.safety-feed__row--fatal .safety-feed__sev-label { font-weight: 600; }

.safety-feed__reg {
  font-family: var(--font-mono);
  color: var(--text-2);
  margin-left: 4px;
}

.safety-feed__arrow { color: var(--text-3); padding: 0 4px; }

.safety-feed__row-link {
  position: absolute;
  inset: 0;
  z-index: 1;
}

.safety-feed__row-link span {
  position: absolute;
  width: 1px; height: 1px;
  padding: 0; margin: -1px;
  overflow: hidden;
  clip: rect(0,0,0,0);
  border: 0;
}

@media (max-width: 640px) {
  .safety-feed__table thead { display: none; }
  .sf-col-aircraft, .sf-col-route { display: block; padding-left: 24px; }
  .safety-feed__row td.sf-col-date {
    display: inline-block;
    padding-bottom: 4px;
  }
  .safety-feed__row td.sf-col-severity {
    display: inline-block;
    padding-bottom: 4px;
    margin-left: 12px;
  }
  .sf-col-aircraft { padding-top: 0; padding-bottom: 4px; }
  .sf-col-route { padding-top: 0; padding-bottom: 12px; }
}
```

The mobile layout collapses to two visual lines per row:

```
2026-04-24  ●  Serious incident
   Boeing 737-800  N123BA
   LEMD → EHAM
```

### 2.5 Existing severity filter pills

Keep (`<nav className="safety-feed__filters">`). Update CSS only — match
spec #1 design language: `var(--font-ui)` 14px medium, active pill
`background: var(--navy); color: white;`, inactive `background: transparent;
color: var(--text-2); border: 1px solid var(--border)`.

### 2.6 Empty state

Existing `<p className="safety-feed__empty">No events match this filter.</p>`
stays as-is. Acceptable — already handles "no events" gracefully.

### 2.7 What we remove from the current cards

- `cicttLabel` as title (always renders "Other" because `cictt_category` is
  null on every NTSB row from list-view).
- `'Operator unknown'` literal text.
- Left colored border (`safety-card--<severity>`) — replaced by the dot.
- Card padding — replaced by table-row padding 12px 8px.

---

## §3 NTSB detail-view enrichment

### 3.1 Discovery prerequisite

Implementer must first **discover the detail endpoint** for NTSB Carol v2.
Open Chrome DevTools Network on `https://my.ntsb.gov/case/<sourceEventId>`
(replace with a real case ID like `WPR23LA001`). Look for the API call that
populates the detail panel — likely:

- `https://api.ntsb.gov/searchpub/api/Carol/v2/GetInvestigationDetail?id=<id>`
- OR `GetInvestigationsCustom` with body `{ ReportType: 'detail', CaseId: <id> }`
- OR something else entirely.

Document the discovered endpoint + response shape in the commit message and
in inline comments inside `ntsbAdapter.js`. The adapter already uses an Azure
APIM subscription key (line 17) which probably authenticates the same detail
endpoint.

**If discovery fails** — endpoint requires auth we don't have, or doesn't
exist publicly — escalate as BLOCKED. Skip §3 entirely. Sections 2, 4, 5 ship
without the data-pipeline fix; UI alone (em-dash discipline + tabular
redesign) makes the feed look honest about its data gaps.

### 3.2 Adapter changes

`server/src/services/safety/ntsbAdapter.js` — add three exports:

```js
let consecutiveDetailFails = 0;
const FAIL_THRESHOLD = 3;
const RATE_LIMIT_MS = 200;

async function fetchEventDetail(sourceEventId) {
  // POST or GET to the discovered endpoint.
  // Returns { operator_iata, operator_icao, operator_name, cictt_category }
  // OR throws on rate-limit / network error.
  //
  // Implementer fills in actual call after Step 3.1 discovery.
  // Example skeleton:
  //
  // const res = await axios.post(DETAIL_ENDPOINT, { CaseId: sourceEventId }, {
  //   headers: { 'Ocp-Apim-Subscription-Key': SUBSCRIPTION_KEY, 'Content-Type': 'application/json' },
  //   timeout: 15_000,
  //   validateStatus: () => true,
  // });
  // if (res.status !== 200) throw new Error(`NTSB detail ${res.status}`);
  // return parseDetailFields(res.data);
}

async function enrichWithDetail(event) {
  if (consecutiveDetailFails >= FAIL_THRESHOLD) return event;
  try {
    await new Promise(r => setTimeout(r, RATE_LIMIT_MS));
    const detail = await fetchEventDetail(event.source_event_id);
    consecutiveDetailFails = 0;
    return {
      ...event,
      operator_iata:  detail.operator_iata  ?? event.operator_iata,
      operator_icao:  detail.operator_icao  ?? event.operator_icao,
      operator_name:  detail.operator_name  ?? event.operator_name,
      cictt_category: detail.cictt_category ?? event.cictt_category,
    };
  } catch (err) {
    consecutiveDetailFails += 1;
    return event;
  }
}

function resetDetailCircuitBreaker() {
  consecutiveDetailFails = 0;
}

module.exports = {
  fetchPage,
  mapToSafetyEvent,
  parseVehicleDetails,
  parseLocation,
  parseUSDate,
  severityFromNew,
  fetchEventDetail,
  enrichWithDetail,
  resetDetailCircuitBreaker,
};
```

Note: existing `module.exports` block already lists `fetchPage`,
`mapToSafetyEvent`, etc. Just add the three new exports.

### 3.3 Feature flag

Read `SAFETY_DETAIL_ENRICHMENT_ENABLED` env at module-eval time:

```js
const DETAIL_ENRICHMENT_ENABLED =
  String(process.env.SAFETY_DETAIL_ENRICHMENT_ENABLED || '').toLowerCase() === 'true';

async function enrichWithDetail(event) {
  if (!DETAIL_ENRICHMENT_ENABLED) return event;
  // ... existing logic
}
```

Default off. Production turns on after smoke-verify the detail-view returns
expected shape.

### 3.4 Ingestion pipeline integration

The existing safety ingestion runner is `server/src/workers/safetyIngestionWorker.js`.
It calls `adapter.fetchPage(...)` then maps each row through `mapToSafetyEvent`
before upserting. Gated by `SAFETY_INGEST_ENABLED` (per `project_plan7_ntsb`
memory).

Modify the loop:

```js
adapter.resetDetailCircuitBreaker();

for (const row of rows) {
  const baseEvent = adapter.mapToSafetyEvent(row);
  const enrichedEvent = await adapter.enrichWithDetail(baseEvent);
  await safetyModel.upsertEvent(enrichedEvent);
}

logger.info(`[safety-ingest] enriched ${enrichedCount}/${rows.length} events with detail-view (circuit-breaker hit: ${cbHit ? 'yes' : 'no'})`);
```

Counter logic for `enrichedCount` and `cbHit` — implementer adds two counters
inside the loop:
- `enrichedCount` increments when `enrichedEvent.operator_iata` is non-null
  AND `baseEvent.operator_iata` was null (i.e., detail-view actually added data)
- `cbHit` becomes true when `consecutiveDetailFails` reaches threshold

### 3.5 Tests

Extend `server/src/__tests__/safety.ntsbAdapter.test.js`:

```js
describe('enrichWithDetail', () => {
  beforeEach(() => {
    adapter.resetDetailCircuitBreaker();
    process.env.SAFETY_DETAIL_ENRICHMENT_ENABLED = 'true';
  });

  it('returns original event when feature flag off', async () => {
    process.env.SAFETY_DETAIL_ENRICHMENT_ENABLED = 'false';
    const event = { source_event_id: 'X', operator_iata: null };
    const result = await adapter.enrichWithDetail(event);
    expect(result).toBe(event);
  });

  it('merges detail fields into event', async () => {
    jest.spyOn(adapter, 'fetchEventDetail').mockResolvedValue({
      operator_iata: 'BA', operator_icao: 'BAW', operator_name: 'British Airways', cictt_category: 'F-NI',
    });
    const event = { source_event_id: 'X', operator_iata: null };
    const result = await adapter.enrichWithDetail(event);
    expect(result.operator_iata).toBe('BA');
    expect(result.cictt_category).toBe('F-NI');
  });

  it('returns original event when detail fetch fails', async () => {
    jest.spyOn(adapter, 'fetchEventDetail').mockRejectedValue(new Error('500'));
    const event = { source_event_id: 'X', operator_iata: null };
    const result = await adapter.enrichWithDetail(event);
    expect(result).toEqual(event);
  });

  it('skips remaining events after 3 consecutive failures', async () => {
    jest.spyOn(adapter, 'fetchEventDetail').mockRejectedValue(new Error('500'));
    await adapter.enrichWithDetail({ source_event_id: '1' });
    await adapter.enrichWithDetail({ source_event_id: '2' });
    await adapter.enrichWithDetail({ source_event_id: '3' });
    const fetchSpy = adapter.fetchEventDetail;
    fetchSpy.mockClear();
    await adapter.enrichWithDetail({ source_event_id: '4' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('resetDetailCircuitBreaker clears the counter', async () => {
    jest.spyOn(adapter, 'fetchEventDetail').mockRejectedValue(new Error('500'));
    for (let i = 0; i < 3; i++) await adapter.enrichWithDetail({ source_event_id: String(i) });
    adapter.resetDetailCircuitBreaker();
    const fetchSpy = adapter.fetchEventDetail;
    fetchSpy.mockResolvedValueOnce({ operator_iata: 'BA' });
    fetchSpy.mockClear();
    await adapter.enrichWithDetail({ source_event_id: 'after-reset' });
    expect(fetchSpy).toHaveBeenCalledOnce();
  });
});
```

⚠️ Existing test file uses Jest patterns. The codebase has both Vitest
(client) and Jest (server). Match the existing server-side test convention
(check the file's existing imports — `jest.fn`, `jest.spyOn`, etc.).

### 3.6 Deploy config

Add `SAFETY_DETAIL_ENRICHMENT_ENABLED` to `.github/workflows/deploy.yml`
alongside the existing `SAFETY_INGEST_ENABLED` env var. Default value
`'false'` so a fresh deploy doesn't accidentally enable enrichment before
verifying the detail-view endpoint works.

---

## §4 SafetyGlobal mobile filter rail

### 4.1 State + auto-collapse

`client/src/pages/safety/SafetyGlobal.jsx`. Add at the top of the component:

```jsx
const [filtersCollapsed, setFiltersCollapsed] = useState(true);

// Auto-collapse on mobile when a filter is applied
useEffect(() => {
  if (typeof window === 'undefined') return;
  if (window.matchMedia('(max-width: 640px)').matches) {
    setFiltersCollapsed(true);
  }
}, [severity, category, op, era]);
```

The filter state variables (`severity`, `category`, `op`, `era`) already
exist in the page.

### 4.2 Filter summary helper

Add inside the file:

```js
function summarizeFilters({ severity, category, op, era }) {
  const parts = [];
  if (category) {
    const catLabel = CATEGORIES.find(c => c.value === category)?.label;
    if (catLabel) parts.push(catLabel);
  }
  if (op) parts.push(op);
  if (era && (era[0] !== ERA_DEFAULT[0] || era[1] !== ERA_DEFAULT[1])) {
    parts.push(`${era[0]}–${era[1]}`);
  }
  if (severity) parts.push(severity);
  return parts.length ? parts.join(' · ') : 'All';
}
```

### 4.3 Toolbar header

Locate the existing filter rail container (likely
`<aside className="safety-global__filters">` or similar). Wrap it:

```jsx
<aside
  className="safety-global__filters"
  data-collapsed={filtersCollapsed ? 'true' : 'false'}
>
  <button
    className="safety-global__filters-toggle"
    type="button"
    onClick={() => setFiltersCollapsed(c => !c)}
    aria-expanded={!filtersCollapsed}
    aria-controls="safety-global-filter-controls"
  >
    <span className="safety-global__filters-icon">⚙</span>
    <span className="safety-global__filters-label">Filters · {summarizeFilters({ severity, category, op, era })}</span>
    <span className={`safety-global__filters-chevron${filtersCollapsed ? '' : ' safety-global__filters-chevron--open'}`}>▼</span>
  </button>

  <div
    id="safety-global-filter-controls"
    className="safety-global__filter-controls"
  >
    {/* existing filter UI: severity pills, era slider, category dropdown,
        operator typeahead, aircraft model dropdown */}
  </div>
</aside>
```

The toggle button is **only visible on mobile** (CSS hides on >640px). On
desktop the rail behaves as before.

### 4.4 CSS

Add to `client/src/pages/safety/SafetyGlobal.css`:

```css
.safety-global__filters-toggle {
  display: none; /* hidden on desktop */
}

@media (max-width: 640px) {
  .safety-global__filters {
    /* On mobile, filter rail goes ABOVE the map/table, full width, collapsed by default */
    width: 100%;
    margin-bottom: 16px;
  }

  .safety-global__filters-toggle {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 12px 16px;
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: var(--r);
    font: 500 14px var(--font-ui);
    color: var(--text);
    cursor: pointer;
    text-align: left;
  }

  .safety-global__filters-toggle:hover {
    background: var(--accent-soft);
  }

  .safety-global__filters-icon { color: var(--text-2); }

  .safety-global__filters-label {
    flex: 1;
    color: var(--text);
  }

  .safety-global__filters-chevron {
    color: var(--text-2);
    transition: transform 200ms ease;
    font-size: 10px;
  }

  .safety-global__filters-chevron--open {
    transform: rotate(180deg);
  }

  .safety-global__filters[data-collapsed="true"] .safety-global__filter-controls {
    display: none;
  }

  .safety-global__filter-controls {
    margin-top: 12px;
    padding: 16px;
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: var(--r);
    /* let internal filter UI flow naturally */
  }
}
```

The `data-collapsed` attribute on the wrapper drives the CSS `display: none`.
Desktop ignores it entirely (`.safety-global__filters-toggle` stays
`display: none`).

### 4.5 Map sizing on mobile

Locate the existing map container CSS. Add or update:

```css
@media (max-width: 640px) {
  .safety-global__map {
    width: 100%;
    min-height: 50vh;
  }
}
```

The exact selector depends on existing markup — verify before editing.

### 4.6 Edge cases

- User taps outside the panel after expanding → drawer does NOT close.
  Closing requires explicit tap on the toggle bar OR application of a filter
  (auto-collapse triggers via useEffect dependency).
- Era slider inside the expanded panel needs ≥ 44px tap-target — use existing
  slider styles; if too cramped, add `padding: 12px 0` to slider container.
- `<SafetyGlobalMap>` lazy boundary — unchanged.

---

## §5 SafetyEventDetail polish

### 5.1 Em-dash discipline

`client/src/pages/safety/SafetyEventDetail.jsx`. Add at the top:

```js
function dash(v) { return v == null || v === '' ? '—' : v; }
```

Apply to every nullable field rendered in the `<dl>`. The fields:

```jsx
<dd>{dash(event.aircraft.icaoType)} {/* ... existing crosslink */}</dd>
<dd>{dash(event.phaseOfFlight)}</dd>
<dd>
  <span>{dash(event.route.dep)}</span>
  <span className="safety-detail__arrow"> → </span>
  <span>{dash(event.route.arr)}</span>
</dd>
<dd>{dash(event.location.country)}</dd>
{/* registration */}
<dd>{dash(event.aircraft.registration)}</dd>
{/* operator name — keep crosslink from spec #2 */}
<dd>
  {dash(event.operator.name || event.operator.icao)}
  {/* existing crosslink stays */}
</dd>
```

**Numeric fields** (`fatalities`, `injuries`) keep their numeric value — `0`
is a meaningful "no fatalities", not a missing-data marker.

### 5.2 Source attribution footer

After the closing `</dl>`, before the `</main>` (or wherever the page ends),
add:

```jsx
<footer className="safety-detail__source">
  Source: {SOURCE_LABEL[event.source] ?? event.source}
  {event.sourceEventId && (
    <> · Case ID <span className="safety-detail__case-id">{event.sourceEventId}</span></>
  )}
</footer>
```

Map at top of file:

```js
const SOURCE_LABEL = {
  ntsb:                    'US NTSB CAROL',
  aviation_safety_network: 'Aviation Safety Network',
};
```

Implementer should run `SELECT DISTINCT source FROM safety_events;` on the
production DB to confirm the actual source values and extend the map. If a
source slug isn't in the map, fall back to the raw value (the `??` does this).

### 5.3 CSS

Append to `client/src/pages/safety/SafetyEventDetail.css`:

```css
.safety-detail__source {
  margin-top: 32px;
  padding-top: 16px;
  border-top: 1px solid var(--border-light);
  font: 400 12px var(--font-ui);
  color: var(--text-3);
}

.safety-detail__case-id {
  font-family: var(--font-mono);
  color: var(--text-2);
}

.safety-detail__arrow {
  color: var(--text-3);
  padding: 0 4px;
}
```

---

## §6 Roll-out, testing, follow-ups

### 6.1 Branch / commit order

Branch from updated main (after PR #70 merges) — not from feat/site-redesign-foundation.

```bash
git checkout main
git pull origin main
git checkout -b feat/safety-redesign
```

Commits:

1. **feat(safety): SafetyFeed 4-col tabular redesign** — §2 (UI bulk).
2. **feat(safety): em-dash null discipline + source footer in EventDetail** — §5.
3. **feat(safety): SafetyGlobal mobile filter toolbar** — §4.
4. **feat(safety-ingest): NTSB detail-view enrichment scaffolding** — §3.2 (adapter functions + feature flag, no pipeline integration yet).
5. **test(safety-ingest): circuit breaker + rate-limit + mock detail mapping tests** — §3.5.
6. **feat(safety-ingest): pipeline integration with circuit breaker** — §3.4 (ingestion runner change).
7. **chore(deploy): wire SAFETY_DETAIL_ENRICHMENT_ENABLED env var** — §3.6.

Single PR → merge → GitHub Actions deploy.

### 6.2 Manual smoke

Frontend (with backend running):

- [ ] `/safety/feed` desktop — table renders 100 rows, severity dots colored
      correctly, em-dash for null route/aircraft fields.
- [ ] `/safety/feed` filter pills — All/Fatal/Hull-loss/Serious/Incident/Minor
      all change the visible rows.
- [ ] `/safety/feed` mobile (390px) — rows collapse to 3 visual lines, table
      header hidden, all data legible.
- [ ] `/safety/feed` row click → `/safety/events/<id>` (whole row clickable).
- [ ] `/safety/global` desktop — no regression, filter rail still on the left.
- [ ] `/safety/global` mobile — filter toggle bar above map, summary line
      shows applied filters, tap expands panel, applying a filter
      auto-collapses.
- [ ] `/safety/events/<id>` — em-dash on null fields, source footer visible
      with case ID in mono.
- [ ] Cross-links from spec #2 still work (`View aircraft history →`,
      `All events from this operator →`).

Backend (only if `SAFETY_DETAIL_ENRICHMENT_ENABLED=true` for testing):

- [ ] Trigger ingestion locally → log `[safety-ingest] enriched N/M events`.
- [ ] DB: `SELECT operator_iata, operator_name, cictt_category FROM
      safety_events WHERE source='ntsb' ORDER BY occurred_at DESC LIMIT 10`
      → some rows have non-null values.
- [ ] Simulate detail-view 500 (e.g. invalid subscription key) → ingestion
      doesn't crash, log shows `circuit-breaker hit: yes` after 3 fails.

### 6.3 Performance

- SafetyFeed table: 100 rows × DOM is unchanged from existing list — no
  perf delta.
- Filter toolbar: pure CSS toggle, no extra JS work on mount/render.
- NTSB detail enrichment: adds ~200ms × N events latency to ingestion
  (background job — acceptable; ingestion already runs as a cron / manual
  trigger, not in user request path).
- Bundle: ~+1 KB brotli (CSS + tiny JS for toggle state). Stays under
  perf budget.

### 6.4 Rollback

`SAFETY_DETAIL_ENRICHMENT_ENABLED` flag → instant rollback for ingestion
enrichment without redeploy. Frontend changes — `git revert <merge-sha>`.

If detail-view enrichment turns out wrong (corrupts data) — flip flag to
`false`, then run a CLI cleanup script (out of scope for this spec) to null
out enriched fields.

### 6.5 Known follow-ups

| # | Issue | Future spec |
|---|-------|------|
| 1 | Existing 5,000+ NTSB rows backfill | One-off CLI script if data warrants |
| 2 | SafetyFeed pagination / load-more | Future feature |
| 3 | URL state persistence for SafetyGlobal filters | Future feature |
| 4 | Related events section in EventDetail | Spec #4 if uncovered |
| 5 | AirCrash sidecar additional sources | Future spec |
| 6 | If NTSB detail-view is auth-gated — investigate ASN scraping or
       commercial ICAO iSTARS | Reference: `reference_global_safety_sources.md` |

---

## §7 Architecture summary diagram

```
NTSB Carol v2 ┐
              ├─→ ntsbAdapter.fetchPage() → mapToSafetyEvent() ─┐
              │                                                  │
              └─→ ntsbAdapter.fetchEventDetail()                 │
                  (per event, rate-limited, circuit breaker)     ▼
                                              ─→ enrichWithDetail() ─→ safety_events table
                                                       ▲
                                                       └── SAFETY_DETAIL_ENRICHMENT_ENABLED flag

safety_events table ─→ /api/safety/events ─→ shapeEvent() ─→ SafetyFeed (table render)
                    ─→ /api/safety/events/:id ─→ SafetyEventDetail (with em-dash + source footer)
                    ─→ /api/safety/global/accidents ─→ SafetyGlobal (mobile filter toolbar)
```

---

## §8 Error handling

| Surface | Failure | Behavior |
|---------|---------|----------|
| `fetchEventDetail` 4xx/5xx | `enrichWithDetail` catches, increments counter, returns original event | Best-effort: ingestion continues with null fields |
| `fetchEventDetail` 3 consecutive fails | Circuit breaker trips for rest of batch | Logged; `cbHit: yes` in summary |
| `SAFETY_DETAIL_ENRICHMENT_ENABLED` not set / false | `enrichWithDetail` short-circuits to identity | No detail fetch, ingestion proceeds normally (current behavior) |
| SafetyFeed `events.length === 0` | Existing empty-state message | unchanged |
| SafetyGlobal mobile filter expanded → window resize to desktop | Toggle button hides, controls always visible (CSS-driven) | Acceptable, no re-render needed |

---

## §9 Open questions

None blocking. One implementation discovery up front:

1. **NTSB detail-view endpoint** — implementer must inspect `my.ntsb.gov`
   network requests to identify the call. Document URL + body shape +
   response shape in the commit. If endpoint isn't publicly reachable (auth
   wall) — escalate to BLOCKED, ship §2/§4/§5 only.

---

## §10 Acceptance criteria

This spec is done when:

- [ ] SafetyFeed renders a `<table>` with 4 columns, severity color dots,
      em-dash for null fields, and ≥ 1 row hover-highlights.
- [ ] SafetyFeed mobile (390px) shows 3-line stacked rows.
- [ ] SafetyFeed entire row is clickable → `/safety/events/<id>`.
- [ ] SafetyEventDetail shows em-dash for every null field.
- [ ] SafetyEventDetail renders a source footer with case ID.
- [ ] SafetyGlobal mobile (≤640px) has a collapsible filter toolbar above
      the map, defaulting to collapsed.
- [ ] SafetyGlobal mobile applying a filter auto-collapses the toolbar.
- [ ] `ntsbAdapter.enrichWithDetail` exists, is feature-flag-gated, has
      circuit breaker, and is unit-tested with ≥ 5 cases.
- [ ] Ingestion pipeline runs `enrichWithDetail` per event; logs
      `enriched N/M (cb-hit: yes/no)` after each batch.
- [ ] `SAFETY_DETAIL_ENRICHMENT_ENABLED` env var threaded through
      `deploy.yml`.
- [ ] All client tests pass; existing pre-existing flake is the only
      remaining failure.
- [ ] Bundle: home initial brotli ≤ 96 KB (95 budget from spec #2 + 1 KB).
- [ ] Manual smoke checklist (§6.2) passes in Chrome and Safari iOS.
