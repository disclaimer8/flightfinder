# AirLabs Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace stale routes.dat + empty Wikidata with AirLabs scheduled routes, activate aircraft/airline enrichment already written in airlabsService.js, and simplify the client to 2 confidence tiers (live + scheduled).

**Architecture:** AirLabs `/routes` endpoint (paginated, 24h cache) becomes the primary scheduled-routes source. OpenSky stays as the live tier (12h ADS-B window). Dead code (wikidataService, routes.dat, Wikidata refresh workflow) is deleted. Client removes the historical tier entirely.

**Tech Stack:** Node.js (server), React (client), Jest (tests), axios (AirLabs calls via existing pattern in airlabsService.js)

---

## File Map

| File | Action | What changes |
|---|---|---|
| `server/src/services/airlabsService.js` | **Modify** | Add `getRoutes(iata)` with pagination + 24h cache |
| `server/src/services/routesService.js` | **Rewrite** | Use AirLabs + OpenSky only; remove wikidata + historical |
| `server/src/services/openFlightsService.js` | **Modify** | Delete routesMap, routes.dat parsing, `getDirectDestinations()` |
| `server/src/services/wikidataService.js` | **Delete** | Dead source |
| `server/src/data/wikidata-routes.json` | **Delete** | Empty stub |
| `server/src/data/routes.dat` | **Delete** | Stale 2017 data |
| `scripts/refresh-wikidata-routes.js` | **Delete** | No longer needed |
| `.github/workflows/wikidata-routes-refresh.yml` | **Delete** | No longer needed |
| `.github/workflows/deploy.yml` | **Modify** | Inject AIRLABS_API_KEY via Secrets |
| `server/.env` | **Modify** | Add AIRLABS_API_KEY |
| `server/src/__tests__/routes.test.js` | **Create** | Unit tests for airlabsService.getRoutes + routesService.getRoutes |
| `client/src/components/RouteMap.jsx` | **Modify** | Remove historical tier, toggle button, showHistorical state |
| `client/src/components/RouteMap.css` | **Modify** | Remove `.rm-legend-dot--historical` |

---

## Task 1: Add `getRoutes(iata)` to airlabsService with pagination and cache

**Files:**
- Modify: `server/src/services/airlabsService.js`
- Create: `server/src/__tests__/routes.test.js`

AirLabs `/routes` returns up to 50 entries per page. Each entry has `arr_iata` (destination IATA). Pagination via `offset` param (0, 50, 100…). Stop when page returns 0 entries or after 20 pages max (1000 entries covers the largest hubs).

- [ ] **Step 1: Write the failing test**

Create `server/src/__tests__/routes.test.js`:

```js
'use strict';

jest.mock('axios');
const axios = require('axios');

// Must set env before requiring module (module reads env at load time)
beforeAll(() => {
  process.env.AIRLABS_API_KEY = 'test-key';
});

const airlabsService = require('../services/airlabsService');

afterEach(() => {
  airlabsService._clearRoutesCache();
  jest.clearAllMocks();
});

describe('airlabsService.getRoutes', () => {
  it('returns deduplicated arr_iata set from paginated response', async () => {
    // Page 1: 2 routes to JFK (two airlines), 1 to CDG
    axios.get
      .mockResolvedValueOnce({ data: { response: [
        { arr_iata: 'JFK', dep_iata: 'LHR' },
        { arr_iata: 'JFK', dep_iata: 'LHR' },
        { arr_iata: 'CDG', dep_iata: 'LHR' },
      ]}})
      // Page 2: empty → stop
      .mockResolvedValueOnce({ data: { response: [] }});

    const result = await airlabsService.getRoutes('LHR');
    expect(result).toBeInstanceOf(Set);
    expect(result.size).toBe(2);
    expect(result.has('JFK')).toBe(true);
    expect(result.has('CDG')).toBe(true);
  });

  it('returns empty Set when API key missing', async () => {
    const savedKey = process.env.AIRLABS_API_KEY;
    delete process.env.AIRLABS_API_KEY;
    airlabsService._clearRoutesCache();

    const result = await airlabsService.getRoutes('LHR');
    expect(result).toBeInstanceOf(Set);
    expect(result.size).toBe(0);
    expect(axios.get).not.toHaveBeenCalled();

    process.env.AIRLABS_API_KEY = savedKey;
  });

  it('returns empty Set on network error', async () => {
    axios.get.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const result = await airlabsService.getRoutes('LHR');
    expect(result).toBeInstanceOf(Set);
    expect(result.size).toBe(0);
  });

  it('serves cache on second call without extra HTTP requests', async () => {
    axios.get
      .mockResolvedValueOnce({ data: { response: [{ arr_iata: 'JFK', dep_iata: 'LHR' }] }})
      .mockResolvedValueOnce({ data: { response: [] }});

    await airlabsService.getRoutes('LHR');
    await airlabsService.getRoutes('LHR'); // second call
    // axios.get called twice: page 1 + empty page 2 (then cache hit)
    expect(axios.get).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd server && npx jest src/__tests__/routes.test.js --no-coverage 2>&1 | tail -20
```

