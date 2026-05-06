# AirLabs Subscription Augmentation — Design Spec

**Date:** 2026-05-06
**Owner:** Solo (denyskolomiiets)
**Status:** Approved
**Scope:** Single-spec post-roadmap improvement

---

## 1. Goal

Augment the existing delay prediction system with AirLabs `/flight_delays` (cold-route fallback) and add Pro-gated fleet enrichment via `/airplanes`. Both endpoints are paid features of our existing AirLabs Developer subscription that are currently unused.

**Success criterion:** cold routes (where local observations are <10 samples) get a delay prediction instead of "Collecting data — predictions available soon". Pro users see per-tail fleet info (registration, build year, age, operator) on enriched FlightCard.

---

## 2. Background

The 2026-05-06 utilization audit of AirLabs.io found:
- Subscription: **Developer plan, 25K calls/month**
- Current usage: **~9K calls/mo** (~36% of quota)
- 5 endpoints used; 9+ endpoints available unused

Two underutilized endpoints with strong fit:
- **`/flight_delays`** — official aggregated delay statistics (avg delay, on-time %, cancel %, flight count) by route+airline. Fills the gap where our local observations are too sparse for prediction.
- **`/airplanes`** — per-tail fleet record (hex, registration, delivery date, airline). Quintessential aviation-enthusiast feature; natural Pro upgrade lever.

Brainstorm decisions:
- **Q1 (A):** Delay augmentation = fallback only. Local model stays primary; AirLabs fills cold-path gap.
- **Q2 (A):** Fleet enrichment = FlightCard only, Pro-gated.

---

## 3. Architecture

**Files added:**
- `server/src/services/airlabsDelayService.js` — wraps `/flight_delays`
- `server/src/services/airlabsFleetService.js` — wraps `/airplanes` (extracted from existing `getAirplane` in airlabsService.js)

**Files modified:**
- `server/src/services/delayPredictionService.js` — async fallback to AirLabs when local observations <10
- `server/src/services/airlabsService.js` — DELETE dead code (`getRoutes`, single-call `getAircraftInfo` / `getAirlineInfo`); MOVE `getAirplane` → airlabsFleetService
- `server/src/services/enrichmentService.js` — call airlabsFleetService for Pro users; add `tail` field to response
- `client/src/components/FlightCard.jsx` — render `tail` section when present
- `client/src/components/FlightCard.css` — styles for `.flight-card__tail*`

**API budget impact:**
- `/flight_delays`: +1-2K calls/mo (only triggered on cold routes)
- `/airplanes`: +1-2K calls/mo (Pro tier, 30-day cache hits dominate)
- Dead code removal: 0 net change (was unused)
- New total: **~12-14K/mo (~50-60% of quota)** — comfortable headroom for SEO Growth roadmap traffic increase.

**Failure mode:** AirLabs unavailable → existing behavior preserved (insufficient delay message; no tail field). Net: never breaks existing UX, only enriches.

**Branch:** `feat/airlabs-augmentation` from main.

---

## 4. airlabsDelayService

`server/src/services/airlabsDelayService.js`:

