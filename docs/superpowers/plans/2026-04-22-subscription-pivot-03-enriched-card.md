# Subscription Pivot — Plan 3 / 5: γ Enriched Card + Affiliate Removal

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the existing FlightCard's "Find on Aviasales" CTA with the γ "Insider Card" — livery photo, on-time %, CO₂, amenities, weather, gate/terminal. Pro users see the values; free users see the same fields as blurred teasers with 🔒 badges that open an UpgradeModal. Affiliate code is deleted, Travelpayouts data source stays.

**Architecture:** New `enrichmentService` aggregates fields from the services Plan 2 built (`openWeather`, `wikimediaLivery`, `amenities`, `co2`, `delayPrediction`, AeroDataBox). New `GET /api/flights/:id/enriched` endpoint is gated by `requireTier('pro')` from Plan 1 — but the **teaser** response (empty values + `tier: 'free'`) is served to non-pro users so the UI can render blurred placeholders without branching in the client. The FlightCard is reshaped around an `<EnrichedPanel>` child that owns its own fetch on hover/expand (lazy, to save quota).

**Tech stack:** Express, React 18, existing `cacheService` (30-min in-memory), Plan 2 services, Plan 1 `requireTier`. No new deps.

**Spec reference:** [docs/superpowers/specs/2026-04-22-subscription-pivot-design.md](../specs/2026-04-22-subscription-pivot-design.md) — sections "γ Insider Card", "Enrichment endpoints", "Affiliate removal".

**Depends on:** Plan 1 (requireTier), Plan 2 (services).

---

## File structure

### Created

- `server/src/services/enrichmentService.js` — aggregates γ fields
- `server/src/controllers/enrichmentController.js` — `getEnrichedCard`
- `server/src/routes/enrichment.js` — `/api/flights/:id/enriched` + `/teaser`
- `server/src/__tests__/enrichedCard.shape.test.js`
- `client/src/components/EnrichedPanel.jsx` + `EnrichedPanel.css`
- `client/src/components/UpgradeModal.jsx` + `UpgradeModal.css`
- `client/src/hooks/useEnrichedCard.js`
- `client/src/context/AuthContext.jsx` (only if not present — we need `user.subscription_tier`)
- `client/src/__tests__/UpgradeModal.test.jsx`

### Modified

- `client/src/components/FlightCard.jsx` — strip affiliate (L150-172), add `<EnrichedPanel flightId={...} />`, import removed for `booking.js`
- `client/src/App.jsx` or router — mount `<UpgradeModal>` at app root, expose `openUpgradeModal({reason})` via context
- `client/src/utils/formatters.js` — tiny helpers if missing (`formatKmToMi`, `formatOnTimePct`)
- `server/src/index.js` — mount `require('./routes/enrichment')`
- `server/src/services/seoMetaService.js` — remove "book flights" copy
- `client/index.html` — update `<meta name="description">`

### Deleted

- `client/src/components/BookingModal.jsx`
- `client/src/components/BookingModal.css` (if exists)
- `client/src/utils/booking.js`

---

## Task 1: Enrichment service (aggregator)

**Files:**
- Create: `server/src/services/enrichmentService.js`

- [ ] **Step 1: Create enrichmentService.js**