Expected: `Cannot find module '../services/airlabsService'` or `airlabsService.getRoutes is not a function`

- [ ] **Step 3: Implement `getRoutes` in airlabsService.js**

Add after the existing `getMultipleAirlines` function (around line 125), before `classifyAircraftType`:

```js
// ── Route cache: iata → Set<arr_iata>, expires after 24h ─────────────────────
const _routesCache = new Map(); // iata → { dests: Set, fetchedAt: number }
const ROUTES_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 h

/** Exposed for tests only */
exports._clearRoutesCache = () => _routesCache.clear();

/**
 * Fetch all direct destination IATA codes from an origin airport.
 * Paginates AirLabs /routes (50 results per page, offset param).
 * Returns empty Set gracefully when key absent or on any error.
 *
 * @param {string} iata  3-letter origin IATA
 * @returns {Promise<Set<string>>}
 */
exports.getRoutes = async (iata) => {
  if (!AIRLABS_API_KEY) return new Set();

  const code = iata.toUpperCase();
  const cached = _routesCache.get(code);
  if (cached && (Date.now() - cached.fetchedAt) < ROUTES_CACHE_TTL) {
    return cached.dests;
  }

  const dests = new Set();
  let offset = 0;
  const MAX_PAGES = 20;

  try {
    for (let page = 0; page < MAX_PAGES; page++) {
      const response = await airlabsClient.get('/routes', {
        params: { dep_iata: code, api_key: AIRLABS_API_KEY, offset },
      });
      const rows = response.data?.response ?? [];
      if (!rows.length) break;
      for (const row of rows) {
        if (row.arr_iata && row.arr_iata.length === 3) dests.add(row.arr_iata);
      }
      offset += 50;
    }
  } catch (err) {
    console.warn(`[airlabs] getRoutes failed for ${code}:`, err.message);
    return dests; // return whatever we collected before the error
  }

  _routesCache.set(code, { dests, fetchedAt: Date.now() });
  return dests;
};
```

- [ ] **Step 4: Run test — expect PASS**

```bash
cd server && npx jest src/__tests__/routes.test.js --no-coverage 2>&1 | tail -10
```

Expected: `4 passed`

- [ ] **Step 5: Commit**

```bash
git add server/src/services/airlabsService.js server/src/__tests__/routes.test.js
git commit -m "feat: add airlabsService.getRoutes with pagination and 24h cache"
```

---

## Task 2: Rewrite routesService to use AirLabs + OpenSky only

**Files:**
- Modify: `server/src/services/routesService.js`
- Modify: `server/src/__tests__/routes.test.js` (add routesService tests)

- [ ] **Step 1: Write the failing tests for routesService**

Append to `server/src/__tests__/routes.test.js`:

```js
jest.mock('../services/openSkyService');
jest.mock('../services/airlabsService');

const openSkyService  = require('../services/openSkyService');
const airlabsService2 = require('../services/airlabsService');

// Re-require routesService after mocks are set up
let routesService;
beforeEach(() => {
  jest.resetModules();
  routesService = require('../services/routesService');
});

describe('routesService.getRoutes', () => {
  it('marks destinations live when OpenSky has them', async () => {
    openSkyService.getDepartures.mockResolvedValue([
      { destIata: 'JFK', lastSeen: new Date() },
    ]);
    airlabsService2.getRoutes.mockResolvedValue(new Set(['JFK', 'CDG']));

    const result = await routesService.getRoutes('LHR');

    expect(result.confidences['JFK']).toBe('live');
    expect(result.confidences['CDG']).toBe('scheduled');
    expect(result.destinations).toContain('JFK');
    expect(result.destinations).toContain('CDG');
  });

  it('marks all destinations scheduled when OpenSky returns empty', async () => {
    openSkyService.getDepartures.mockResolvedValue([]);
    airlabsService2.getRoutes.mockResolvedValue(new Set(['CDG', 'AMS']));

    const result = await routesService.getRoutes('LHR');

    expect(result.confidences['CDG']).toBe('scheduled');
    expect(result.confidences['AMS']).toBe('scheduled');
  });

  it('returns empty destinations when both sources empty', async () => {
    openSkyService.getDepartures.mockResolvedValue([]);
    airlabsService2.getRoutes.mockResolvedValue(new Set());

    const result = await routesService.getRoutes('LHR');

    expect(result.destinations).toHaveLength(0);
    expect(result.origin).toBe('LHR');
  });

  it('does not include self-loops in destinations', async () => {
    openSkyService.getDepartures.mockResolvedValue([
      { destIata: 'LHR', lastSeen: new Date() }, // self-loop from OpenSky
    ]);
    airlabsService2.getRoutes.mockResolvedValue(new Set(['LHR', 'JFK'])); // self-loop from AirLabs

    const result = await routesService.getRoutes('LHR');

    expect(result.destinations).not.toContain('LHR');
    expect(result.destinations).toContain('JFK');
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd server && npx jest src/__tests__/routes.test.js --no-coverage 2>&1 | tail -15
```