```js
'use strict';
const axios = require('axios');
const cacheService = require('./cacheService');

const AIRLABS_API_URL = 'https://airlabs.co/api/v9';
const TIMEOUT_MS = 10000;
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7d — delay aggregates slow-changing
const NEGATIVE_TTL_MS = 6 * 60 * 60 * 1000;    // 6h on miss

const client = axios.create({ baseURL: AIRLABS_API_URL, timeout: TIMEOUT_MS });

/**
 * Aggregated delay statistics from AirLabs /flight_delays.
 * Used as fallback in delayPredictionService when local samples <10.
 *
 * @param {object} params
 * @param {string} params.airline       IATA airline code (e.g. "BA")
 * @param {string} params.flightNumber  flight number digits (e.g. "175")
 * @param {string} params.dep           3-letter departure IATA
 * @param {string} params.arr           3-letter arrival IATA
 * @returns {Promise<object|null>}      aggregated stats or null
 */
async function getDelayStats({ airline, flightNumber, dep, arr }) {
  const apiKey = process.env.AIRLABS_API_KEY;
  if (!apiKey) return null;
  if (!dep || !arr || dep.length !== 3 || arr.length !== 3) return null;

  const cacheKey = `airlabs:delay:${dep.toUpperCase()}-${arr.toUpperCase()}-${(airline || '').toUpperCase()}`;
  const hit = cacheService.get(cacheKey);
  if (hit !== undefined) return hit;

  try {
    const params = {
      api_key: apiKey,
      dep_iata: dep.toUpperCase(),
      arr_iata: arr.toUpperCase(),
    };
    if (airline) params.airline_iata = airline.toUpperCase();

    const res = await client.get('/flight_delays', { params });
    const rows = Array.isArray(res.data?.response) ? res.data.response : [];
    if (rows.length === 0) {
      cacheService.set(cacheKey, null, NEGATIVE_TTL_MS);
      return null;
    }

    const row = rows[0];
    const result = {
      median: row.delay != null ? Math.round(row.delay) : null,
      onTimePct: row.delay_pct != null ? (1 - row.delay_pct / 100) : null,
      cancelPct: row.cancel_pct != null ? row.cancel_pct / 100 : null,
      sample: row.flights_count || null,
      source: 'airlabs',
    };
    cacheService.set(cacheKey, result, CACHE_TTL_MS);
    return result;
  } catch (err) {
    console.warn(`[airlabs] getDelayStats failed for ${dep}-${arr}/${airline}: ${err?.response?.status ?? err.message}`);
    cacheService.set(cacheKey, null, NEGATIVE_TTL_MS);
    return null;
  }
}

module.exports = { getDelayStats };
```

⚠️ Cache key uses `dep-arr-airline` (no flight number) — `/flight_delays` aggregates by route+airline, per-flight breakdown is rare in practice. `flightNumber` parameter kept in signature for API stability.

---

## 5. delayPredictionService — async with AirLabs fallback

`server/src/services/delayPredictionService.js` becomes:

```js
'use strict';
const obsModel = require('../models/observations');
const airlabsDelay = require('./airlabsDelayService');

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
const MIN_SAMPLE = 10;

function percentile(nums, p) {
  if (!nums.length) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

/**
 * 4-tier delay prediction:
 *   1. exact-flight (≥10 obs)        → high confidence, source=local
 *   2. route-airline (≥10 obs)       → medium confidence, source=local
 *   3. airlabs-fallback              → medium confidence, source=airlabs
 *   4. insufficient                  → no prediction
 */
async function predictDelay({ airline, flightNumber, dep, arr }) {
  const since = Date.now() - NINETY_DAYS_MS;

  let rows = obsModel.getByExactFlight(airline, flightNumber, since);
  let scope = 'exact-flight';
  if (rows.length < MIN_SAMPLE) {
    rows = obsModel.getByRouteAirline(dep, arr, airline, since);
    scope = 'route-airline';
  }

  if (rows.length >= MIN_SAMPLE) {
    const delays = rows.map((r) => r.delay_minutes);
    const median = percentile(delays, 50);
    const p75 = percentile(delays, 75);
    const onTime = delays.filter((d) => d < 15).length;
    const onTimePct = onTime / delays.length;
    const confidence = delays.length >= 30 ? 'high' : 'medium';
    return { median, p75, onTimePct, confidence, sample: delays.length, scope, source: 'local' };
  }

  // tier 3: AirLabs fallback for cold routes
  try {
    const stats = await airlabsDelay.getDelayStats({ airline, flightNumber, dep, arr });
    if (stats && stats.median != null) {
      return {
        median: stats.median,
        onTimePct: stats.onTimePct,
        confidence: 'medium',
        sample: stats.sample,
        scope: 'airlabs-fallback',
        source: 'airlabs',
      };
    }
  } catch (err) {
    console.warn('[delayPrediction] airlabs fallback failed:', err.message);
  }

  return {
    confidence: 'low',
    message: 'Collecting data — predictions available soon',
    scope: 'insufficient',
    source: 'none',
  };
}

module.exports = { predictDelay };
```

⚠️ **Breaking change:** `predictDelay` returns Promise (was sync). Callers must `await`. Implementer greps `predictDelay(` callers and updates each. Existing tests use mock observations; they need async adaptation.

⚠️ Existing prediction shape preserved (median, onTimePct, confidence, sample) — adds `source` + `scope`. Client can ignore new fields safely.