```js
'use strict';

const airports          = require('./geocodingService');       // existing — gives lat/lon for IATA
const aerodatabox       = require('./aerodataboxService');     // existing
const openWeather       = require('./openWeatherService');     // Plan 2
const liveries          = require('./wikimediaLiveryService'); // Plan 2
const amenities         = require('./amenitiesService');       // Plan 2
const fleet             = require('../models/fleet');          // Plan 2
const { predictDelay }  = require('./delayPredictionService'); // Plan 2
const { co2PerPax, greatCircleKm } = require('./co2Service');  // Plan 2
const obsModel          = require('../models/observations');   // Plan 2

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

// Input shape: { id, airline, flightNumber, departure:{code}, arrival:{code}, aircraft:{icaoType?} }
// Output shape: documented in the controller test.
async function enrichFlight(flight) {
  const [weatherOrigin, weatherDest, livery, gateInfo] = await Promise.all([
    safeWeatherForIata(flight.departure?.code),
    safeWeatherForIata(flight.arrival?.code),
    safeLivery(flight.airline, flight.aircraft?.icaoType),
    safeGateInfo(flight.airline, flight.flightNumber),
  ]);

  const onTime = computeOnTimeStats({
    airline: flight.airline,
    flightNumber: flight.flightNumber,
    dep: flight.departure?.code,
    arr: flight.arrival?.code,
  });

  const prediction = predictDelay({
    airline: flight.airline,
    flightNumber: flight.flightNumber,
    dep: flight.departure?.code,
    arr: flight.arrival?.code,
  });

  const co2 = computeCo2(flight);

  const am = amenities.getAmenities(flight.airline, flight.aircraft?.icaoType);

  const tailInfo = flight.aircraft?.registration
    ? fleet.getByRegistration(flight.aircraft.registration)
    : null;

  return {
    livery: livery ? { imageUrl: livery.image_url, attribution: livery.attribution } : null,
    aircraft: tailInfo ? {
      registration: tailInfo.registration,
      icaoType: tailInfo.icao_type,
      buildYear: tailInfo.build_year,
      ageYears: tailInfo.build_year ? new Date().getFullYear() - tailInfo.build_year : null,
    } : null,
    onTime,           // { pct90d, medianDelay, p75Delay, sample, confidence, scope }
    delayForecast: prediction,
    co2,              // { kgPerPax, distanceKm } | null
    amenities: am,    // { wifi, power, entertainment, meal } | null
    gate: gateInfo,   // { originGate, originTerminal, destGate, destTerminal } | partial | null
    weather: {
      origin: weatherOrigin,
      destination: weatherDest,
    },
  };
}

function computeOnTimeStats({ airline, flightNumber, dep, arr }) {
  const since = Date.now() - NINETY_DAYS_MS;
  const rows = obsModel.getByExactFlight(airline, flightNumber, since);
  const delays = rows.length >= 10 ? rows : obsModel.getByRouteAirline(dep, arr, airline, since);
  if (delays.length < 10) return null;
  const nums = delays.map(r => r.delay_minutes);
  const onTime = nums.filter(d => d < 15).length;
  const sorted = [...nums].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length * 0.5)];
  const p75    = sorted[Math.floor(sorted.length * 0.75)];
  return {
    pct90d: Math.round((onTime / nums.length) * 100),
    medianDelay: median,
    p75Delay: p75,
    sample: nums.length,
    confidence: nums.length >= 30 ? 'high' : 'medium',
    scope: rows.length >= 10 ? 'exact-flight' : 'route-airline',
  };
}

function computeCo2(flight) {
  const type = flight.aircraft?.icaoType;
  if (!type) return null;
  const depCoords = airports.getCoords?.(flight.departure?.code);
  const arrCoords = airports.getCoords?.(flight.arrival?.code);
  if (!depCoords || !arrCoords) return null;
  const km = greatCircleKm(depCoords.lat, depCoords.lon, arrCoords.lat, arrCoords.lon);
  const kg = co2PerPax({ icaoType: type, distanceKm: km });
  if (kg == null) return null;
  return { kgPerPax: kg, distanceKm: Math.round(km) };
}

async function safeWeatherForIata(iata) {
  try {
    const coords = airports.getCoords?.(iata);
    if (!coords) return null;
    return await openWeather.fetch(coords);
  } catch (err) {
    console.warn('[enrich] weather fail:', err.message);
    return null;
  }
}

async function safeLivery(airlineIata, icaoType) {
  if (!airlineIata || !icaoType) return null;
  try {
    const airlineName = airports.getAirlineName?.(airlineIata) || airlineIata;
    return await liveries.fetch({ airlineIata, icaoType, airlineName });
  } catch (err) {
    console.warn('[enrich] livery fail:', err.message);
    return null;
  }
}

async function safeGateInfo(airline, flightNumber) {
  if (!aerodatabox.isEnabled?.() || !airline || !flightNumber) return null;
  try {
    const today = new Date().toISOString().slice(0, 10);
    const f = await aerodatabox.getFlightByNumber(`${airline}${flightNumber}`, today);
    if (!f) return null;
    return {
      originTerminal:  f.departure?.terminal || null,
      originGate:      f.departure?.gate || null,
      destTerminal:    f.arrival?.terminal || null,
      destGate:        f.arrival?.gate || null,
    };
  } catch (err) {
    console.warn('[enrich] gate fail:', err.message);
    return null;
  }
}

module.exports = { enrichFlight };
```

