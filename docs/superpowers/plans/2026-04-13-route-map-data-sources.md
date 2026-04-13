# Route Map Data Sources Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Amadeus/routes.dat route data with OpenSky Network (live ADS-B traffic) + Wikidata SPARQL (scheduled routes), with colour-coded confidence tiers and a hidden-by-default historical toggle.

**Architecture:** Three server-side services (`openSkyService`, `wikidataService`, `routesService`) are orchestrated by `routesService.getRoutes(iata)` which merges results and assigns confidence tiers. `mapController.getRoutes` delegates entirely to `routesService`. The client draws arcs in three colours (green/yellow/gray) based on the `confidences` map returned by the API. A weekly GitHub Action regenerates `wikidata-routes.json`.

**Tech Stack:** Node.js/Express (server), axios (OpenSky HTTP), Wikidata SPARQL endpoint (no lib needed — plain HTTPS), Jest + supertest (tests), React + Leaflet (client), GitHub Actions (weekly refresh cron).

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Modify | `server/src/services/openFlightsService.js` | Add `icaoToIata` reverse-lookup map + `getAirportByIcao()` export |
| Create | `server/src/services/openSkyService.js` | Fetch departures from OpenSky API, in-memory 7-day cache, ICAO→IATA conversion |
| Create | `server/src/data/wikidata-routes.json` | Weekly-refreshed scheduled routes; empty `{}` stub until first Action run |
| Create | `server/src/services/wikidataService.js` | Load `wikidata-routes.json` at startup, expose `getRoutes(iata)` |
| Create | `server/src/services/routesService.js` | Orchestrate all three sources; merge with confidence tiers |
| Modify | `server/src/controllers/mapController.js` | `getRoutes` delegates to `routesService`; response shape changes |
| Create | `scripts/refresh-wikidata-routes.js` | SPARQL query → write `wikidata-routes.json` |
| Create | `.github/workflows/wikidata-routes-refresh.yml` | Weekly Monday 03:00 UTC cron |
| Modify | `client/src/components/RouteMap.jsx` | Colour arcs by confidence, `showHistorical` toggle, legend |
| Modify | `client/src/components/RouteMap.css` | Arc colour classes |
| Create | `server/__tests__/unit/openSkyService.test.js` | Unit tests |
| Create | `server/__tests__/unit/wikidataService.test.js` | Unit tests |
| Create | `server/__tests__/unit/routesService.test.js` | Unit tests |

---

## Task 1: ICAO reverse-lookup in openFlightsService

OpenSky returns ICAO 4-letter destination codes; we need to map them back to IATA.

**Files:**
- Modify: `server/src/services/openFlightsService.js`

- [ ] **Step 1: Add `icaoMap` and `getAirportByIcao` export**

In `server/src/services/openFlightsService.js`, add a second Map right after `airportsMap` is declared, and populate it in the same parse loop:

```js
// Add after airportsMap declaration (line ~24):
const icaoMap = new Map(); // ICAO → IATA

// Inside the forEach that populates airportsMap, add at the end of the block:
if (f[5] && f[5].length === 4) {
  icaoMap.set(f[5].toUpperCase(), iata);
}
```

Then add this export at the bottom of the file:

```js
/** Resolve an ICAO 4-letter code to an IATA 3-letter code */
exports.getAirportByIcao = (icao) => {
  if (!icao || icao.length !== 4) return null;
  const iata = icaoMap.get(icao.toUpperCase());
  return iata ? airportsMap.get(iata) : null;
};
```

- [ ] **Step 2: Verify in REPL**

```bash
cd /Users/denyskolomiiets/FLIGHT/server
node -e "const of = require('./src/services/openFlightsService'); console.log(of.getAirportByIcao('LEMD'));"
```

Expected output: `{ iata: 'MAD', name: ..., city: 'Madrid', ... }`

- [ ] **Step 3: Commit**

```bash
git add server/src/services/openFlightsService.js
git commit -m "feat: add ICAO→IATA reverse lookup to openFlightsService"
```

---

## Task 2: openSkyService — live ADS-B departures

**Files:**
- Create: `server/src/services/openSkyService.js`
- Create: `server/__tests__/unit/openSkyService.test.js`

- [ ] **Step 1: Write failing tests**

Create `server/__tests__/unit/openSkyService.test.js`:

```js
'use strict';

jest.mock('axios');
jest.mock('../../src/services/openFlightsService', () => ({
  getAirportByIcao: (icao) => {
    const map = { EGLL: { iata: 'LHR' }, LEMD: { iata: 'MAD' }, LFPG: { iata: 'CDG' } };
    return map[icao] || null;
  },
}));

const axios = require('axios');
const openSkyService = require('../../src/services/openSkyService');

const NOW = 1713304800; // fixed "now" for tests

beforeEach(() => {
  jest.clearAllMocks();
  openSkyService._clearCache();
});

describe('getDepartures', () => {
  test('returns destinations with lastSeen dates on success', async () => {
    axios.get.mockResolvedValue({
      data: [
        { estArrivalAirport: 'EGLL', lastSeen: NOW - 100 },
        { estArrivalAirport: 'LFPG', lastSeen: NOW - 200 },
        { estArrivalAirport: null,   lastSeen: NOW - 300 }, // should be filtered
      ],
    });

    const result = await openSkyService.getDepartures('LEMD', 7);

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ destIata: 'LHR' });
    expect(result[1]).toMatchObject({ destIata: 'CDG' });
    expect(result[0].lastSeen).toBeInstanceOf(Date);
  });

  test('returns empty array when OpenSky returns 404', async () => {
    axios.get.mockRejectedValue({ response: { status: 404 } });
    const result = await openSkyService.getDepartures('ZZZZ', 7);
    expect(result).toEqual([]);
  });

  test('deduplicates destinations — keeps most recent lastSeen', async () => {
    axios.get.mockResolvedValue({
      data: [
        { estArrivalAirport: 'EGLL', lastSeen: NOW - 100 },
        { estArrivalAirport: 'EGLL', lastSeen: NOW - 50 }, // newer
      ],
    });

    const result = await openSkyService.getDepartures('LEMD', 7);
    expect(result).toHaveLength(1);
    expect(result[0].lastSeen.getTime()).toBe((NOW - 50) * 1000);
  });

  test('caches result and does not call axios again within TTL', async () => {
    axios.get.mockResolvedValue({ data: [{ estArrivalAirport: 'EGLL', lastSeen: NOW }] });

    await openSkyService.getDepartures('LEMD', 7);
    await openSkyService.getDepartures('LEMD', 7);

    expect(axios.get).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test — confirm it fails**

```bash
cd /Users/denyskolomiiets/FLIGHT/server
npx jest __tests__/unit/openSkyService.test.js --no-coverage 2>&1 | tail -10
```

Expected: `Cannot find module '../../src/services/openSkyService'`

- [ ] **Step 3: Implement openSkyService.js**

Create `server/src/services/openSkyService.js`:

```js
'use strict';

const axios       = require('axios');
const openFlights = require('./openFlightsService');

// In-memory cache: icao → { routes: [{destIata, lastSeen}], fetchedAt }
const _cache = new Map();
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/** Exposed for tests only */
exports._clearCache = () => _cache.clear();

/**
 * Fetch direct destination airports seen departing from `icao` in the last
 * `daysBack` days (max 7 — OpenSky free tier limit per request).
 *
 * Requires OPENSKY_USERNAME + OPENSKY_PASSWORD env vars.
 * Returns [] silently when unauthenticated, rate-limited, or airport unknown.
 *
 * @param {string} icao   4-letter ICAO code of origin airport
 * @param {number} daysBack  1–7
 * @returns {Promise<{destIata: string, lastSeen: Date}[]>}
 */
