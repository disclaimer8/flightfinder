# Subscription Pivot — Plan 2 / 5: Data Ingestion (Track 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the data backbone that powers the γ enriched card and α delay prediction. By the end of this plan, a background worker is sampling scheduled-vs-actual arrivals for the top-30 routes, a one-shot bootstrap populates the aircraft fleet registry, weather/liveries/amenities/CO₂ modules are ready for the enrichment service to call, and `predictDelay()` returns a 3-tier rule-based answer.

**Architecture:** New tables + workers follow existing patterns: idempotent migrations in `db.js`, worker modules in `server/src/workers/*` that export a `start*Worker()` returning a `stop` fn and gate behind an env flag. A small `DataSource` contract documents what every ingestion module must expose (`isEnabled()`, `fetch(...)`, `toObservation(...)`). Wikimedia, OpenWeather, Mictronics, AeroDataBox each implement it. Amenities are a git-tracked seed JSON loaded on boot. CO₂ and predictDelay are pure-function modules unit-tested in isolation.

**Tech stack:** Node 18+, better-sqlite3, existing `aerodataboxService.js` + `openSkyService.js`, new `openWeatherService.js`, new `wikimediaLiveryService.js`, new `mictronicsService.js`, Jest + supertest.

**Spec reference:** [docs/superpowers/specs/2026-04-22-subscription-pivot-design.md](../specs/2026-04-22-subscription-pivot-design.md) — sections "Data ingestion (Track 2)" and "Rule-based delay prediction".

**Depends on Plan 1:** No. This plan can proceed in parallel with Plan 1 — no overlap with Stripe/entitlement code.

---

## File structure

### Created

- `server/src/models/observations.js` — prepared statements for `flight_observations` + route aggregates
- `server/src/models/fleet.js` — prepared statements for `aircraft_fleet`
- `server/src/models/liveries.js` — prepared statements for `airline_liveries`
- `server/src/models/amenities.js` — prepared statements for `airline_amenities`
- `server/src/services/dataSource.js` — contract doc + tiny helper (`defineDataSource`)
- `server/src/services/openWeatherService.js` — OpenWeather free-tier wrapper with 30-min memo
- `server/src/services/wikimediaLiveryService.js` — Commons API lookup, persists into liveries table
- `server/src/services/mictronicsService.js` — aircraftDB CSV bootstrap (one-shot)
- `server/src/services/co2Service.js` — pure-function ICAO-based CO₂/pax calc
- `server/src/services/delayPredictionService.js` — 3-tier rule-based predictor
- `server/src/services/amenitiesService.js` — load seed JSON, expose `getAmenities(airline, aircraftType)`
- `server/src/workers/delayIngestionWorker.js` — top-30 scheduled+actual sampler
- `server/src/workers/fleetBootstrapWorker.js` — one-shot Mictronics + OpenSky fill
- `server/data/airline-amenities.json` — seed for ~200 airlines (contributor-friendly)
- `server/src/__tests__/delayPrediction.test.js`
- `server/src/__tests__/co2.test.js`
- `server/src/__tests__/amenities.seed.test.js`
- `server/src/__tests__/ingest.migrations.test.js`

### Modified

- `server/src/models/db.js` — new migrations (flight_observations, aircraft_fleet, airline_liveries, airline_amenities)
- `server/src/index.js` — start new workers behind `INGEST_ENABLED=1` and `FLEET_BOOTSTRAP=1`
- `server/.env.example` — document `INGEST_ENABLED`, `FLEET_BOOTSTRAP`, `OPENWEATHER_API_KEY`, top-30 limit knobs

---

## Task 1: DB migrations — ingestion schema

**Files:**
- Modify: `server/src/models/db.js`
- Create: `server/src/__tests__/ingest.migrations.test.js`

- [ ] **Step 1: Write the failing migration test**

```js
// server/src/__tests__/ingest.migrations.test.js
// Verifies all new ingestion tables exist with the expected columns.

describe('ingestion schema migrations', () => {
  let db;
  beforeAll(() => {
    jest.resetModules();
    process.env.NODE_ENV = 'test';
    db = require('../models/db').db;
  });

  const table = (name) => db.prepare(`PRAGMA table_info(${name})`).all().map(c => c.name);

  test('flight_observations has expected columns', () => {
    expect(table('flight_observations')).toEqual(expect.arrayContaining([
      'id','dep_iata','arr_iata','airline_iata','flight_number','aircraft_icao',
      'scheduled_dep','actual_dep','scheduled_arr','actual_arr','delay_minutes',
      'status','observed_at',
    ]));
  });

  test('aircraft_fleet has expected columns', () => {
    expect(table('aircraft_fleet')).toEqual(expect.arrayContaining([
      'icao24','registration','icao_type','operator_iata','build_year','first_seen_at','updated_at',
    ]));
  });

  test('airline_liveries has expected columns', () => {
    expect(table('airline_liveries')).toEqual(expect.arrayContaining([
      'airline_iata','icao_type','image_url','attribution','fetched_at',
    ]));
  });

  test('airline_amenities has expected columns', () => {
    expect(table('airline_amenities')).toEqual(expect.arrayContaining([
      'airline_iata','icao_type_hint','wifi','power','entertainment','meal','updated_at',
    ]));
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `cd server && npx jest src/__tests__/ingest.migrations.test.js`
Expected: FAIL — tables don't exist yet.

- [ ] **Step 3: Append migrations to db.js**

In `server/src/models/db.js`, after the subscription migrations (end of Plan 1 Task 2 block) append:

```js
// flight_observations: one row per flight arrival we've observed.
// UNIQUE(airline, flight#, scheduled_dep) dedups multiple polls of the same flight.
db.exec(`
  CREATE TABLE IF NOT EXISTS flight_observations (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    dep_iata       TEXT NOT NULL,
    arr_iata       TEXT NOT NULL,
    airline_iata   TEXT NOT NULL,
    flight_number  TEXT NOT NULL,
    aircraft_icao  TEXT,
    scheduled_dep  INTEGER NOT NULL,
    actual_dep     INTEGER,
    scheduled_arr  INTEGER NOT NULL,
    actual_arr     INTEGER,
    delay_minutes  INTEGER,
    status         TEXT,
    observed_at    INTEGER NOT NULL,
    UNIQUE(airline_iata, flight_number, scheduled_dep)
  );
  CREATE INDEX IF NOT EXISTS idx_obs_route  ON flight_observations(dep_iata, arr_iata, observed_at);
  CREATE INDEX IF NOT EXISTS idx_obs_flight ON flight_observations(airline_iata, flight_number, scheduled_dep);
`);