Note: if `geocodingService.getCoords()` / `getAirlineName()` don't exist, either add them (airport IATA → lat/lon table; airline IATA → name table) or stub with a TODO and use `null`. Engineer should grep `geocodingService.js` to see what's available and wire accordingly.

- [ ] **Step 2: Commit**

```bash
git add server/src/services/enrichmentService.js
git commit -m "feat(enrich): aggregate livery + on-time + co2 + amenities + weather + gate"
```

---

## Task 2: Enrichment controller + route

**Files:**
- Create: `server/src/controllers/enrichmentController.js`
- Create: `server/src/routes/enrichment.js`

We serve TWO endpoints:
- `GET /api/flights/:id/enriched` — requires Pro (returns full payload)
- `GET /api/flights/:id/enriched/teaser` — no auth; returns the SAME SHAPE but with all values null and `tier: 'free'`. Used by the client to render blurred placeholders without branching on `/enriched` 403s.

- [ ] **Step 1: Controller**

```js
'use strict';

const enrichmentService = require('../services/enrichmentService');
const cache = require('../services/cacheService');

// flight-by-id lookup: we expect the ID to encode airline+flightNumber+date (e.g. "BA175:2026-05-15")
// This keeps enrichment stateless — we don't need to persist search results.
function parseFlightId(id) {
  const [head, date] = id.split(':');
  const m = /^([A-Z0-9]{2})(\d{1,4})$/.exec(head || '');
  if (!m) return null;
  return { airline: m[1], flightNumber: m[2], date: date || null };
}

async function getEnriched(req, res) {
  const { id } = req.params;
  const parsed = parseFlightId(id);
  if (!parsed) return res.status(400).json({ success: false, message: 'Invalid flight id' });

  // The caller should pass through dep/arr/aircraft info via query if they want accurate
  // enrichment — without them we still enrich with what's available.
  const flight = {
    id,
    airline:      parsed.airline,
    flightNumber: parsed.flightNumber,
    departure: { code: req.query.dep },
    arrival:   { code: req.query.arr },
    aircraft:  { icaoType: req.query.type, registration: req.query.reg },
  };

  try {
    const payload = await cache.getOrFetch(
      `enriched:${id}:${flight.departure.code}:${flight.arrival.code}:${flight.aircraft.icaoType}`,
      600, // 10 minutes
      () => enrichmentService.enrichFlight(flight),
    );
    return res.json({ success: true, tier: 'pro', data: payload });
  } catch (err) {
    console.error('[enrich] failed:', err);
    return res.status(500).json({ success: false, message: 'Enrichment failed' });
  }
}

// Same shape, all null. Makes the client render blurred teasers without branching.
function getTeaser(_req, res) {
  return res.json({
    success: true,
    tier: 'free',
    data: {
      livery: null,
      aircraft: null,
      onTime: null,
      delayForecast: null,
      co2: null,
      amenities: null,
      gate: null,
      weather: { origin: null, destination: null },
    },
  });
}

module.exports = { getEnriched, getTeaser };
```

- [ ] **Step 2: Route**

```js
'use strict';

const express = require('express');
const requireAuth = require('../middleware/requireAuth');
const requireTier = require('../middleware/entitlement');
const controller  = require('../controllers/enrichmentController');

const router = express.Router();

// Teaser is public so the UI can render blurred placeholders for anyone.
router.get('/:id/enriched/teaser', controller.getTeaser);

// Full card is Pro-only.
router.get('/:id/enriched', requireAuth, requireTier('pro'), controller.getEnriched);

module.exports = router;
```

- [ ] **Step 3: Mount in index.js**

Inside `server/src/index.js`, near `/api/flights`, add:

```js
app.use('/api/flights', require('./routes/enrichment'));
```

- [ ] **Step 4: Commit**

```bash
git add server/src/controllers/enrichmentController.js server/src/routes/enrichment.js server/src/index.js
git commit -m "feat(api): GET /api/flights/:id/enriched + /teaser (Pro-gated vs public)"
```

---

## Task 3: Enrichment response shape contract test

**Files:**
- Create: `server/src/__tests__/enrichedCard.shape.test.js`

- [ ] **Step 1: Write the test**