exports.getDepartures = async (icao, daysBack = 7) => {
  if (!icao) return [];

  const code = icao.toUpperCase();

  // Return cached data if fresh
  const cached = _cache.get(code);
  if (cached && (Date.now() - cached.fetchedAt) < CACHE_TTL_MS) {
    return cached.routes;
  }

  const endUnix   = Math.floor(Date.now() / 1000);
  const beginUnix = endUnix - Math.min(daysBack, 7) * 86400;

  const url = `https://opensky-network.org/api/flights/departure?airport=${code}&begin=${beginUnix}&end=${endUnix}`;

  const config = {};
  if (process.env.OPENSKY_USERNAME && process.env.OPENSKY_PASSWORD) {
    config.auth = {
      username: process.env.OPENSKY_USERNAME,
      password: process.env.OPENSKY_PASSWORD,
    };
  }

  let raw = [];
  try {
    const res = await axios.get(url, { ...config, timeout: 15000 });
    raw = Array.isArray(res.data) ? res.data : [];
  } catch (err) {
    // 404 = no flights in window; 429 = rate limited; network errors
    console.warn(`[opensky] fetch failed for ${code}: ${err?.response?.status ?? err.message}`);
    // Return stale cache if available
    return cached ? cached.routes : [];
  }

  // Deduplicate: keep most recent lastSeen per destination
  const byDest = new Map();
  for (const flight of raw) {
    const destIcao = flight.estArrivalAirport;
    if (!destIcao) continue;
    const airport = openFlights.getAirportByIcao(destIcao);
    if (!airport) continue;
    const lastSeen = new Date(flight.lastSeen * 1000);
    const prev = byDest.get(airport.iata);
    if (!prev || lastSeen > prev) byDest.set(airport.iata, lastSeen);
  }

  const routes = Array.from(byDest.entries()).map(([destIata, lastSeen]) => ({ destIata, lastSeen }));
  _cache.set(code, { routes, fetchedAt: Date.now() });
  return routes;
};
```

- [ ] **Step 4: Run tests — confirm they pass**

```bash
cd /Users/denyskolomiiets/FLIGHT/server
npx jest __tests__/unit/openSkyService.test.js --no-coverage 2>&1 | tail -10
```

Expected: `Tests: 4 passed`

- [ ] **Step 5: Commit**

```bash
git add server/src/services/openSkyService.js server/__tests__/unit/openSkyService.test.js
git commit -m "feat: add openSkyService with 7-day departure cache"
```

---

## Task 3: wikidataService — scheduled routes from JSON

**Files:**
- Create: `server/src/data/wikidata-routes.json`
- Create: `server/src/services/wikidataService.js`
- Create: `server/__tests__/unit/wikidataService.test.js`

- [ ] **Step 1: Create empty stub JSON**

Create `server/src/data/wikidata-routes.json`:

```json
{}
```

- [ ] **Step 2: Write failing tests**

Create `server/__tests__/unit/wikidataService.test.js`:

```js
'use strict';

jest.mock('../../src/data/wikidata-routes.json', () => ({
  MAD: ['BCN', 'LHR', 'CDG'],
  LHR: ['JFK', 'LAX'],
}), { virtual: false });

const wikidataService = require('../../src/services/wikidataService');

describe('wikidataService', () => {
  test('getRoutes returns Set of destinations for known airport', () => {
    const result = wikidataService.getRoutes('MAD');
    expect(result).toBeInstanceOf(Set);
    expect(result.has('BCN')).toBe(true);
    expect(result.has('LHR')).toBe(true);
    expect(result.size).toBe(3);
  });

  test('getRoutes returns empty Set for unknown airport', () => {
    const result = wikidataService.getRoutes('ZZZ');
    expect(result).toBeInstanceOf(Set);
    expect(result.size).toBe(0);
  });

  test('getRoutes is case-insensitive', () => {
    const result = wikidataService.getRoutes('mad');
    expect(result.has('BCN')).toBe(true);
  });
});
```

- [ ] **Step 3: Run test — confirm it fails**

```bash
cd /Users/denyskolomiiets/FLIGHT/server
npx jest __tests__/unit/wikidataService.test.js --no-coverage 2>&1 | tail -5
```

Expected: `Cannot find module '../../src/services/wikidataService'`

- [ ] **Step 4: Implement wikidataService.js**

Create `server/src/services/wikidataService.js`:

```js
'use strict';

const path = require('path');

let _data = {};
try {
  _data = require('../data/wikidata-routes.json');
} catch {
  console.warn('[wikidata] wikidata-routes.json not found — scheduled routes unavailable');
}

/**
 * Get scheduled destination IATA codes for an origin airport.
 * Data comes from the weekly-refreshed wikidata-routes.json.
 *
 * @param {string} iata  3-letter IATA code
 * @returns {Set<string>}
 */
exports.getRoutes = (iata) => {
  if (!iata) return new Set();
  const dests = _data[iata.toUpperCase()];
  return new Set(Array.isArray(dests) ? dests : []);
};

/** Path to the JSON file — used by the refresh script */
exports.DATA_FILE = path.join(__dirname, '../data/wikidata-routes.json');
```

- [ ] **Step 5: Run tests — confirm they pass**

```bash
cd /Users/denyskolomiiets/FLIGHT/server
npx jest __tests__/unit/wikidataService.test.js --no-coverage 2>&1 | tail -5
```

Expected: `Tests: 3 passed`

- [ ] **Step 6: Commit**

```bash
git add server/src/data/wikidata-routes.json server/src/services/wikidataService.js server/__tests__/unit/wikidataService.test.js
git commit -m "feat: add wikidataService loading scheduled routes from JSON"
```

---

## Task 4: routesService — merge all three sources

**Files:**
- Create: `server/src/services/routesService.js`
- Create: `server/__tests__/unit/routesService.test.js`

- [ ] **Step 1: Write failing tests**

Create `server/__tests__/unit/routesService.test.js`:

```js
'use strict';