Expected: tests about `routesService` fail (module doesn't match new interface yet)

- [ ] **Step 3: Rewrite routesService.js**

Replace the entire content of `server/src/services/routesService.js`:

```js
'use strict';

const openFlights    = require('./openFlightsService');
const openSkyService = require('./openSkyService');
const airlabsService = require('./airlabsService');

/**
 * Merge routes from AirLabs (scheduled) and OpenSky (live ADS-B).
 *
 * Confidence tiers:
 *   live      — seen departing in last 12h via OpenSky
 *   scheduled — current airline schedule via AirLabs
 *
 * @param {string} iata  3-letter IATA origin
 * @returns {Promise<{
 *   origin: string,
 *   destinations: string[],
 *   confidences: Record<string, 'live'|'scheduled'>
 * }>}
 */
exports.getRoutes = async (iata) => {
  const code    = iata.toUpperCase();
  const airport = openFlights.getAirport(code);
  const icao    = airport?.icao;

  // ── 1. OpenSky (live ADS-B, last 12h) ──────────────────────────────────────
  let openSkyMap = new Map(); // destIata → lastSeen Date
  if (icao) {
    try {
      const departures = await openSkyService.getDepartures(icao);
      for (const { destIata, lastSeen } of departures) {
        const prev = openSkyMap.get(destIata);
        if (!prev || lastSeen > prev) openSkyMap.set(destIata, lastSeen);
      }
    } catch (err) {
      console.warn(`[routes] OpenSky error for ${code}:`, err.message);
    }
  }

  // ── 2. AirLabs (scheduled routes, 24h cache) ───────────────────────────────
  let airlabsSet = new Set();
  try {
    airlabsSet = await airlabsService.getRoutes(code);
  } catch (err) {
    console.warn(`[routes] AirLabs error for ${code}:`, err.message);
  }

  // ── Merge: live wins over scheduled ────────────────────────────────────────
  const allDest = new Set([...openSkyMap.keys(), ...airlabsSet]);

  const confidences = {};
  for (const dest of allDest) {
    if (dest === code) continue; // skip self-loops
    confidences[dest] = openSkyMap.has(dest) ? 'live' : 'scheduled';
  }

  const destinations = Object.keys(confidences);
  return { origin: code, destinations, confidences };
};
```

- [ ] **Step 4: Run all routes tests — expect PASS**

```bash
cd server && npx jest src/__tests__/routes.test.js --no-coverage 2>&1 | tail -10
```

Expected: all tests pass

- [ ] **Step 5: Commit**

```bash
git add server/src/services/routesService.js server/src/__tests__/routes.test.js
git commit -m "feat: rewrite routesService — AirLabs scheduled + OpenSky live, remove historical"
```

---

## Task 3: Remove routes.dat from openFlightsService

**Files:**
- Modify: `server/src/services/openFlightsService.js`
- Delete: `server/src/data/routes.dat`

- [ ] **Step 1: Delete routes.dat parsing from openFlightsService.js**

Remove lines 60–106 in `server/src/services/openFlightsService.js` (the `routesMap` block and `getDirectDestinations` export). Replace with nothing.

The `console.log` on the last line of loading (line 82) should also be updated to remove the `routesMap.size` reference:

```js
// Change this line:
console.log(`[openflights] Loaded ${airportsMap.size} airports, ${airlinesMap.size} airlines, ${routesMap.size} route origins`);

// To:
console.log(`[openflights] Loaded ${airportsMap.size} airports, ${airlinesMap.size} airlines`);
```

The final exports block (after the deletion) should be:

```js
/** Look up an airport by IATA code */
exports.getAirport = (iata) => airportsMap.get(iata?.toUpperCase()) || null;

/** Look up an airline by IATA code */
exports.getAirline = (iata) => airlinesMap.get(iata?.toUpperCase()) || null;

/** Validate that an IATA airport code exists */
exports.isValidAirport = (iata) => airportsMap.has(iata?.toUpperCase());

/** Get city name for an airport code */
exports.getCity = (iata) => airportsMap.get(iata?.toUpperCase())?.city || iata;

/** Get country for an airport code */
exports.getCountry = (iata) => airportsMap.get(iata?.toUpperCase())?.country || null;

/** Get all airports as array (for search UI) */
exports.getAllAirports = () => Array.from(airportsMap.values());

/** Resolve an ICAO 4-letter code to an IATA 3-letter code */
exports.getAirportByIcao = (icao) => {
  if (!icao || icao.length !== 4) return null;
  const iata = icaoMap.get(icao.toUpperCase());
  return iata ? airportsMap.get(iata) : null;
};
```

- [ ] **Step 2: Delete routes.dat**

```bash
rm server/src/data/routes.dat
```

- [ ] **Step 3: Verify server still starts**

```bash
cd server && node -e "require('./src/services/openFlightsService'); console.log('OK')" 2>&1 | grep -v '^$'
```

Expected: `[openflights] Loaded 6072 airports, 993 airlines` then `OK` — no mention of routes

- [ ] **Step 4: Run full test suite**

```bash
cd server && npx jest --no-coverage 2>&1 | tail -15
```

Expected: all tests pass (routes.test.js + auth.test.js)

- [ ] **Step 5: Commit**

```bash
git add server/src/services/openFlightsService.js
git rm server/src/data/routes.dat
git commit -m "chore: remove routes.dat and getDirectDestinations — replaced by AirLabs"
```

---

## Task 4: Delete dead code — Wikidata service, scripts, workflow

**Files:**
- Delete: `server/src/services/wikidataService.js`
- Delete: `server/src/data/wikidata-routes.json`
- Delete: `scripts/refresh-wikidata-routes.js`
- Delete: `.github/workflows/wikidata-routes-refresh.yml`

- [ ] **Step 1: Delete the files**

```bash
git rm server/src/services/wikidataService.js
git rm server/src/data/wikidata-routes.json
git rm scripts/refresh-wikidata-routes.js
git rm .github/workflows/wikidata-routes-refresh.yml
```

- [ ] **Step 2: Verify server starts cleanly**

```bash
cd server && node -e "require('./src/index')" 2>&1 | head -10
```

Expected: no errors about missing `wikidataService` module

- [ ] **Step 3: Run full test suite**

```bash
cd server && npx jest --no-coverage 2>&1 | tail -10
```

Expected: all tests pass

- [ ] **Step 4: Commit**

```bash
git commit -m "chore: delete Wikidata service, script, and refresh workflow"
```

---

## Task 5: Configure AIRLABS_API_KEY in env and deploy pipeline

**Files:**
- Modify: `server/.env`
- Modify: `.github/workflows/deploy.yml`

- [ ] **Step 1: Add key to local .env**

Add to `server/.env` (after the existing OPENSKY lines):

```
AIRLABS_API_KEY=2464f9d7-4b8b-46b3-8d89-2da97f648b46
```

- [ ] **Step 2: Update deploy.yml — env block**

In `.github/workflows/deploy.yml`, add `AIRLABS_API_KEY` to the top-level `env:` block:

```yaml
env:
  OPENSKY_USERNAME: ${{ secrets.OPENSKY_USERNAME }}
  OPENSKY_PASSWORD: ${{ secrets.OPENSKY_PASSWORD }}
  AIRLABS_API_KEY: ${{ secrets.AIRLABS_API_KEY }}
```

- [ ] **Step 3: Update deploy.yml — script block**

In the deploy script section (after the existing `OPENSKY_` lines), add:

```bash
sed -i '/^AIRLABS_/d' server/.env
echo "AIRLABS_API_KEY=${AIRLABS_API_KEY}" >> server/.env
```

The full secrets injection block should look like:

```bash
sed -i '/^OPENSKY_/d' server/.env
echo "OPENSKY_USERNAME=${OPENSKY_USERNAME}" >> server/.env
echo "OPENSKY_PASSWORD=${OPENSKY_PASSWORD}" >> server/.env
sed -i '/^AIRLABS_/d' server/.env
echo "AIRLABS_API_KEY=${AIRLABS_API_KEY}" >> server/.env
```

- [ ] **Step 4: Verify key is picked up**

```bash
cd server && AIRLABS_API_KEY=2464f9d7-4b8b-46b3-8d89-2da97f648b46 node -e "
const a = require('./src/services/airlabsService');
a.getRoutes('DUB').then(s => console.log('DUB routes:', s.size, 'destinations')).catch(console.error);
" 2>&1 | grep -v '^\[openflights\]'
```

Expected: `DUB routes: N destinations` (where N > 0 with trial key)

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/deploy.yml
git commit -m "feat: inject AIRLABS_API_KEY into production env via deploy pipeline"
```

Note: `server/.env` is gitignored — do not commit it. Add `AIRLABS_API_KEY` to GitHub Secrets manually before pushing.

---

## Task 6: Simplify RouteMap client — remove historical tier

**Files:**
- Modify: `client/src/components/RouteMap.jsx`
- Modify: `client/src/components/RouteMap.css`

- [ ] **Step 1: Update ARC_STYLE — remove historical**

In `client/src/components/RouteMap.jsx`, change the `ARC_STYLE` constant:

```js
const ARC_STYLE = {
  live:      { color: 'rgba(52,211,153,0.85)',  weight: 2.0, dashArray: null },
  scheduled: { color: 'rgba(99,140,200,0.65)',  weight: 1.4, dashArray: null },
};
```

- [ ] **Step 2: Remove showHistorical state, ref, and sync effect**

Remove these three lines:
```js
const [showHistorical, setShowHistorical] = useState(true);
const showHistoricalRef = useRef(true);
// ...
useEffect(() => { showHistoricalRef.current = showHistorical; }, [showHistorical]);
```

- [ ] **Step 3: Remove the redraw-on-toggle useEffect**

Remove the entire `// ── Redraw arcs when showHistorical toggles ───` useEffect block (the one with `[showHistorical]` dependency).

- [ ] **Step 4: Simplify arc drawing loop in loadRoutes**

In the `loadRoutes` function, the arc drawing loop currently has:
```js
if (confidence === 'historical' && !showHistoricalRef.current) continue;
```

Remove that line entirely. The loop becomes:

```js
for (const destIata of data.destinations) {
  const confidence = data.confidences?.[destIata] ?? 'scheduled';
  const idx = airportsDataRef.current?.pts.indexOf(destIata);
  if (idx === -1 || idx == null) continue;
  const dLat = airportsDataRef.current.crd[idx * 2];
  const dLon = airportsDataRef.current.crd[idx * 2 + 1];
  const pts  = geodesicPoints(ap.lat, ap.lon, dLat, dLon);
  const style = ARC_STYLE[confidence] ?? ARC_STYLE.scheduled;
  const line = L.polyline(pts, {
    color:       style.color,
    weight:      style.weight,
    dashArray:   style.dashArray,
    interactive: false,
  }).addTo(map);
  routeLinesRef.current.push(line);
}
```

- [ ] **Step 5: Remove historical toggle button**

Remove the `{routes && (<button ... >Hide/Show historical</button>)}` block entirely.

- [ ] **Step 6: Simplify legend**

Replace the legend JSX with:

```jsx
{routes && (
  <div className="rm-legend">
    <div className="rm-legend-row"><span className="rm-legend-dot rm-legend-dot--scheduled"/>Scheduled</div>
    <div className="rm-legend-row"><span className="rm-legend-dot rm-legend-dot--live"/>Live</div>
  </div>
)}
```

- [ ] **Step 7: Update hint text**

Find and remove any reference to "historical" in the hint text. The hint line:
```jsx
{routes.destinations.length > 0 && <> · tap a purple dot for calendar</>}
```
should stay; remove only the part that mentioned historical if present.

- [ ] **Step 8: Remove historical CSS rule**

In `client/src/components/RouteMap.css`, remove:

```css
.rm-legend-dot--historical { background: rgba(99,140,200,0.7); }
```

- [ ] **Step 9: Build the client to catch any reference errors**

```bash
cd client && npm run build 2>&1 | tail -20
```

Expected: build succeeds with no errors about `showHistorical` or `historical`

- [ ] **Step 10: Commit**

```bash
git add client/src/components/RouteMap.jsx client/src/components/RouteMap.css
git commit -m "feat: remove historical tier from route map — 2 tiers only (live + scheduled)"
```

---

## Task 7: End-to-end smoke test and push

- [ ] **Step 1: Run the full server test suite**

```bash
cd server && npx jest --no-coverage 2>&1 | tail -15
```

Expected: all tests pass

- [ ] **Step 2: Start server locally and test route map API**

```bash
cd server && npm start &
sleep 3
curl -s "http://localhost:5001/api/map/routes?origin=LHR" | node -e "
const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
const live = d.destinations.filter(x => d.confidences[x]==='live');
const sched = d.destinations.filter(x => d.confidences[x]==='scheduled');
console.log('Total:', d.destinations.length, '| Live:', live.length, '| Scheduled:', sched.length);
"
```

Expected: `Total: N | Live: M | Scheduled: N-M` (N > 0 even on trial key)

- [ ] **Step 3: Add AIRLABS_API_KEY to GitHub Secrets**

In GitHub → repo Settings → Secrets → Actions, add:
- Name: `AIRLABS_API_KEY`
- Value: `2464f9d7-4b8b-46b3-8d89-2da97f648b46`

- [ ] **Step 4: Push to trigger deploy**

```bash
git push origin main
```

Watch GitHub Actions — deploy should complete without errors. After deploy, verify on production:

```bash
curl -s "https://himaxym.com/api/map/routes?origin=LHR" | node -e "
const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
console.log('Production LHR routes:', d.destinations.length, '| confidences sample:', JSON.stringify(Object.fromEntries(Object.entries(d.confidences).slice(0,3))));
"
```

---

## Self-Review Checklist

**Spec coverage:**
- ✅ `airlabsService.getRoutes(iata)` — Task 1
- ✅ `routesService.js` rewrite (AirLabs + OpenSky, remove wikidata + historical) — Task 2
- ✅ Remove routes.dat + `getDirectDestinations` from openFlightsService — Task 3
- ✅ Delete wikidataService, wikidata-routes.json, refresh script, workflow — Task 4
- ✅ AIRLABS_API_KEY in env + deploy.yml — Task 5
- ✅ Client: remove historical tier, toggle, showHistorical state — Task 6
- ✅ Client: ARC_STYLE 2 tiers only — Task 6 Step 1
- ✅ Client: legend 2 rows — Task 6 Step 6
- ✅ Error handling (no key → empty Set, network error → empty Set) — Task 1 Step 3
- ✅ Cache 24h TTL — Task 1 Step 3

**Type consistency:**
- `airlabsService.getRoutes()` returns `Set<string>` — used as `Set` in routesService Task 2 Step 3 ✓
- `openSkyService.getDepartures()` returns `[{destIata, lastSeen}]` — unchanged ✓
- `routesService.getRoutes()` returns `{origin, destinations, confidences}` — unchanged interface ✓
- `ARC_STYLE` keys are `'live'` and `'scheduled'` — fallback in Task 6 Step 4 uses `ARC_STYLE.scheduled` ✓