```js
// Contract test: the /enriched response shape is a hard contract with the client.
// If the test fails, the FlightCard will break. Mocks the service to make the test
// deterministic; this is about the HTTP layer + shape, not about enrichment logic.

const express = require('express');
const request = require('supertest');

jest.mock('../services/enrichmentService', () => ({
  enrichFlight: jest.fn(async () => ({
    livery: { imageUrl: 'https://example.com/a.jpg', attribution: 'Wiki' },
    aircraft: { registration: 'G-STBA', icaoType: 'B738', buildYear: 2010, ageYears: 16 },
    onTime: { pct90d: 87, medianDelay: 5, p75Delay: 14, sample: 42, confidence: 'high', scope: 'exact-flight' },
    delayForecast: { median: 5, p75: 14, onTimePct: 0.87, confidence: 'high', sample: 42, scope: 'exact-flight' },
    co2: { kgPerPax: 105, distanceKm: 850 },
    amenities: { wifi: true, power: true, entertainment: false, meal: false },
    gate: { originGate: 'A21', originTerminal: '2', destGate: 'B7', destTerminal: '3' },
    weather: {
      origin: { tempC: 18, condition: 'Clouds', description: 'scattered clouds', windMps: 4, icon: '03d', observedAt: 1 },
      destination: { tempC: 24, condition: 'Clear', description: 'clear sky', windMps: 2, icon: '01d', observedAt: 1 },
    },
  })),
}));

const controller = require('../controllers/enrichmentController');

function makeApp() {
  const app = express();
  // pretend auth + pro — skip middleware in unit
  app.get('/api/flights/:id/enriched', controller.getEnriched);
  app.get('/api/flights/:id/enriched/teaser', controller.getTeaser);
  return app;
}

describe('GET /api/flights/:id/enriched', () => {
  test('invalid id → 400', async () => {
    const res = await request(makeApp()).get('/api/flights/bogus/enriched?dep=LHR&arr=JFK&type=B738');
    expect(res.status).toBe(400);
  });

  test('happy path returns expected shape', async () => {
    const res = await request(makeApp()).get('/api/flights/BA175:2026-05-15/enriched?dep=LHR&arr=JFK&type=B738');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.tier).toBe('pro');
    expect(res.body.data).toEqual(expect.objectContaining({
      livery:   expect.objectContaining({ imageUrl: expect.any(String) }),
      aircraft: expect.objectContaining({ registration: expect.any(String) }),
      onTime:   expect.objectContaining({ pct90d: expect.any(Number), confidence: expect.any(String) }),
      co2:      expect.objectContaining({ kgPerPax: expect.any(Number) }),
      amenities: expect.objectContaining({ wifi: expect.any(Boolean) }),
      gate:     expect.objectContaining({ originGate: expect.any(String) }),
      weather:  expect.objectContaining({
        origin: expect.any(Object),
        destination: expect.any(Object),
      }),
    }));
  });

  test('teaser returns same keys with all null values', async () => {
    const res = await request(makeApp()).get('/api/flights/BA175:2026-05-15/enriched/teaser');
    expect(res.status).toBe(200);
    expect(res.body.tier).toBe('free');
    expect(res.body.data).toEqual({
      livery: null, aircraft: null, onTime: null, delayForecast: null,
      co2: null, amenities: null, gate: null,
      weather: { origin: null, destination: null },
    });
  });
});
```

- [ ] **Step 2: Run — expect PASS**

Run: `cd server && npx jest src/__tests__/enrichedCard.shape.test.js --verbose`
Expected: 3 tests PASS.

- [ ] **Step 3: Commit**

```bash
git add server/src/__tests__/enrichedCard.shape.test.js
git commit -m "test(enrich): contract test for enriched + teaser response shape"
```

---

## Task 4: UpgradeModal component

**Files:**
- Create: `client/src/components/UpgradeModal.jsx`, `UpgradeModal.css`
- Create: `client/src/__tests__/UpgradeModal.test.jsx`

- [ ] **Step 1: Write the UpgradeModal test**

```jsx
// client/src/__tests__/UpgradeModal.test.jsx
import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import UpgradeModal from '../components/UpgradeModal';

describe('UpgradeModal', () => {
  test('renders reason, CTA, and closes on backdrop click', () => {
    const onClose = vi.fn();
    render(<UpgradeModal open reason="Unlock on-time stats" onClose={onClose} />);
    expect(screen.getByText(/Unlock on-time stats/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /see plans/i })).toHaveAttribute('href', '/pricing');
    fireEvent.click(screen.getByTestId('upgrade-modal-backdrop'));
    expect(onClose).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: UpgradeModal.jsx**

```jsx
// client/src/components/UpgradeModal.jsx
import './UpgradeModal.css';