---

## 6. airlabsFleetService

`server/src/services/airlabsFleetService.js` (extracted/refined from existing `getAirplane`):

```js
'use strict';
const axios = require('axios');
const cacheService = require('./cacheService');
const openFlights = require('./openFlightsService');

const AIRLABS_API_URL = 'https://airlabs.co/api/v9';
const TIMEOUT_MS = 10000;

const client = axios.create({ baseURL: AIRLABS_API_URL, timeout: TIMEOUT_MS });

/**
 * Per-tail aircraft fleet record. Lookup by hex (preferred — unique,
 * immutable) or registration. Returns null when not found.
 *
 * Cached 30 days on hit (fleet data static), 24h on miss.
 *
 * Shape:
 *   {
 *     hex, reg_number, icao_type, airline_iata, airline_name,
 *     delivered (ISO date), build_year (number), age_years (number)
 *   }
 *
 * @param {{ hex?: string, reg?: string }} ids — at least one required
 */
async function getFleetRecord({ hex, reg } = {}) {
  const apiKey = process.env.AIRLABS_API_KEY;
  if (!apiKey) return null;

  const params = { api_key: apiKey };
  if (hex) params.hex = String(hex).toLowerCase();
  else if (reg) params.reg_number = String(reg).toUpperCase();
  else return null;

  const cacheKey = `airlabs:fleet:${params.hex || params.reg_number}`;
  const hit = cacheService.get(cacheKey);
  if (hit !== undefined) return hit;

  try {
    const res = await client.get('/airplanes', { params });
    const rows = Array.isArray(res.data?.response) ? res.data.response : [];
    const row = rows[0];
    if (!row) {
      cacheService.set(cacheKey, null, cacheService.TTL.negative);
      return null;
    }

    const buildYear = row.delivered ? Number(String(row.delivered).slice(0, 4)) : null;
    const ageYears = buildYear ? new Date().getFullYear() - buildYear : null;
    const airline = row.airline_iata ? openFlights.getAirline(row.airline_iata) : null;

    const result = {
      hex: row.hex || null,
      reg_number: row.reg_number || null,
      icao_type: row.icao_code || null,
      airline_iata: row.airline_iata || null,
      airline_name: airline?.name || row.airline_iata || null,
      delivered: row.delivered || null,
      build_year: buildYear,
      age_years: ageYears,
    };

    cacheService.set(cacheKey, result, cacheService.TTL.staticRef); // 30d
    return result;
  } catch (err) {
    console.warn(`[airlabs] getFleetRecord failed: ${err?.response?.status ?? err.message}`);
    cacheService.set(cacheKey, null, cacheService.TTL.negative);
    return null;
  }
}

module.exports = { getFleetRecord };
```

---

## 7. enrichmentService — Pro-gated tail enrichment

In `server/src/services/enrichmentService.js`, after existing aircraft/airline enrichment:

```js
const airlabsFleet = require('./airlabsFleetService');

// ... inside the enrich flow, BEFORE return:
if (isProUser && (flight.aircraft?.hex || flight.aircraft?.registration)) {
  try {
    const fleetData = await airlabsFleet.getFleetRecord({
      hex: flight.aircraft.hex,
      reg: flight.aircraft.registration,
    });
    if (fleetData) {
      enriched.tail = {
        registration: fleetData.reg_number,
        buildYear: fleetData.build_year,
        ageYears: fleetData.age_years,
        airline: fleetData.airline_name,
        delivered: fleetData.delivered,
      };
    }
  } catch (err) {
    console.warn('[enrichment] fleet lookup failed:', err.message);
  }
}
```

⚠️ **`isProUser` source:** existing enrichmentService likely already checks Pro entitlement (the enriched-card feature is Pro-only). Match the existing pattern (`req.user?.subscription_tier?.startsWith('pro_')` or similar). If no Pro check exists at this layer, the tail field can be added unconditionally and gated client-side instead — implementer judgment.

---

## 8. Cleanup dead code in airlabsService.js

DELETE from `/Users/denyskolomiiets/FLIGHT/server/src/services/airlabsService.js`:
- `getRoutes` function (line ~153) — replaced by `getSchedules` (per existing comment)
- `getAirplane` function (line ~314) — moved to airlabsFleetService
- `getAircraftInfo` and `getAirlineInfo` single-call exports — only `getMultipleAircraft` / `getMultipleAirlines` are called externally; the single-call versions can be retained as private helpers or inlined. Implementer judgment: keep if cleaner (private functions), delete if creates noise.