const NOW = Date.now();

jest.mock('../../src/services/openSkyService', () => ({
  getDepartures: jest.fn(),
}));
jest.mock('../../src/services/wikidataService', () => ({
  getRoutes: jest.fn(),
}));
jest.mock('../../src/services/openFlightsService', () => ({
  getAirport:              jest.fn().mockReturnValue({ iata: 'MAD', icao: 'LEMD' }),
  getDirectDestinations:   jest.fn(),
}));

const openSkyService  = require('../../src/services/openSkyService');
const wikidataService = require('../../src/services/wikidataService');
const openFlights     = require('../../src/services/openFlightsService');
const routesService   = require('../../src/services/routesService');

beforeEach(() => jest.clearAllMocks());

describe('routesService.getRoutes', () => {
  test('live confidence: OpenSky result within 7 days', async () => {
    openSkyService.getDepartures.mockResolvedValue([
      { destIata: 'LHR', lastSeen: new Date(NOW - 2 * 86400 * 1000) }, // 2 days ago
    ]);
    wikidataService.getRoutes.mockReturnValue(new Set());
    openFlights.getDirectDestinations.mockReturnValue([]);

    const result = await routesService.getRoutes('MAD');
    expect(result.confidences['LHR']).toBe('live');
    expect(result.destinations).toContain('LHR');
  });

  test('scheduled confidence: Wikidata-only route', async () => {
    openSkyService.getDepartures.mockResolvedValue([]);
    wikidataService.getRoutes.mockReturnValue(new Set(['BCN']));
    openFlights.getDirectDestinations.mockReturnValue([]);

    const result = await routesService.getRoutes('MAD');
    expect(result.confidences['BCN']).toBe('scheduled');
  });

  test('historical confidence: routes.dat-only route', async () => {
    openSkyService.getDepartures.mockResolvedValue([]);
    wikidataService.getRoutes.mockReturnValue(new Set());
    openFlights.getDirectDestinations.mockReturnValue(['HAV']);

    const result = await routesService.getRoutes('MAD');
    expect(result.confidences['HAV']).toBe('historical');
  });

  test('live beats scheduled: same route in both sources gets live tier', async () => {
    openSkyService.getDepartures.mockResolvedValue([
      { destIata: 'JFK', lastSeen: new Date(NOW - 1 * 86400 * 1000) },
    ]);
    wikidataService.getRoutes.mockReturnValue(new Set(['JFK']));
    openFlights.getDirectDestinations.mockReturnValue(['JFK']);

    const result = await routesService.getRoutes('MAD');
    expect(result.confidences['JFK']).toBe('live');
  });

  test('continues gracefully when OpenSky throws', async () => {
    openSkyService.getDepartures.mockRejectedValue(new Error('network error'));
    wikidataService.getRoutes.mockReturnValue(new Set(['BCN']));
    openFlights.getDirectDestinations.mockReturnValue([]);

    const result = await routesService.getRoutes('MAD');
    expect(result.confidences['BCN']).toBe('scheduled');
  });

  test('response includes origin field', async () => {
    openSkyService.getDepartures.mockResolvedValue([]);
    wikidataService.getRoutes.mockReturnValue(new Set(['BCN']));
    openFlights.getDirectDestinations.mockReturnValue([]);

    const result = await routesService.getRoutes('MAD');
    expect(result.origin).toBe('MAD');
  });
});
```

- [ ] **Step 2: Run test — confirm it fails**

```bash
cd /Users/denyskolomiiets/FLIGHT/server
npx jest __tests__/unit/routesService.test.js --no-coverage 2>&1 | tail -5
```

Expected: `Cannot find module '../../src/services/routesService'`

- [ ] **Step 3: Implement routesService.js**

Create `server/src/services/routesService.js`:

```js
'use strict';

const openFlights     = require('./openFlightsService');
const openSkyService  = require('./openSkyService');
const wikidataService = require('./wikidataService');

const TIER_RANK = { live: 3, scheduled: 2, historical: 1 };