export default function UpgradeModal({ open, reason, onClose }) {
  if (!open) return null;
  return (
    <div
      className="upgrade-modal-backdrop"
      data-testid="upgrade-modal-backdrop"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="upgrade-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="upgrade-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="upgrade-modal-title">Go Pro</h2>
        <p className="upgrade-modal-reason">{reason}</p>
        <ul className="upgrade-modal-bullets">
          <li>Real on-time % per flight (90 days)</li>
          <li>CO₂ / passenger + amenities + livery photo</li>
          <li>My Trips live status + delay alerts</li>
        </ul>
        <div className="upgrade-modal-actions">
          <a href="/pricing" className="btn btn-primary" role="link">See plans</a>
          <button onClick={onClose} className="btn btn-ghost">Not now</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: UpgradeModal.css (minimal)**

```css
.upgrade-modal-backdrop {
  position: fixed; inset: 0; background: rgba(0,0,0,0.55);
  display: grid; place-items: center; z-index: 1000;
}
.upgrade-modal {
  background: #fff; border-radius: 10px; max-width: 420px; width: 92vw;
  padding: 24px; box-shadow: 0 12px 32px rgba(0,0,0,0.2);
}
.upgrade-modal h2 { margin: 0 0 8px; }
.upgrade-modal-reason { color: #555; margin: 0 0 16px; }
.upgrade-modal-bullets { margin: 0 0 20px; padding-left: 20px; color: #333; line-height: 1.6; }
.upgrade-modal-actions { display: flex; gap: 12px; justify-content: flex-end; }
.upgrade-modal-actions .btn-ghost { background: transparent; border: 1px solid #ccc; }
```

- [ ] **Step 4: Run — expect PASS**

Run: `cd client && npx vitest run src/__tests__/UpgradeModal.test.jsx`
Expected: 1 test PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/UpgradeModal.jsx client/src/components/UpgradeModal.css client/src/__tests__/UpgradeModal.test.jsx
git commit -m "feat(ui): UpgradeModal component with reason prop + pricing link"
```

---

## Task 5: `useEnrichedCard` hook

**Files:**
- Create: `client/src/hooks/useEnrichedCard.js`

- [ ] **Step 1: Implement the hook**

```js
// client/src/hooks/useEnrichedCard.js
import { useState, useEffect } from 'react';
import { API_BASE } from '../config/api'; // existing — adjust import if path differs

// Pro users: fetch /enriched; free users: fetch /enriched/teaser (same shape, nulls).
// The flight prop shape: { id, departure:{code}, arrival:{code}, aircraft:{icaoType, registration} }
export function useEnrichedCard(flight, user) {
  const [state, setState] = useState({ loading: false, data: null, tier: null, error: null });

  useEffect(() => {
    if (!flight?.id) return;
    const controller = new AbortController();
    const isPro = user?.subscription_tier?.startsWith('pro_');
    const token = localStorage.getItem('authToken');

    const qs = new URLSearchParams({
      dep:  flight.departure?.code || '',
      arr:  flight.arrival?.code || '',
      type: flight.aircraft?.icaoType || '',
      reg:  flight.aircraft?.registration || '',
    }).toString();

    const url = isPro
      ? `${API_BASE}/api/flights/${encodeURIComponent(flight.id)}/enriched?${qs}`
      : `${API_BASE}/api/flights/${encodeURIComponent(flight.id)}/enriched/teaser`;

    setState(s => ({ ...s, loading: true, error: null }));
    fetch(url, {
      signal: controller.signal,
      headers: isPro && token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then(r => r.json())
      .then(j => {
        if (!j.success) throw new Error(j.message || 'enrich failed');
        setState({ loading: false, data: j.data, tier: j.tier, error: null });
      })
      .catch(err => {
        if (err.name === 'AbortError') return;
        setState({ loading: false, data: null, tier: null, error: err.message });
      });

    return () => controller.abort();
  }, [flight?.id, user?.subscription_tier]);

  return state;
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/hooks/useEnrichedCard.js
git commit -m "feat(hooks): useEnrichedCard — fetches /enriched or /teaser based on tier"
```

---

## Task 6: EnrichedPanel component (the actual γ card body)

**Files:**
- Create: `client/src/components/EnrichedPanel.jsx`, `EnrichedPanel.css`

Each field block has three states:
- `data` present → render real value
- `data === null && tier === 'free'` → render blurred teaser + 🔒
- `loading` → skeleton

- [ ] **Step 1: Component**

```jsx
// client/src/components/EnrichedPanel.jsx
import { useState } from 'react';
import { useEnrichedCard } from '../hooks/useEnrichedCard';
import UpgradeModal from './UpgradeModal';
import './EnrichedPanel.css';

export default function EnrichedPanel({ flight, user }) {
  const { loading, data, tier, error } = useEnrichedCard(flight, user);
  const [upgrade, setUpgrade] = useState({ open: false, reason: '' });
  const isFree = tier === 'free';

  const askUpgrade = (reason) => setUpgrade({ open: true, reason });

  return (
    <div className="enriched-panel">
      {error && <div className="enriched-error">Could not load extra info.</div>}

      <div className="enriched-grid">
        <Field
          label="Livery"
          value={data?.livery?.imageUrl ? <img src={data.livery.imageUrl} alt="" loading="lazy" className="livery-img" /> : null}
          teaser="✈︎"
          isFree={isFree} loading={loading}
          onLockedClick={() => askUpgrade('Unlock the livery photo for this exact aircraft type.')}
        />

        <Field
          label="On-time (90d)"
          value={data?.onTime ? `${data.onTime.pct90d}%` : null}
          teaser="##%"
          isFree={isFree} loading={loading}
          onLockedClick={() => askUpgrade('Unlock on-time stats from the last 90 days.')}
        />

        <Field
          label="CO₂ / pax"
          value={data?.co2 ? `${data.co2.kgPerPax} kg` : null}
          teaser="### kg"
          isFree={isFree} loading={loading}
          onLockedClick={() => askUpgrade('See carbon footprint per passenger for this exact aircraft.')}
        />

        <Field
          label="Aircraft"
          value={data?.aircraft ? `${data.aircraft.registration || ''} · ${data.aircraft.ageYears ? `${data.aircraft.ageYears} yrs` : ''}` : null}
          teaser="G-XXXX · 00 yrs"
          isFree={isFree} loading={loading}
          onLockedClick={() => askUpgrade('See the exact tail and age of the plane flying your route.')}
        />

        <Field
          label="Amenities"
          value={data?.amenities ? <Amenities am={data.amenities} /> : null}
          teaser="🔒🔒🔒🔒"
          isFree={isFree} loading={loading}
          onLockedClick={() => askUpgrade('Check WiFi / power / entertainment before you book.')}
        />

        <Field
          label="Weather"
          value={data?.weather?.origin && data?.weather?.destination ? (
            <span>{data.weather.origin.tempC}°C → {data.weather.destination.tempC}°C</span>
          ) : null}
          teaser="##°C → ##°C"
          isFree={isFree} loading={loading}
          onLockedClick={() => askUpgrade('See live weather at origin + destination.')}
        />

        <Field
          label="Gate / Terminal"
          value={data?.gate ? (
            <span>
              {data.gate.originTerminal ? `T${data.gate.originTerminal}` : '—'}
              {data.gate.originGate ? `/${data.gate.originGate}` : ''}
              {' → '}
              {data.gate.destTerminal ? `T${data.gate.destTerminal}` : '—'}
              {data.gate.destGate ? `/${data.gate.destGate}` : ''}
            </span>
          ) : null}
          teaser="T# / A## → T# / B##"
          isFree={isFree} loading={loading}
          onLockedClick={() => askUpgrade('See gate & terminal before heading to the airport.')}
        />
      </div>

      <UpgradeModal open={upgrade.open} reason={upgrade.reason} onClose={() => setUpgrade({ open: false, reason: '' })} />
    </div>
  );
}

function Field({ label, value, teaser, isFree, loading, onLockedClick }) {
  const locked = isFree && (value == null || value === '');
  return (
    <div className={`enriched-field ${locked ? 'locked' : ''}`}>
      <div className="enriched-label">{label}</div>
      {loading ? (
        <div className="enriched-skel" />
      ) : locked ? (
        <button type="button" className="enriched-teaser" onClick={onLockedClick}>
          <span className="blur">{teaser}</span>
          <span className="lock-badge" aria-label="Pro only">🔒 Pro</span>
        </button>
      ) : (
        <div className="enriched-value">{value ?? '—'}</div>
      )}
    </div>
  );
}

function Amenities({ am }) {
  return (
    <span className="amenities">
      <span title="WiFi"      className={am.wifi ? 'yes' : 'no'}>📶</span>
      <span title="Power"     className={am.power ? 'yes' : 'no'}>🔌</span>
      <span title="Entertainment" className={am.entertainment ? 'yes' : 'no'}>🎬</span>
      <span title="Meal"      className={am.meal ? 'yes' : 'no'}>🍽</span>
    </span>
  );
}
```

- [ ] **Step 2: Minimal CSS**

```css
/* client/src/components/EnrichedPanel.css */
.enriched-panel { margin-top: 14px; border-top: 1px solid #eee; padding-top: 12px; }
.enriched-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px 16px; }
.enriched-field { min-height: 48px; }
.enriched-label { font-size: 11px; color: #888; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; }
.enriched-value { font-size: 14px; color: #222; }
.enriched-skel  { height: 18px; background: linear-gradient(90deg, #f4f4f4, #eaeaea, #f4f4f4); border-radius: 4px; animation: shimmer 1.2s infinite linear; }
@keyframes shimmer { 0% { background-position: -80px 0; } 100% { background-position: 80px 0; } }
.enriched-teaser { display: inline-flex; align-items: center; gap: 6px; background: none; border: 0; padding: 0; cursor: pointer; }
.enriched-teaser .blur { filter: blur(4px); color: #888; }
.enriched-teaser .lock-badge { font-size: 11px; color: #c2410c; background: #fff7ed; padding: 2px 6px; border-radius: 4px; }
.amenities .yes { opacity: 1; } .amenities .no  { opacity: 0.25; }
.livery-img { max-width: 100%; height: 60px; object-fit: cover; border-radius: 4px; }
```

- [ ] **Step 3: Commit**

```bash
git add client/src/components/EnrichedPanel.jsx client/src/components/EnrichedPanel.css
git commit -m "feat(ui): EnrichedPanel — γ card body with tier-aware teaser fields"
```

---

## Task 7: Swap FlightCard body — affiliate out, EnrichedPanel in

**Files:**
- Modify: `client/src/components/FlightCard.jsx`
- Delete: `client/src/components/BookingModal.jsx`, `client/src/components/BookingModal.css` (if exists), `client/src/utils/booking.js`

- [ ] **Step 1: Remove imports + stripes L150-172**

In `FlightCard.jsx`:
- Remove `import { buildBookingUrl, emitAffiliateClick } from '../utils/booking';`
- Remove `import BookingModal from './BookingModal';`
- Add `import EnrichedPanel from './EnrichedPanel';`
- Remove the entire `{bookingUrl ? <a ...Find this route on Aviasales...</a> : <button ...Book</button>}` block (lines ~150–175)
- Remove the `{showBooking && <BookingModal ... />}` fragment at bottom
- Add `<EnrichedPanel flight={flight} user={user} />` in place of the removed block

You'll also need to get `user` into FlightCard — either via `useAuth()` hook, a prop chain from the page-level component, or a tiny new `AuthContext`. If none exists, introduce a minimal context:

```jsx
// client/src/context/AuthContext.jsx (only if not already present)
import { createContext, useContext, useEffect, useState } from 'react';
import { API_BASE } from '../config/api';

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);

  const refreshUser = async () => {
    const token = localStorage.getItem('authToken');
    if (!token) { setUser(null); return null; }
    try {
      const r = await fetch(`${API_BASE}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
      const j = await r.json();
      const next = j.user || null;
      setUser(next);
      return next;
    } catch {
      return null;
    }
  };

  useEffect(() => { refreshUser(); }, []);

  return (
    <AuthContext.Provider value={{ user, setUser, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}
```

Wrap `<App />` in `<AuthProvider>` at the root (`main.jsx` or `App.jsx`).

Inside FlightCard:
```jsx
import { useAuth } from '../context/AuthContext';
// ...
const { user } = useAuth();
// ...
<EnrichedPanel flight={flight} user={user} />
```

- [ ] **Step 2: Delete affiliate files**

```bash
git rm client/src/components/BookingModal.jsx
git rm client/src/utils/booking.js
git rm client/src/components/BookingModal.css   # if exists (otherwise skip with --ignore-unmatch)
```

- [ ] **Step 3: Verify build + visual smoke**

```bash
cd client && npm run build
```
Expected: no import errors for `BookingModal` / `buildBookingUrl`.

Run dev:
```bash
cd client && npm run dev
```
Browse to a search result, confirm the new EnrichedPanel renders (teasers if logged out, real values if logged in as Pro).

- [ ] **Step 4: Commit**

```bash
git add client/src/components/FlightCard.jsx client/src/context/AuthContext.jsx  # and any other touched files
git commit -m "feat(ui): replace Aviasales CTA with EnrichedPanel; delete booking affiliate"
```

---

## Task 8: Remove affiliate references in SEO + copy

**Files:**
- Modify: `server/src/services/seoMetaService.js`
- Modify: `client/index.html`

- [ ] **Step 1: Grep remaining copy**

Run: `grep -rn "book flights\|Book flights\|Aviasales\|book your" client/ server/src/services/seoMetaService.js`

- [ ] **Step 2: Replace marketing copy**

Swap any "book flights" / "compare prices and book" phrases with neutral positioning:
- "Find flights by aircraft, route, and price"
- "Search by aircraft type, see the actual plane, and track delays"

Leave Travelpayouts hostname references in CSP / services alone.

- [ ] **Step 3: Commit**

```bash
git add server/src/services/seoMetaService.js client/index.html
git commit -m "chore(seo): remove affiliate-booking copy from meta descriptions"
```

---

## Task 9: Kill-switch for the enriched card

**Files:**
- Modify: `client/src/components/FlightCard.jsx` (small guard)
- Modify: `server/.env.example`

Per spec, `ENRICHED_CARD=0` rolls back to the old card layout in one flag flip.

- [ ] **Step 1: Expose flag via /api/auth/me or /api/config**

Simplest: add a cheap endpoint `GET /api/config/client` that returns `{ enrichedCardEnabled: process.env.ENRICHED_CARD !== '0' }`. Wire in `server/src/routes/` and mount. Client fetches once on mount (cached).

- [ ] **Step 2: Client guard**

In `FlightCard.jsx`, if `!config.enrichedCardEnabled`, render the previous-style card body (or `null` enriched block). Keep the change small — just wrap `<EnrichedPanel />` in a conditional.

- [ ] **Step 3: Env example**

Append to `server/.env.example`:

```
ENRICHED_CARD=1  # set to 0 to hide the γ panel and teasers
```

- [ ] **Step 4: Commit**

```bash
git add server/src/routes/config.js server/src/index.js client/src/components/FlightCard.jsx server/.env.example
git commit -m "feat(flags): ENRICHED_CARD kill switch exposed via /api/config/client"
```

---

## Task 10: End-to-end smoke (local)

- [ ] **Step 1: Login as free user → teaser visible**

Sign up a new user without subscribing, search a route, confirm:
- No "Find on Aviasales" button
- EnrichedPanel renders; livery / on-time / CO₂ blocks are blurred with "🔒 Pro"
- Click → UpgradeModal appears with contextual reason, "See plans" links to `/pricing`

- [ ] **Step 2: Promote yourself to Pro via SQLite**

```sql
UPDATE users SET subscription_tier = 'pro_lifetime' WHERE email = 'you@example.com';
```
Refresh the page. EnrichedPanel now shows values (or `—` for fields without data yet — that's fine).

- [ ] **Step 3: Flip ENRICHED_CARD=0**

Restart server. Visit — EnrichedPanel should be gone, no upgrade modal, old card style restored.

- [ ] **Step 4: Full test suite**

```bash
cd server && npm test
cd ../client && npm run test
```

---

## Self-review checklist

- [ ] `/api/flights/:id/enriched` returns 403 PAYWALL for free users (Plan 1 `requireTier`)
- [ ] `/teaser` returns `tier: 'free'` + all-null `data` with the SAME keys as the full payload
- [ ] FlightCard no longer imports `buildBookingUrl` / `emitAffiliateClick` / `BookingModal`
- [ ] `client/src/utils/booking.js` and `client/src/components/BookingModal.jsx` deleted
- [ ] Grepping the repo for `Aviasales` returns only comments and Travelpayouts service (data source)
- [ ] UpgradeModal renders with `reason` prop and links to `/pricing`
- [ ] `ENRICHED_CARD=0` cleanly hides the panel
- [ ] `enrichedCard.shape.test.js` passes
- [ ] `UpgradeModal.test.jsx` passes
- [ ] Client builds cleanly: `npm run build -w client`

Next plan: **Plan 4 — α My Trips + web-push** (uses the same AuthContext and UpgradeModal).