⚠️ Verify no consumers break — `grep -rn "getRoutes\|getAirplane\|getAircraftInfo\|getAirlineInfo"` across `server/src/` (excluding tests) should show only call sites that are also being updated.

---

## 9. Client — FlightCard tail rendering

### 9.1 FlightCard.jsx

Find existing aircraft section. Below it, add conditional tail block:

```jsx
{flight.tail && (
  <div className="flight-card__tail">
    <span className="eyebrow eyebrow--strong">Aircraft tail</span>
    <div className="flight-card__tail-grid">
      {flight.tail.registration && (
        <div>
          <dt>Registration</dt>
          <dd>{flight.tail.registration}</dd>
        </div>
      )}
      {flight.tail.buildYear && (
        <div>
          <dt>Built</dt>
          <dd>
            {flight.tail.buildYear}
            {flight.tail.ageYears != null ? ` (${flight.tail.ageYears}y old)` : ''}
          </dd>
        </div>
      )}
      {flight.tail.airline && (
        <div>
          <dt>Operator</dt>
          <dd>{flight.tail.airline}</dd>
        </div>
      )}
    </div>
  </div>
)}
```

### 9.2 FlightCard.css

Append:

```css
.flight-card__tail {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--border-light);
}

.flight-card__tail .eyebrow {
  display: block;
  margin-bottom: 6px;
}

.flight-card__tail-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 8px;
}

.flight-card__tail-grid dt {
  font: 400 11px var(--font-mono);
  color: var(--text-3);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-bottom: 2px;
}

.flight-card__tail-grid dd {
  font: 500 14px var(--font-ui);
  color: var(--text);
  margin: 0;
}
```

### 9.3 Optional: delay source labeling

When `prediction.source === 'airlabs'`, show small footnote:

```jsx
{prediction.source === 'airlabs' && (
  <span className="flight-card__delay-source">based on historical statistics</span>
)}
```

CSS: small mono text, muted. ~5 LoC. Optional — implementer judgment.

---

## 10. Acceptance criteria

- [ ] `delayPredictionService.predictDelay` returns Promise.
- [ ] Cold routes (rows < 10 across both tiers) return tier-3 prediction with `scope: 'airlabs-fallback'`, `source: 'airlabs'`.
- [ ] AirLabs failure → graceful "insufficient" (existing UX preserved).
- [ ] Pro users see `tail` field in FlightCard with registration / buildYear / ageYears / operator.
- [ ] Free users do NOT see tail data (entitlement gated).
- [ ] Dead code removed: `getRoutes`, `getAirplane` from airlabsService.js.
- [ ] Cache TTLs: delay 7d, fleet 30d (existing `cacheService.TTL` constants).
- [ ] All `predictDelay` callers updated to `await` (async signature).
- [ ] Existing tests adapted to async signature.
- [ ] Server tests + new tests for airlabsDelayService + airlabsFleetService.
- [ ] Client tests pass; build clean; bundle under 98 KB brotli.

---

## 11. Out of scope

- AirLabs `/weather` endpoint — we use NOAA + OpenWeather (free, sufficient).
- AirLabs `/nat_tracks` — niche transatlantic data, low traffic value.
- AirLabs `/cities` / `/countries` — OpenFlights covers.
- Free-tier tail data — Pro upgrade lever.
- AirLabs `/suggest` autocomplete — local OpenFlights data sufficient for now.
- Per-flight breakdown in `/flight_delays` — endpoint typically aggregates by route, per-flight rare in practice.

---

## 12. Risk + reversibility

- **API quota:** budget after change ~50-60% of 25K/mo — comfortable.
- **Failure modes:** all AirLabs calls non-blocking. Existing UX preserved on outage.
- **Data accuracy:** AirLabs delay data is aggregated 12+ months; less responsive to recent operational shifts (e.g., new airline taking over a route). Acceptable for cold-route gap-filling, NOT for replacing local model on hot routes.
- **Reversibility:** revert single PR removes all changes; cached AirLabs responses expire naturally.