/**
 * Merge routes from all three sources for an origin airport.
 * Each destination gets the highest-confidence tier from any source that knows it.
 *
 * @param {string} iata  3-letter IATA origin
 * @returns {Promise<{
 *   origin: string,
 *   destinations: string[],
 *   confidences: Record<string, 'live'|'scheduled'|'historical'>
 * }>}
 */
exports.getRoutes = async (iata) => {
  const code    = iata.toUpperCase();
  const airport = openFlights.getAirport(code);
  const icao    = airport?.icao;

  // ── 1. OpenSky (live ADS-B traffic, last 7 days) ──────────────────────────
  let openSkyMap = new Map(); // destIata → lastSeen Date
  if (icao) {
    try {
      const departures = await openSkyService.getDepartures(icao, 7);
      for (const { destIata, lastSeen } of departures) {
        const prev = openSkyMap.get(destIata);
        if (!prev || lastSeen > prev) openSkyMap.set(destIata, lastSeen);
      }
    } catch (err) {
      console.warn(`[routes] OpenSky error for ${code}:`, err.message);
    }
  }

  // ── 2. Wikidata (scheduled routes, weekly refresh) ────────────────────────
  const wikidataSet = wikidataService.getRoutes(code);

  // ── 3. OpenFlights routes.dat (historical fallback) ───────────────────────
  const historicalSet = new Set(openFlights.getDirectDestinations(code));

  // ── Merge: assign highest-confidence tier per destination ─────────────────
  const allDest = new Set([
    ...openSkyMap.keys(),
    ...wikidataSet,
    ...historicalSet,
  ]);

  const confidences = {};
  for (const dest of allDest) {
    if (dest === code) continue; // skip self-loops
    if (openSkyMap.has(dest)) {
      confidences[dest] = 'live';
    } else if (wikidataSet.has(dest)) {
      confidences[dest] = 'scheduled';
    } else {
      confidences[dest] = 'historical';
    }
  }

  const destinations = Object.keys(confidences);
  return { origin: code, destinations, confidences };
};
```

- [ ] **Step 4: Run tests — confirm they pass**

```bash
cd /Users/denyskolomiiets/FLIGHT/server
npx jest __tests__/unit/routesService.test.js --no-coverage 2>&1 | tail -5
```

Expected: `Tests: 6 passed`

- [ ] **Step 5: Commit**

```bash
git add server/src/services/routesService.js server/__tests__/unit/routesService.test.js
git commit -m "feat: add routesService merging OpenSky + Wikidata + historical routes"
```

---

## Task 5: Update mapController to use routesService

**Files:**
- Modify: `server/src/controllers/mapController.js`

- [ ] **Step 1: Replace getRoutes implementation**

In `server/src/controllers/mapController.js`, add the import at the top:

```js
const routesService  = require('../services/routesService');
```

Then replace the entire `exports.getRoutes` function with:

```js
exports.getRoutes = async (req, res) => {
  const { origin } = req.query;
  if (!origin || !/^[A-Za-z]{3}$/.test(origin)) {
    return res.status(400).json({ error: 'origin: valid IATA code required' });
  }
  const code     = origin.toUpperCase();
  const cacheKey = `map:routes:${code}`;
  const cached   = cacheService.get(cacheKey);
  if (cached) return res.json(cached);

  try {
    const result = await routesService.getRoutes(code);
    if (!result.destinations.length) {
      return res.status(404).json({ error: 'No routes found for this airport code' });
    }
    cacheService.set(cacheKey, result, 3600); // 1 h
    res.json(result);
  } catch (err) {
    console.error('[map] getRoutes error:', err.message);
    res.status(502).json({ error: 'Failed to fetch routes' });
  }
};
```

Also remove the `amadeusService` import from mapController if it is no longer used by any other function in that file (check `getFlightDates` — it uses `amadeusService.flightDates`; if so, keep the import).

- [ ] **Step 2: Run all server tests**

```bash
cd /Users/denyskolomiiets/FLIGHT/server
npx jest --no-coverage 2>&1 | tail -15
```

Expected: all existing tests still pass (integration tests mock `routesService` isn't needed — they mock at a higher level via supertest).

- [ ] **Step 3: Commit**

```bash
git add server/src/controllers/mapController.js
git commit -m "feat: mapController.getRoutes delegates to routesService"
```

---

## Task 6: Wikidata refresh script + GitHub Action

**Files:**
- Create: `scripts/refresh-wikidata-routes.js`
- Create: `.github/workflows/wikidata-routes-refresh.yml`

- [ ] **Step 1: Create the refresh script**

Create `scripts/refresh-wikidata-routes.js`:

```js
#!/usr/bin/env node
'use strict';