// aircraft_fleet: one row per tail (icao24 hex id). Bootstrap from Mictronics +
// OpenSky; refreshed monthly. operator_iata may be NULL for GA/private.
db.exec(`
  CREATE TABLE IF NOT EXISTS aircraft_fleet (
    icao24         TEXT PRIMARY KEY,
    registration   TEXT,
    icao_type      TEXT,
    operator_iata  TEXT,
    build_year     INTEGER,
    first_seen_at  INTEGER NOT NULL,
    updated_at     INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_fleet_reg      ON aircraft_fleet(registration);
  CREATE INDEX IF NOT EXISTS idx_fleet_type     ON aircraft_fleet(icao_type);
  CREATE INDEX IF NOT EXISTS idx_fleet_operator ON aircraft_fleet(operator_iata);
`);

// airline_liveries: cached Wikimedia photo URL per (airline, aircraft-type).
db.exec(`
  CREATE TABLE IF NOT EXISTS airline_liveries (
    airline_iata  TEXT NOT NULL,
    icao_type     TEXT NOT NULL,
    image_url     TEXT,
    attribution   TEXT,
    fetched_at    INTEGER NOT NULL,
    PRIMARY KEY (airline_iata, icao_type)
  );
`);

// airline_amenities: populated from seed JSON on boot. icao_type_hint='' means
// the row applies to the whole airline's mainline fleet. SQLite doesn't allow
// expressions in PRIMARY KEY, so we use NOT NULL DEFAULT '' to keep the PK
// simple and sound (NULL in composite PK is permissive in SQLite).
db.exec(`
  CREATE TABLE IF NOT EXISTS airline_amenities (
    airline_iata    TEXT NOT NULL,
    icao_type_hint  TEXT NOT NULL DEFAULT '',
    wifi            INTEGER NOT NULL DEFAULT 0,
    power           INTEGER NOT NULL DEFAULT 0,
    entertainment   INTEGER NOT NULL DEFAULT 0,
    meal            INTEGER NOT NULL DEFAULT 0,
    updated_at      INTEGER NOT NULL,
    PRIMARY KEY (airline_iata, icao_type_hint)
  );
`);
```

- [ ] **Step 4: Run test — expect PASS**

Run: `cd server && npx jest src/__tests__/ingest.migrations.test.js`
Expected: 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/models/db.js server/src/__tests__/ingest.migrations.test.js
git commit -m "feat(db): flight_observations + fleet + liveries + amenities schemas"
```

---

## Task 2: Prepared-statement models

**Files:**
- Create: `server/src/models/observations.js`, `fleet.js`, `liveries.js`, `amenities.js`

- [ ] **Step 1: observations.js**

```js
'use strict';
const { db } = require('./db');

const stmts = {
  upsert: db.prepare(`
    INSERT INTO flight_observations
      (dep_iata, arr_iata, airline_iata, flight_number, aircraft_icao,
       scheduled_dep, actual_dep, scheduled_arr, actual_arr,
       delay_minutes, status, observed_at)
    VALUES
      (@dep_iata, @arr_iata, @airline_iata, @flight_number, @aircraft_icao,
       @scheduled_dep, @actual_dep, @scheduled_arr, @actual_arr,
       @delay_minutes, @status, @observed_at)
    ON CONFLICT(airline_iata, flight_number, scheduled_dep) DO UPDATE SET
      actual_dep     = excluded.actual_dep,
      actual_arr     = excluded.actual_arr,
      delay_minutes  = excluded.delay_minutes,
      status         = excluded.status,
      aircraft_icao  = COALESCE(excluded.aircraft_icao, flight_observations.aircraft_icao),
      observed_at    = excluded.observed_at
  `),
  byExactFlight: db.prepare(`
    SELECT delay_minutes FROM flight_observations
     WHERE airline_iata = ? AND flight_number = ?
       AND observed_at > ? AND status = 'completed' AND delay_minutes IS NOT NULL
  `),
  byRouteAirline: db.prepare(`
    SELECT delay_minutes FROM flight_observations
     WHERE dep_iata = ? AND arr_iata = ? AND airline_iata = ?
       AND observed_at > ? AND status = 'completed' AND delay_minutes IS NOT NULL
  `),
  topRoutes: db.prepare(`
    SELECT dep_iata, arr_iata, COUNT(*) AS n
      FROM observed_routes
     WHERE seen_at > ?
     GROUP BY dep_iata, arr_iata
     ORDER BY n DESC
     LIMIT ?
  `),
};

module.exports = {
  upsertObservation(row) { stmts.upsert.run(row); },
  getByExactFlight(airline, flightNumber, sinceMs) {
    return stmts.byExactFlight.all(airline, flightNumber, sinceMs);
  },
  getByRouteAirline(dep, arr, airline, sinceMs) {
    return stmts.byRouteAirline.all(dep, arr, airline, sinceMs);
  },
  getTopRoutes(sinceMs, limit = 30) {
    return stmts.topRoutes.all(sinceMs, limit);
  },
};
```

- [ ] **Step 2: fleet.js**

```js
'use strict';
const { db } = require('./db');

const stmts = {
  upsert: db.prepare(`
    INSERT INTO aircraft_fleet (icao24, registration, icao_type, operator_iata, build_year, first_seen_at, updated_at)
    VALUES (@icao24, @registration, @icao_type, @operator_iata, @build_year, @now, @now)
    ON CONFLICT(icao24) DO UPDATE SET
      registration   = COALESCE(excluded.registration, aircraft_fleet.registration),
      icao_type      = COALESCE(excluded.icao_type, aircraft_fleet.icao_type),
      operator_iata  = COALESCE(excluded.operator_iata, aircraft_fleet.operator_iata),
      build_year     = COALESCE(excluded.build_year, aircraft_fleet.build_year),
      updated_at     = excluded.updated_at
  `),
  byIcao24:       db.prepare('SELECT * FROM aircraft_fleet WHERE icao24 = ?'),
  byRegistration: db.prepare('SELECT * FROM aircraft_fleet WHERE registration = ?'),
};

module.exports = {
  upsert(row) { stmts.upsert.run({ now: Date.now(), ...row }); },
  getByIcao24(hex) { return stmts.byIcao24.get(hex?.toLowerCase()); },
  getByRegistration(reg) { return stmts.byRegistration.get(reg?.toUpperCase()); },
};
```

- [ ] **Step 3: liveries.js**

```js
'use strict';
const { db } = require('./db');

const stmts = {
  upsert: db.prepare(`
    INSERT INTO airline_liveries (airline_iata, icao_type, image_url, attribution, fetched_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(airline_iata, icao_type) DO UPDATE SET
      image_url   = excluded.image_url,
      attribution = excluded.attribution,
      fetched_at  = excluded.fetched_at
  `),
  get: db.prepare(`SELECT image_url, attribution, fetched_at
                     FROM airline_liveries
                    WHERE airline_iata = ? AND icao_type = ?`),
};

module.exports = {
  upsert({ airlineIata, icaoType, imageUrl, attribution }) {
    stmts.upsert.run(airlineIata, icaoType, imageUrl, attribution || null, Date.now());
  },
  get(airlineIata, icaoType) { return stmts.get.get(airlineIata, icaoType); },
};
```

- [ ] **Step 4: amenities.js**

```js
'use strict';
const { db } = require('./db');

const stmts = {
  upsert: db.prepare(`
    INSERT INTO airline_amenities (airline_iata, icao_type_hint, wifi, power, entertainment, meal, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(airline_iata, COALESCE(icao_type_hint, '')) DO UPDATE SET
      wifi          = excluded.wifi,
      power         = excluded.power,
      entertainment = excluded.entertainment,
      meal          = excluded.meal,
      updated_at    = excluded.updated_at
  `),
  // Prefer a row with matching icao_type_hint; fall back to airline-wide row.
  findForAirlineType: db.prepare(`
    SELECT wifi, power, entertainment, meal
      FROM airline_amenities
     WHERE airline_iata = ?
       AND (icao_type_hint = ? OR icao_type_hint IS NULL)
     ORDER BY (icao_type_hint = ?) DESC
     LIMIT 1
  `),
};

module.exports = {
  upsert({ airlineIata, icaoTypeHint, wifi, power, entertainment, meal }) {
    stmts.upsert.run(
      airlineIata, icaoTypeHint || null,
      wifi ? 1 : 0, power ? 1 : 0, entertainment ? 1 : 0, meal ? 1 : 0,
      Date.now()
    );
  },
  findForAirlineType(airlineIata, icaoType) {
    const row = stmts.findForAirlineType.get(airlineIata, icaoType || null, icaoType || null);
    if (!row) return null;
    return { wifi: !!row.wifi, power: !!row.power, entertainment: !!row.entertainment, meal: !!row.meal };
  },
};
```

- [ ] **Step 5: Commit**

```bash
git add server/src/models/observations.js server/src/models/fleet.js server/src/models/liveries.js server/src/models/amenities.js
git commit -m "feat(models): observations/fleet/liveries/amenities prepared statements"
```

---

## Task 3: DataSource contract

**Files:**
- Create: `server/src/services/dataSource.js`

- [ ] **Step 1: Write the contract module**

```js
'use strict';

/*
 * DataSource contract — every ingestion module (AeroDataBox, OpenWeather,
 * Wikimedia, Mictronics, OpenSky) implements this shape. The enrichment
 * service and workers depend ONLY on this contract, not on a specific vendor.
 *
 *   {
 *     name:        string;              // short id, e.g. "aerodatabox"
 *     isEnabled(): boolean;              // true iff the source has env config
 *     // fetch<T>() returns vendor-specific data; sources document their own shape.
 *     // toObservation?(raw): row        // optional, only data that writes observations
 *   }
 *
 * Adding a new data source means: new file in services/, implement the contract,
 * register it wherever the enrichment service aggregates (Plan 3). No changes
 * required to workers or DB.
 */

function defineDataSource({ name, isEnabled, fetch, toObservation }) {
  if (!name || typeof isEnabled !== 'function' || typeof fetch !== 'function') {
    throw new Error(`[dataSource] invalid source "${name}" — missing name/isEnabled/fetch`);
  }
  return { name, isEnabled, fetch, toObservation: toObservation || null };
}

module.exports = { defineDataSource };
```

- [ ] **Step 2: Commit**

```bash
git add server/src/services/dataSource.js
git commit -m "feat(ingest): DataSource contract (defineDataSource helper + doc)"
```

---

## Task 4: CO₂ calculator (pure function)

**Files:**
- Create: `server/src/services/co2Service.js`, `server/src/__tests__/co2.test.js`

ICAO formula (v1 approximation): `kgCO2_per_pax = (distance_km * fuel_burn_kg_per_km * 3.16) / seats`.

- [ ] **Step 1: Write the test**

```js
// server/src/__tests__/co2.test.js
const { co2PerPax, greatCircleKm } = require('../services/co2Service');

describe('co2Service', () => {
  test('greatCircleKm LHR→JFK ≈ 5541 km (±30)', () => {
    const km = greatCircleKm(51.4700, -0.4543, 40.6413, -73.7781);
    expect(km).toBeGreaterThan(5510);
    expect(km).toBeLessThan(5575);
  });

  test('co2PerPax A320 @ 1000km ~ 100–140 kg/pax', () => {
    const kg = co2PerPax({ icaoType: 'A320', distanceKm: 1000 });
    expect(kg).toBeGreaterThan(80);
    expect(kg).toBeLessThan(180);
  });

  test('co2PerPax returns null for unknown icaoType', () => {
    expect(co2PerPax({ icaoType: 'ZZZZ', distanceKm: 500 })).toBeNull();
  });

  test('co2PerPax rejects invalid distance', () => {
    expect(co2PerPax({ icaoType: 'A320', distanceKm: 0 })).toBeNull();
    expect(co2PerPax({ icaoType: 'A320', distanceKm: -50 })).toBeNull();
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `cd server && npx jest src/__tests__/co2.test.js`

- [ ] **Step 3: Create co2Service.js**

```js
'use strict';

// ICAO-style simplified fuel-burn table, kg-fuel per km per aircraft.
// Seat counts are typical 1-class equivalents. Sources: IATA/ICAO publications
// and manufacturer spec sheets; v1 approximation — not a certified footprint.
const FLEET = {
  // narrow-body
  'A319': { fuelKgPerKm: 2.4,  seats: 124 },
  'A320': { fuelKgPerKm: 2.6,  seats: 150 },
  'A321': { fuelKgPerKm: 3.0,  seats: 185 },
  'A19N': { fuelKgPerKm: 2.1,  seats: 124 },
  'A20N': { fuelKgPerKm: 2.3,  seats: 150 },
  'A21N': { fuelKgPerKm: 2.6,  seats: 185 },
  'B737': { fuelKgPerKm: 2.5,  seats: 130 },
  'B738': { fuelKgPerKm: 2.7,  seats: 162 },
  'B739': { fuelKgPerKm: 2.9,  seats: 178 },
  'B38M': { fuelKgPerKm: 2.3,  seats: 162 },
  'B39M': { fuelKgPerKm: 2.5,  seats: 178 },
  'BCS1': { fuelKgPerKm: 2.2,  seats: 110 },
  'BCS3': { fuelKgPerKm: 2.4,  seats: 130 },
  // wide-body
  'A332': { fuelKgPerKm: 5.6,  seats: 247 },
  'A333': { fuelKgPerKm: 5.9,  seats: 277 },
  'A338': { fuelKgPerKm: 5.0,  seats: 247 },
  'A339': { fuelKgPerKm: 5.3,  seats: 287 },
  'A342': { fuelKgPerKm: 6.5,  seats: 263 },
  'A343': { fuelKgPerKm: 6.9,  seats: 295 },
  'A345': { fuelKgPerKm: 7.6,  seats: 313 },
  'A346': { fuelKgPerKm: 8.0,  seats: 380 },
  'A359': { fuelKgPerKm: 5.8,  seats: 315 },
  'A35K': { fuelKgPerKm: 6.4,  seats: 369 },
  'A388': { fuelKgPerKm: 11.5, seats: 555 },
  'B763': { fuelKgPerKm: 5.1,  seats: 218 },
  'B764': { fuelKgPerKm: 5.4,  seats: 245 },
  'B772': { fuelKgPerKm: 7.3,  seats: 305 },
  'B77W': { fuelKgPerKm: 8.0,  seats: 365 },
  'B773': { fuelKgPerKm: 7.7,  seats: 365 },
  'B788': { fuelKgPerKm: 5.2,  seats: 242 },
  'B789': { fuelKgPerKm: 5.5,  seats: 290 },
  'B78X': { fuelKgPerKm: 6.0,  seats: 330 },
  'B748': { fuelKgPerKm: 10.9, seats: 467 },
  // regional
  'E170': { fuelKgPerKm: 1.6,  seats: 72  },
  'E190': { fuelKgPerKm: 1.9,  seats: 100 },
  'E195': { fuelKgPerKm: 2.0,  seats: 120 },
  'E290': { fuelKgPerKm: 1.5,  seats: 100 },
  'E295': { fuelKgPerKm: 1.7,  seats: 132 },
  'CRJ7': { fuelKgPerKm: 1.3,  seats: 70  },
  'CRJ9': { fuelKgPerKm: 1.4,  seats: 90  },
  'DH8D': { fuelKgPerKm: 1.1,  seats: 78  },
  'AT72': { fuelKgPerKm: 0.9,  seats: 70  },
  'AT76': { fuelKgPerKm: 1.0,  seats: 78  },
};

const CO2_PER_KG_FUEL = 3.16; // EEA jet-A1 emissions factor

function greatCircleKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = (deg) => deg * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat/2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon/2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function co2PerPax({ icaoType, distanceKm }) {
  if (!Number.isFinite(distanceKm) || distanceKm <= 0) return null;
  const spec = FLEET[icaoType?.toUpperCase()];
  if (!spec) return null;
  const totalFuelKg = distanceKm * spec.fuelKgPerKm;
  const totalCo2Kg  = totalFuelKg * CO2_PER_KG_FUEL;
  return Math.round((totalCo2Kg / spec.seats) * 10) / 10;
}

module.exports = { co2PerPax, greatCircleKm, FLEET };
```

- [ ] **Step 4: Run test — expect PASS**

Run: `cd server && npx jest src/__tests__/co2.test.js --verbose`
Expected: 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/co2Service.js server/src/__tests__/co2.test.js
git commit -m "feat(co2): ICAO-style fuel-burn CO2/pax calculator + great-circle km"
```

---

## Task 5: Delay prediction (3-tier rule-based)

**Files:**
- Create: `server/src/services/delayPredictionService.js`
- Create: `server/src/__tests__/delayPrediction.test.js`

- [ ] **Step 1: Write the test**

```js
// server/src/__tests__/delayPrediction.test.js
const { db } = require('../models/db');
const obsModel = require('../models/observations');
const { predictDelay } = require('../services/delayPredictionService');

function seedObs({ airline, flight, dep, arr, delay, daysAgo }) {
  const now = Date.now();
  obsModel.upsertObservation({
    dep_iata: dep, arr_iata: arr, airline_iata: airline, flight_number: flight,
    aircraft_icao: 'B738',
    scheduled_dep: now - daysAgo * 86400000,
    actual_dep:    now - daysAgo * 86400000 + delay * 60000,
    scheduled_arr: now - daysAgo * 86400000 + 3600000,
    actual_arr:    now - daysAgo * 86400000 + 3600000 + delay * 60000,
    delay_minutes: delay,
    status: 'completed',
    observed_at:   now - daysAgo * 86400000,
  });
}

beforeEach(() => { db.exec('DELETE FROM flight_observations'); });

describe('predictDelay', () => {
  test('returns "low confidence / collecting data" when <10 observations', () => {
    for (let i = 0; i < 5; i++) seedObs({ airline: 'BA', flight: '001', dep: 'LHR', arr: 'JFK', delay: 10, daysAgo: i+1 });
    const out = predictDelay({ airline: 'BA', flightNumber: '001', dep: 'LHR', arr: 'JFK' });
    expect(out.confidence).toBe('low');
    expect(out.message).toMatch(/collecting data/);
  });

  test('tier 1 exact-flight, 12 obs → medium confidence, scope=exact-flight', () => {
    for (let i = 0; i < 12; i++) seedObs({ airline: 'BA', flight: '001', dep: 'LHR', arr: 'JFK', delay: 5 + i, daysAgo: i+1 });
    const out = predictDelay({ airline: 'BA', flightNumber: '001', dep: 'LHR', arr: 'JFK' });
    expect(out.scope).toBe('exact-flight');
    expect(out.confidence).toBe('medium');
    expect(out.sample).toBe(12);
    expect(out.median).toBeGreaterThan(0);
  });

  test('tier 2 route-airline when no exact-flight match', () => {
    // Different flight numbers, same airline + route.
    for (let i = 0; i < 15; i++) seedObs({ airline: 'AA', flight: String(200 + i), dep: 'LHR', arr: 'JFK', delay: 3, daysAgo: i+1 });
    const out = predictDelay({ airline: 'AA', flightNumber: '9999', dep: 'LHR', arr: 'JFK' });
    expect(out.scope).toBe('route-airline');
    expect(out.sample).toBe(15);
  });

  test('≥30 samples → high confidence', () => {
    for (let i = 0; i < 35; i++) seedObs({ airline: 'LH', flight: '404', dep: 'FRA', arr: 'MUC', delay: i % 10, daysAgo: i+1 });
    const out = predictDelay({ airline: 'LH', flightNumber: '404', dep: 'FRA', arr: 'MUC' });
    expect(out.confidence).toBe('high');
    expect(out.onTimePct).toBeGreaterThan(0.4); // most delays are <15 min with i%10
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `cd server && npx jest src/__tests__/delayPrediction.test.js`

- [ ] **Step 3: Create delayPredictionService.js**

```js
'use strict';

const obsModel = require('../models/observations');

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
const MIN_SAMPLE = 10;

function percentile(nums, p) {
  if (!nums.length) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

function predictDelay({ airline, flightNumber, dep, arr }) {
  const since = Date.now() - NINETY_DAYS_MS;

  // tier 1: same flight
  let rows = obsModel.getByExactFlight(airline, flightNumber, since);
  let scope = 'exact-flight';

  // tier 2: same route + airline
  if (rows.length < MIN_SAMPLE) {
    rows = obsModel.getByRouteAirline(dep, arr, airline, since);
    scope = 'route-airline';
  }

  if (rows.length < MIN_SAMPLE) {
    return { confidence: 'low', message: 'Collecting data — predictions available soon', scope: 'insufficient' };
  }

  const delays = rows.map(r => r.delay_minutes);
  const median   = percentile(delays, 50);
  const p75      = percentile(delays, 75);
  const onTime   = delays.filter(d => d < 15).length;
  const onTimePct = onTime / delays.length;
  const confidence = delays.length >= 30 ? 'high' : 'medium';

  return { median, p75, onTimePct, confidence, sample: delays.length, scope };
}

module.exports = { predictDelay };
```

- [ ] **Step 4: Run test — expect PASS**

Run: `cd server && npx jest src/__tests__/delayPrediction.test.js --verbose`
Expected: 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/delayPredictionService.js server/src/__tests__/delayPrediction.test.js
git commit -m "feat(predict): 3-tier rule-based delay prediction (exact → route → insufficient)"
```

---

## Task 6: OpenWeather service (lazy + 30-min memo)

**Files:**
- Create: `server/src/services/openWeatherService.js`

- [ ] **Step 1: Create openWeatherService.js**

```js
'use strict';

const { defineDataSource } = require('./dataSource');

const BASE = 'https://api.openweathermap.org/data/2.5/weather';
const TTL_MS = 30 * 60 * 1000;
const cache = new Map(); // key -> { at, data }

function isEnabled() {
  return Boolean(process.env.OPENWEATHER_API_KEY);
}

async function fetchByAirport({ lat, lon }) {
  if (!isEnabled()) return null;
  const key = `${lat.toFixed(3)}:${lon.toFixed(3)}`;
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.at < TTL_MS) return hit.data;

  const url = `${BASE}?lat=${lat}&lon=${lon}&units=metric&appid=${process.env.OPENWEATHER_API_KEY}`;
  const res = await fetch(url);
  if (!res.ok) {
    console.warn(`[openweather] ${res.status} for ${key}`);
    return null;
  }
  const raw = await res.json();
  const data = {
    tempC:      raw.main?.temp != null ? Math.round(raw.main.temp) : null,
    condition:  raw.weather?.[0]?.main || null,
    description: raw.weather?.[0]?.description || null,
    windMps:    raw.wind?.speed || null,
    icon:       raw.weather?.[0]?.icon || null,
    observedAt: raw.dt ? raw.dt * 1000 : now,
  };
  cache.set(key, { at: now, data });
  return data;
}

module.exports = defineDataSource({
  name: 'openweather',
  isEnabled,
  fetch: fetchByAirport,
});
module.exports._clearCache = () => cache.clear(); // test helper
```

- [ ] **Step 2: Commit**

```bash
git add server/src/services/openWeatherService.js
git commit -m "feat(weather): OpenWeather free-tier lookup with 30-min in-memory memo"
```

---

## Task 7: Wikimedia livery service

**Files:**
- Create: `server/src/services/wikimediaLiveryService.js`

The Commons API is public — no key. We search `"<airline name> <aircraft type>"` and pick the first image result. Liveries that return no match are also cached with `image_url=null` so we don't retry on every request.

- [ ] **Step 1: Create wikimediaLiveryService.js**

```js
'use strict';

const { defineDataSource } = require('./dataSource');
const liveriesModel = require('../models/liveries');

const API = 'https://commons.wikimedia.org/w/api.php';
const TTL_MS = 7 * 24 * 60 * 60 * 1000; // refresh weekly

async function searchLivery({ airlineName, airlineIata, icaoType, typeLabel }) {
  const cached = liveriesModel.get(airlineIata, icaoType);
  if (cached && Date.now() - cached.fetched_at < TTL_MS) return cached;

  const q = `${airlineName} ${typeLabel || icaoType} aircraft`;
  const url = `${API}?action=query&format=json&generator=search&gsrsearch=${encodeURIComponent(q)}` +
              `&gsrnamespace=6&gsrlimit=3&prop=imageinfo&iiprop=url|extmetadata&origin=*`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'himaxym.com livery lookup' } });
    if (!res.ok) throw new Error(`wikimedia ${res.status}`);
    const body = await res.json();
    const page = body?.query?.pages && Object.values(body.query.pages)[0];
    const info = page?.imageinfo?.[0];
    const imageUrl    = info?.url || null;
    const attribution = info?.extmetadata?.Artist?.value || 'Wikimedia Commons';
    liveriesModel.upsert({ airlineIata, icaoType, imageUrl, attribution });
    return { image_url: imageUrl, attribution, fetched_at: Date.now() };
  } catch (err) {
    console.warn(`[wikimedia] ${airlineIata}/${icaoType}: ${err.message}`);
    // Negative cache so we don't hammer on repeated misses.
    liveriesModel.upsert({ airlineIata, icaoType, imageUrl: null, attribution: null });
    return null;
  }
}

module.exports = defineDataSource({
  name: 'wikimedia_liveries',
  isEnabled: () => true, // no key required
  fetch: searchLivery,
});
```

- [ ] **Step 2: Commit**

```bash
git add server/src/services/wikimediaLiveryService.js
git commit -m "feat(liveries): Wikimedia Commons lookup with weekly cache + negative cache"
```

---

## Task 8: Amenities seed loader

**Files:**
- Create: `server/data/airline-amenities.json`
- Create: `server/src/services/amenitiesService.js`
- Create: `server/src/__tests__/amenities.seed.test.js`

- [ ] **Step 1: Seed JSON skeleton**

Create `server/data/airline-amenities.json`. Seed with ~30 rows covering major airlines; engineers can append over time.

```json
[
  { "iata": "LH", "wifi": true,  "power": true,  "entertainment": true,  "meal": true  },
  { "iata": "BA", "wifi": true,  "power": true,  "entertainment": true,  "meal": true  },
  { "iata": "AF", "wifi": true,  "power": true,  "entertainment": true,  "meal": true  },
  { "iata": "KL", "wifi": true,  "power": true,  "entertainment": true,  "meal": true  },
  { "iata": "IB", "wifi": true,  "power": true,  "entertainment": true,  "meal": true  },
  { "iata": "AA", "wifi": true,  "power": true,  "entertainment": true,  "meal": false },
  { "iata": "DL", "wifi": true,  "power": true,  "entertainment": true,  "meal": false },
  { "iata": "UA", "wifi": true,  "power": true,  "entertainment": true,  "meal": false },
  { "iata": "WN", "wifi": true,  "power": false, "entertainment": false, "meal": false },
  { "iata": "F9", "wifi": false, "power": false, "entertainment": false, "meal": false },
  { "iata": "NK", "wifi": false, "power": false, "entertainment": false, "meal": false },
  { "iata": "B6", "wifi": true,  "power": true,  "entertainment": true,  "meal": false },
  { "iata": "AS", "wifi": true,  "power": true,  "entertainment": true,  "meal": false },
  { "iata": "EK", "wifi": true,  "power": true,  "entertainment": true,  "meal": true  },
  { "iata": "QR", "wifi": true,  "power": true,  "entertainment": true,  "meal": true  },
  { "iata": "EY", "wifi": true,  "power": true,  "entertainment": true,  "meal": true  },
  { "iata": "SQ", "wifi": true,  "power": true,  "entertainment": true,  "meal": true  },
  { "iata": "CX", "wifi": true,  "power": true,  "entertainment": true,  "meal": true  },
  { "iata": "JL", "wifi": true,  "power": true,  "entertainment": true,  "meal": true  },
  { "iata": "NH", "wifi": true,  "power": true,  "entertainment": true,  "meal": true  },
  { "iata": "TK", "wifi": true,  "power": true,  "entertainment": true,  "meal": true  },
  { "iata": "LX", "wifi": true,  "power": true,  "entertainment": true,  "meal": true  },
  { "iata": "OS", "wifi": true,  "power": true,  "entertainment": true,  "meal": true  },
  { "iata": "SN", "wifi": true,  "power": true,  "entertainment": true,  "meal": true  },
  { "iata": "AY", "wifi": true,  "power": true,  "entertainment": true,  "meal": true  },
  { "iata": "SK", "wifi": true,  "power": true,  "entertainment": true,  "meal": true  },
  { "iata": "U2", "wifi": false, "power": false, "entertainment": false, "meal": false },
  { "iata": "FR", "wifi": false, "power": false, "entertainment": false, "meal": false },
  { "iata": "W6", "wifi": false, "power": false, "entertainment": false, "meal": false },
  { "iata": "VY", "wifi": false, "power": false, "entertainment": false, "meal": false }
]
```

- [ ] **Step 2: Create amenitiesService.js**

```js
'use strict';

const fs = require('fs');
const path = require('path');
const model = require('../models/amenities');

const SEED_PATH = path.resolve(__dirname, '../../data/airline-amenities.json');

function loadSeedIntoDb() {
  if (!fs.existsSync(SEED_PATH)) {
    console.warn('[amenities] seed file not found:', SEED_PATH);
    return { loaded: 0 };
  }
  const rows = JSON.parse(fs.readFileSync(SEED_PATH, 'utf-8'));
  let loaded = 0;
  for (const r of rows) {
    model.upsert({
      airlineIata: r.iata,
      icaoTypeHint: r.type || null,
      wifi: r.wifi, power: r.power, entertainment: r.entertainment, meal: r.meal,
    });
    loaded++;
  }
  console.log(`[amenities] seeded ${loaded} airlines from ${path.basename(SEED_PATH)}`);
  return { loaded };
}

function getAmenities(airlineIata, icaoType) {
  if (!airlineIata) return null;
  return model.findForAirlineType(airlineIata, icaoType);
}

module.exports = { loadSeedIntoDb, getAmenities };
```

- [ ] **Step 3: Write the seed test**

```js
// server/src/__tests__/amenities.seed.test.js
const amenitiesService = require('../services/amenitiesService');
const { db } = require('../models/db');

describe('amenities seed', () => {
  beforeAll(() => {
    db.exec("DELETE FROM airline_amenities");
    amenitiesService.loadSeedIntoDb();
  });

  test('loads at least 25 airlines', () => {
    const n = db.prepare("SELECT COUNT(*) AS c FROM airline_amenities").get().c;
    expect(n).toBeGreaterThanOrEqual(25);
  });

  test('Lufthansa has wifi and meal', () => {
    const a = amenitiesService.getAmenities('LH', 'A320');
    expect(a.wifi).toBe(true);
    expect(a.meal).toBe(true);
  });

  test('Ryanair has no wifi', () => {
    const a = amenitiesService.getAmenities('FR', 'B738');
    expect(a.wifi).toBe(false);
  });

  test('unknown airline returns null', () => {
    expect(amenitiesService.getAmenities('XX', 'A320')).toBeNull();
  });
});
```

- [ ] **Step 4: Run test — expect PASS**

Run: `cd server && npx jest src/__tests__/amenities.seed.test.js --verbose`
Expected: 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add server/data/airline-amenities.json server/src/services/amenitiesService.js server/src/__tests__/amenities.seed.test.js
git commit -m "feat(amenities): seed JSON + loader + lookup by (airline, icaoType)"
```

---

## Task 9: Delay ingestion worker

**Files:**
- Create: `server/src/workers/delayIngestionWorker.js`

Pattern matches `adsblolWorker.js`: `startDelayIngestionWorker()` returns `stop()`. Opt-in via `INGEST_ENABLED=1`. Picks top-30 routes from `observed_routes`, asks `aerodataboxService.getAirportDepartures()` for each departure airport, and writes to `flight_observations`.

- [ ] **Step 1: Create worker**

```js
'use strict';

const aerodatabox = require('../services/aerodataboxService');
const obsModel    = require('../models/observations');
const { db } = require('../models/db');

const INITIAL_DELAY_MS = 3 * 60 * 1000;   // 3 min after boot
const CYCLE_INTERVAL_MS = 6 * 60 * 60 * 1000; // every 6 hours
const TOP_N = Number(process.env.INGEST_TOP_ROUTES || 30);
const WINDOW_DAYS = 30; // look at last 30 days of observed_routes for top-N

// We pull DEPARTURES for the origin airport, then filter to the destination in code.
// This uses 1 AeroDataBox call per origin airport per cycle — small, bounded budget.
async function runCycle() {
  const sinceMs = Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const top = obsModel.getTopRoutes(sinceMs, TOP_N);
  if (!top.length) {
    console.log('[delayIngest] no top routes yet — skipping cycle');
    return;
  }

  // Group by origin airport to minimise calls.
  const byOrigin = new Map();
  for (const r of top) {
    if (!byOrigin.has(r.dep_iata)) byOrigin.set(r.dep_iata, new Set());
    byOrigin.get(r.dep_iata).add(r.arr_iata);
  }

  const now = new Date();
  const from = new Date(now.getTime() - 24 * 3600000).toISOString().slice(0, 16); // last 24h
  const to   = now.toISOString().slice(0, 16);

  let persisted = 0;
  for (const [origin, destSet] of byOrigin.entries()) {
    try {
      const departures = await aerodatabox.getAirportDepartures(origin, from, to);
      for (const dep of departures || []) {
        const arr = dep.arrival?.airport?.iata;
        if (!arr || !destSet.has(arr)) continue;
        const airline = dep.airline?.iata;
        const flightNumber = dep.number?.replace(/[^0-9]/g, '');
        if (!airline || !flightNumber) continue;

        const scheduledDep = dep.departure?.scheduledTimeUtc ? Date.parse(dep.departure.scheduledTimeUtc) : null;
        const actualDep    = dep.departure?.actualTimeUtc    ? Date.parse(dep.departure.actualTimeUtc)    : null;
        const scheduledArr = dep.arrival?.scheduledTimeUtc   ? Date.parse(dep.arrival.scheduledTimeUtc)   : null;
        const actualArr    = dep.arrival?.actualTimeUtc      ? Date.parse(dep.arrival.actualTimeUtc)      : null;
        if (!scheduledDep || !scheduledArr) continue;

        const delayMinutes = (actualArr && scheduledArr) ? Math.round((actualArr - scheduledArr) / 60000) : null;

        obsModel.upsertObservation({
          dep_iata: origin, arr_iata: arr,
          airline_iata: airline, flight_number: flightNumber,
          aircraft_icao: dep.aircraft?.model || null,
          scheduled_dep: scheduledDep, actual_dep: actualDep,
          scheduled_arr: scheduledArr, actual_arr: actualArr,
          delay_minutes: delayMinutes,
          status: dep.status?.toLowerCase().includes('cancel') ? 'canceled'
                : (actualArr ? 'completed' : 'scheduled'),
          observed_at: Date.now(),
        });
        persisted++;
      }
    } catch (err) {
      console.warn(`[delayIngest] origin=${origin} failed: ${err.message}`);
    }
  }
  console.log(`[delayIngest] cycle done origins=${byOrigin.size} persisted=${persisted}`);
}

exports.startDelayIngestionWorker = () => {
  if (process.env.INGEST_ENABLED !== '1') {
    console.log('[delayIngest] disabled (INGEST_ENABLED != 1)');
    return () => {};
  }
  if (!aerodatabox.isEnabled()) {
    console.log('[delayIngest] aerodatabox not configured — skipping');
    return () => {};
  }

  let intervalTimer = null;
  const initialTimer = setTimeout(() => {
    runCycle().catch(err => console.warn('[delayIngest] initial cycle failed:', err.message));
    intervalTimer = setInterval(() => {
      runCycle().catch(err => console.warn('[delayIngest] cycle failed:', err.message));
    }, CYCLE_INTERVAL_MS);
  }, INITIAL_DELAY_MS);

  console.log(`[delayIngest] scheduled: first pull in ${INITIAL_DELAY_MS/1000}s, then every ${CYCLE_INTERVAL_MS/3600000}h, topN=${TOP_N}`);
  return function stop() {
    clearTimeout(initialTimer);
    if (intervalTimer) clearInterval(intervalTimer);
  };
};

exports._runCycleForTest = runCycle;
```

- [ ] **Step 2: Commit**

```bash
git add server/src/workers/delayIngestionWorker.js
git commit -m "feat(workers): delay ingestion worker — top-N scheduled+actual sampling"
```

---

## Task 10: Mictronics + OpenSky fleet bootstrap

**Files:**
- Create: `server/src/services/mictronicsService.js`
- Create: `server/src/workers/fleetBootstrapWorker.js`

Mictronics publishes aircraftDB as a plain JSON at https://www.mictronics.de/aircraft-database/indexedDB.zip. We simplify: fetch a lightweight mirror (or read the zip once and cache in `server/data/fleet.json`). The worker hydrates `aircraft_fleet` from the cached file; OpenSky is used as a **live incremental refresh** for aircraft we don't know yet.

- [ ] **Step 1: Create mictronicsService.js (fleet CSV reader)**

```js
'use strict';

const fs = require('fs');
const path = require('path');
const { defineDataSource } = require('./dataSource');

// Expected layout: server/data/mictronics-fleet.json — array of
//   { icao24: "abc123", registration: "G-STBA", icaoType: "B738",
//     operatorIata: "BA", buildYear: 2010 }
// File is committed to the repo if small (~10MB gzipped is acceptable),
// OR downloaded by a seed script. v1: assume it's already placed there.
const FLEET_JSON_PATH = path.resolve(__dirname, '../../data/mictronics-fleet.json');

function isEnabled() {
  return fs.existsSync(FLEET_JSON_PATH);
}

async function* streamEntries() {
  if (!isEnabled()) return;
  // Large JSON but shape is flat — a single JSON.parse is OK for a 50-100MB file on a 1GB box.
  // If file exceeds practical memory, switch to streaming JSON parser in a follow-up.
  const rows = JSON.parse(fs.readFileSync(FLEET_JSON_PATH, 'utf-8'));
  for (const r of rows) yield r;
}

module.exports = defineDataSource({
  name: 'mictronics',
  isEnabled,
  fetch: streamEntries,
});
```

Note for the engineer: if `mictronics-fleet.json` is not yet present, leave the file off v1 and log `disabled`. The worker below handles `isEnabled()==false` gracefully.

- [ ] **Step 2: Create fleetBootstrapWorker.js**

```js
'use strict';

const mictronics = require('../services/mictronicsService');
const openSky    = require('../services/openSkyService');
const fleetModel = require('../models/fleet');

async function runBootstrap() {
  if (mictronics.isEnabled()) {
    let n = 0;
    for await (const r of mictronics.fetch()) {
      fleetModel.upsert({
        icao24: r.icao24?.toLowerCase(),
        registration: r.registration || null,
        icao_type: r.icaoType || null,
        operator_iata: r.operatorIata || null,
        build_year: r.buildYear || null,
      });
      n++;
      if (n % 10000 === 0) console.log(`[fleetBootstrap] mictronics ${n} rows…`);
    }
    console.log(`[fleetBootstrap] mictronics done: ${n} rows upserted`);
  } else {
    console.log('[fleetBootstrap] mictronics disabled (no data file)');
  }
}

exports.startFleetBootstrapWorker = () => {
  if (process.env.FLEET_BOOTSTRAP !== '1') {
    console.log('[fleetBootstrap] disabled (FLEET_BOOTSTRAP != 1)');
    return () => {};
  }
  // Run once after 10s, then stop — monthly refresh is triggered by re-setting the env var.
  const t = setTimeout(() => {
    runBootstrap().catch(err => console.warn('[fleetBootstrap] failed:', err.message));
  }, 10 * 1000);
  return function stop() { clearTimeout(t); };
};

exports._runBootstrapForTest = runBootstrap;
```

- [ ] **Step 3: Commit**

```bash
git add server/src/services/mictronicsService.js server/src/workers/fleetBootstrapWorker.js
git commit -m "feat(fleet): Mictronics JSON reader + one-shot bootstrap worker"
```

---

## Task 11: Wire new workers into index.js

**Files:**
- Modify: `server/src/index.js`

- [ ] **Step 1: Find the current adsblolWorker mount**

Run: `grep -n "adsblolWorker\|startAdsbLolWorker" server/src/index.js`
Note the line where `startAdsbLolWorker()` is called.

- [ ] **Step 2: Add new worker mounts next to it**

Replace/extend that block with:

```js
const { startAdsbLolWorker }          = require('./workers/adsblolWorker');
const { startDelayIngestionWorker }   = require('./workers/delayIngestionWorker');
const { startFleetBootstrapWorker }   = require('./workers/fleetBootstrapWorker');

const stopAdsbLolWorker     = startAdsbLolWorker();
const stopDelayIngest       = startDelayIngestionWorker();
const stopFleetBootstrap    = startFleetBootstrapWorker();

// Also load amenities seed on boot (cheap, idempotent).
require('./services/amenitiesService').loadSeedIntoDb();
```

- [ ] **Step 3: Hook stop fns into existing shutdown handler**

Find where `stopAdsbLolWorker()` is called on SIGTERM / shutdown, and add calls for the new two.

- [ ] **Step 4: Commit**

```bash
git add server/src/index.js
git commit -m "feat(server): start delayIngestion + fleetBootstrap workers; seed amenities on boot"
```

---

## Task 12: Env scaffolding

**Files:**
- Modify: `server/.env.example`

- [ ] **Step 1: Append**

```
# Ingestion
INGEST_ENABLED=0           # 1 = delayIngestionWorker runs every 6h
INGEST_TOP_ROUTES=30       # how many top routes to sample per cycle
FLEET_BOOTSTRAP=0          # 1 = one-shot fleet bootstrap after 10s
OPENWEATHER_API_KEY=       # free tier key from openweathermap.org
```

- [ ] **Step 2: Commit**

```bash
git add server/.env.example
git commit -m "chore(env): document INGEST_ENABLED / FLEET_BOOTSTRAP / OPENWEATHER_API_KEY"
```

---

## Task 13: End-to-end smoke (local)

- [ ] **Step 1: Seed some observed_routes manually (for top-N to have anything)**

Login to the app and run a few by-aircraft searches so `observed_routes` is non-empty (or seed SQLite directly).

- [ ] **Step 2: `INGEST_ENABLED=1 npm run dev -w server`**

Watch logs for `[delayIngest] scheduled: first pull in 180s, ...`

- [ ] **Step 3: After ~4 minutes check the table**

```bash
sqlite3 server/data/app.db "SELECT COUNT(*) FROM flight_observations"
```
Expected: > 0 (exact count depends on AeroDataBox response + your top-30 routes).

- [ ] **Step 4: Run full server test suite**

```bash
cd server && npm test
```
Expected: all tests PASS (including the 4 new suites).

---

## Self-review checklist

- [ ] 4 new tables in migrations, all idempotent (Task 1 test passes)
- [ ] `predictDelay` returns `low` / `medium` / `high` confidence correctly (Task 5 test passes)
- [ ] `co2PerPax` returns null for unknown types, positive number for known (Task 4 test passes)
- [ ] Amenities seed loads ≥25 airlines without error (Task 8 test passes)
- [ ] `INGEST_ENABLED=0` → worker prints `disabled` and exits cleanly (Task 9)
- [ ] OpenWeather 30-min memo hit on second request (not retested in unit — verified by log)
- [ ] DataSource contract applied consistently: openWeatherService, wikimediaLiveryService, mictronicsService all export `defineDataSource(...)`

Next plan: **Plan 3 — γ Enriched Card + affiliate removal** (consumes this plan's models/services).