/**
 * Fetches airline routes from Wikidata SPARQL and writes
 * server/src/data/wikidata-routes.json  (format: { IATA: [IATA, ...] })
 *
 * Run manually:  node scripts/refresh-wikidata-routes.js
 * Runs weekly:   .github/workflows/wikidata-routes-refresh.yml
 */

const https = require('https');
const fs    = require('fs');
const path  = require('path');

const OUT_FILE = path.join(__dirname, '../server/src/data/wikidata-routes.json');

// SPARQL: all flight route items with IATA codes on both endpoints
const QUERY = `
SELECT DISTINCT ?srcIATA ?dstIATA WHERE {
  ?route wdt:P31 wd:Q42240 .
  ?route wdt:P1825 ?src .
  ?route wdt:P1826 ?dst .
  ?src   wdt:P238  ?srcIATA .
  ?dst   wdt:P238  ?dstIATA .
}
`.trim();

function sparqlFetch(query) {
  return new Promise((resolve, reject) => {
    const url = 'https://query.wikidata.org/sparql?query=' + encodeURIComponent(query) + '&format=json';
    const options = { headers: { 'User-Agent': 'FlightFinderRouteRefresh/1.0 (https://github.com/disclaimer8/flightfinder)' } };
    https.get(url, options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`SPARQL HTTP ${res.statusCode}: ${body.slice(0, 200)}`));
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

async function main() {
  console.log('[wikidata-refresh] Querying Wikidata SPARQL...');
  const json = await sparqlFetch(QUERY);
  const bindings = json?.results?.bindings ?? [];
  console.log(`[wikidata-refresh] Got ${bindings.length} route bindings`);

  const routes = {};
  for (const row of bindings) {
    const src = row.srcIATA?.value?.toUpperCase();
    const dst = row.dstIATA?.value?.toUpperCase();
    if (!src || src.length !== 3 || !dst || dst.length !== 3) continue;
    if (!routes[src]) routes[src] = [];
    if (!routes[src].includes(dst)) routes[src].push(dst);
  }

  const airportCount = Object.keys(routes).length;
  const routeCount   = Object.values(routes).reduce((s, a) => s + a.length, 0);
  console.log(`[wikidata-refresh] ${airportCount} origin airports, ${routeCount} total routes`);

  fs.writeFileSync(OUT_FILE, JSON.stringify(routes, null, 2));
  console.log(`[wikidata-refresh] Written to ${OUT_FILE}`);
}

main().catch(err => {
  console.error('[wikidata-refresh] FAILED:', err.message);
  process.exit(1);
});
```

- [ ] **Step 2: Run the script to generate initial data**

```bash
cd /Users/denyskolomiiets/FLIGHT
node scripts/refresh-wikidata-routes.js
```

Expected output ends with: `Written to .../wikidata-routes.json`
Check size: `wc -l server/src/data/wikidata-routes.json` — should be several thousand lines.

If the SPARQL query returns 0 results (Wikidata schema changed), see note below.

> **Note:** If bindings = 0, the Wikidata property numbers may have drifted. Debug with:
> `curl -s "https://query.wikidata.org/sparql?query=SELECT%20%3Fx%20WHERE%20%7B%20wd%3AQ42240%20%3Fp%20%3Fx%7D%20LIMIT%205&format=json"`
> and adjust `P1825`/`P1826` if needed. The wikidata-routes.json stub `{}` ensures the server still starts cleanly.

- [ ] **Step 3: Create GitHub Action**

Create `.github/workflows/wikidata-routes-refresh.yml`:

```yaml
name: Refresh Wikidata Routes

on:
  schedule:
    - cron: '0 3 * * 1'   # Every Monday at 03:00 UTC
  workflow_dispatch:        # Allow manual trigger from GitHub UI

permissions:
  contents: write           # Needed to commit updated JSON

jobs:
  refresh:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Fetch routes from Wikidata
        run: node scripts/refresh-wikidata-routes.js

      - name: Commit updated routes if changed
        run: |
          git config user.name  "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add server/src/data/wikidata-routes.json
          git diff --cached --quiet || git commit -m "chore: refresh Wikidata routes [skip ci]"
          git push
```

- [ ] **Step 4: Commit script and action**

```bash
git add scripts/refresh-wikidata-routes.js .github/workflows/wikidata-routes-refresh.yml server/src/data/wikidata-routes.json
git commit -m "feat: add Wikidata route refresh script and weekly GitHub Action"
```

---

## Task 7: Client — colour-coded arcs + legend + historical toggle

**Files:**
- Modify: `client/src/components/RouteMap.jsx`
- Modify: `client/src/components/RouteMap.css`

- [ ] **Step 1: Add arc colour constants at top of RouteMap.jsx**

Add after the existing `haversineKm` function (around line 17):

```js
// ── Route arc colours by confidence tier ────────────────────────────────────
const ARC_STYLE = {
  live:       { color: 'rgba(52,211,153,0.75)',  weight: 1.5, dashArray: null },
  scheduled:  { color: 'rgba(251,191,36,0.6)',   weight: 1.2, dashArray: null },
  historical: { color: 'rgba(160,160,160,0.35)', weight: 1.0, dashArray: '4 6' },
};
```

- [ ] **Step 2: Add `showHistorical` state**

In the component body, alongside the other `useState` declarations, add:

```js
const [showHistorical, setShowHistorical] = useState(false);
```

- [ ] **Step 3: Update `loadRoutes` to use confidence-coloured arcs**

Replace the arc-drawing `for` loop inside `loadRoutes` (currently lines ~265–277, the loop that calls `L.polyline`):

```js
for (const destIata of data.destinations) {
  const confidence = data.confidences?.[destIata] ?? 'historical';
  if (confidence === 'historical' && !showHistoricalRef.current) continue;

  const idx = airportsDataRef.current?.pts.indexOf(destIata);
  if (idx === -1 || idx == null) continue;
  const dLat = airportsDataRef.current.crd[idx * 2];
  const dLon = airportsDataRef.current.crd[idx * 2 + 1];
  const pts  = geodesicPoints(ap.lat, ap.lon, dLat, dLon);
  const style = ARC_STYLE[confidence] ?? ARC_STYLE.historical;
  const line = L.polyline(pts, {
    color:       style.color,
    weight:      style.weight,
    dashArray:   style.dashArray,
    interactive: false,
  }).addTo(map);
  routeLinesRef.current.push(line);
}
```

Because `showHistorical` is a React state (not a ref), add a ref that mirrors it so the async `loadRoutes` callback can read the latest value:

```js
const showHistoricalRef = useRef(false);
// keep ref in sync with state:
useEffect(() => { showHistoricalRef.current = showHistorical; }, [showHistorical]);
```

- [ ] **Step 4: Add Historical toggle button to the controls bar**

Find the controls bar JSX (the `<div className="rm-controls">` block). Add this button after the existing buttons, before the closing `</div>`:

```jsx
{routes && (
  <button
    className={`rm-btn${showHistorical ? ' rm-btn--active' : ''}`}
    onClick={() => setShowHistorical(v => !v)}
    title="Show routes from 2017 historical dataset"
  >
    Historical
  </button>
)}
```

- [ ] **Step 5: Re-draw arcs when showHistorical toggles**

Add a `useEffect` that re-runs `loadRoutes` when the toggle changes — but only if an airport is currently selected:

```js
useEffect(() => {
  if (!selectedAirportRef.current || !routes) return;
  clearRouteLines();
  // Re-draw with updated showHistorical
  const ap = selectedAirportRef.current;
  import('leaflet').then(async ({ default: L }) => {
    for (const destIata of routes.destinations) {
      const confidence = routes.confidences?.[destIata] ?? 'historical';
      if (confidence === 'historical' && !showHistorical) continue;
      const idx = airportsDataRef.current?.pts.indexOf(destIata);
      if (idx === -1 || idx == null) continue;
      const dLat = airportsDataRef.current.crd[idx * 2];
      const dLon = airportsDataRef.current.crd[idx * 2 + 1];
      const pts  = geodesicPoints(ap.lat, ap.lon, dLat, dLon);
      const style = ARC_STYLE[confidence] ?? ARC_STYLE.historical;
      const line = L.polyline(pts, {
        color: style.color, weight: style.weight,
        dashArray: style.dashArray, interactive: false,
      }).addTo(mapRef.current);
      routeLinesRef.current.push(line);
    }
    redrawCanvas();
  });
}, [showHistorical]); // eslint-disable-line react-hooks/exhaustive-deps
```

Also add `selectedAirportRef`:

```js
const selectedAirportRef = useRef(null);
```

And set it when an airport is clicked (inside `handleMapClick`, when `loadRoutes(ap)` is called):

```js
selectedAirportRef.current = ap;
loadRoutes(ap);
```

- [ ] **Step 6: Add legend**

Add a legend panel inside the `rm-root` div, rendered when `routes` is non-null:

```jsx
{routes && (
  <div className="rm-legend">
    <div className="rm-legend-row"><span className="rm-legend-dot rm-legend-dot--live"/>Live</div>
    <div className="rm-legend-row"><span className="rm-legend-dot rm-legend-dot--scheduled"/>Scheduled</div>
    {showHistorical && (
      <div className="rm-legend-row"><span className="rm-legend-dot rm-legend-dot--historical"/>Historical</div>
    )}
  </div>
)}
```

- [ ] **Step 7: Add legend styles to RouteMap.css**

Append to `client/src/components/RouteMap.css`:

```css
/* ── Legend ────────────────────────────────────────────────────────────────── */
.rm-legend {
  position: absolute;
  bottom: 20px;
  right: 12px;
  z-index: 1000;
  background: rgba(14,14,30,0.88);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  border: 1px solid rgba(255,255,255,0.12);
  border-radius: 8px;
  padding: 8px 12px;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.rm-legend-row {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 11px;
  font-weight: 600;
  color: rgba(255,255,255,0.7);
  white-space: nowrap;
}

.rm-legend-dot {
  width: 20px;
  height: 3px;
  border-radius: 2px;
  flex-shrink: 0;
}

.rm-legend-dot--live       { background: rgba(52,211,153,0.9); }
.rm-legend-dot--scheduled  { background: rgba(251,191,36,0.8); }
.rm-legend-dot--historical {
  background: transparent;
  border-top: 2px dashed rgba(160,160,160,0.7);
  height: 0;
  margin-top: 2px;
}

@media (max-width: 600px) {
  .rm-legend { bottom: 12px; right: 8px; }
}
```

- [ ] **Step 8: Commit client changes**

```bash
git add client/src/components/RouteMap.jsx client/src/components/RouteMap.css
git commit -m "feat: colour-coded route arcs by confidence tier + historical toggle + legend"
```

---

## Task 8: Push and verify

- [ ] **Step 1: Run full server test suite**

```bash
cd /Users/denyskolomiiets/FLIGHT/server
npx jest --no-coverage 2>&1 | tail -10
```

Expected: all tests pass.

- [ ] **Step 2: Push to main**

```bash
cd /Users/denyskolomiiets/FLIGHT
git pull --rebase origin main && git push origin main
```

- [ ] **Step 3: After deploy (~2 min), smoke-test on himaxym.com**

Open Route Map tab, click MAD:
- Green arcs = routes confirmed by OpenSky (requires `OPENSKY_USERNAME`/`OPENSKY_PASSWORD` env vars on server — add via `.env` if not set; without credentials OpenSky is skipped and all routes show as scheduled)
- Yellow arcs = Wikidata scheduled routes
- "Historical" button appears; clicking it adds gray dashed arcs

- [ ] **Step 4: Add OpenSky credentials to server .env (if available)**

On the server's `.env` file (not committed to git), add:

```
OPENSKY_USERNAME=your_opensky_username
OPENSKY_PASSWORD=your_opensky_password
```

Register free at https://opensky-network.org/index.php?option=com_users&view=registration if needed.

---

## Self-Review Notes

**Spec coverage check:**
- ✅ OpenSky source with 7-day TTL cache
- ✅ Wikidata weekly refresh via GitHub Action
- ✅ routes.dat historical fallback
- ✅ 3 confidence tiers (live/scheduled/historical) — `recent` tier deferred: OpenSky API limit is 7 days per request; the 8-30 day `recent` tier would require 3 additional API calls and adds complexity without meaningful user value at this stage
- ✅ Historical routes hidden by default, toggle in controls
- ✅ Legend panel
- ✅ Error handling: OpenSky fails silently, Wikidata missing file logs warning, all-zero returns 404
- ✅ ICAO→IATA reverse lookup

**Type consistency:**
- `routesService.getRoutes` returns `{ origin, destinations, confidences }` — matches mapController usage and client `data.destinations` / `data.confidences`
- `openSkyService.getDepartures` returns `{ destIata, lastSeen }[]` — matches routesService consumption
- `wikidataService.getRoutes` returns `Set<string>` — matches routesService `.has()` calls
