# Subscription Pivot — Plan 4 / 5: α My Trips + Web-Push

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the α "Traveler Shield" — users add flights to **My Trips**, get live status (gate, terminal, delay prediction, inbound aircraft lookup), and opt in to browser web-push alerts. Pro is required to CREATE a trip; reading your own trips is enough with a valid auth token.

**Architecture:** New `user_trips` + `push_tokens` tables with strict owner-scoped queries (trip ownership is the #1 failure mode this plan must not ship). `/api/trips` CRUD + `/api/trips/:id/status` (live). Service worker on the client subscribes to `PushManager`, posts the endpoint/keys to `/api/push/subscribe`. A lightweight `pushNotifier` service sends notifications from a small cron-like trigger inside the existing `delayIngestionWorker` (if a tracked flight's delay crosses a threshold, notify its owner).

**Tech stack:** Express, better-sqlite3, `web-push` npm package (VAPID keys), React Router (already installed per package.json), existing `cacheService`. Plan 1 `requireAuth` + `requireTier`. Plan 2's `aerodataboxService`, `adsblolService`, `predictDelay`.

**Spec reference:** [docs/superpowers/specs/2026-04-22-subscription-pivot-design.md](../specs/2026-04-22-subscription-pivot-design.md) — section "α Traveler Shield" + "Enrichment endpoints".

**Depends on:** Plan 1 (auth/tier), Plan 2 (predictDelay, aerodatabox).

---

## File structure

### Created

- `server/src/models/trips.js` — prepared statements (scoped by user_id on every read/write)
- `server/src/models/pushTokens.js`
- `server/src/services/tripStatusService.js` — computes live status for a trip
- `server/src/services/pushService.js` — web-push send helper (VAPID)
- `server/src/controllers/tripsController.js`
- `server/src/controllers/pushController.js`
- `server/src/routes/trips.js`
- `server/src/routes/push.js`
- `server/src/workers/tripAlertWorker.js` — scans active trips, sends push on delay threshold crossings
- `server/src/__tests__/trips.ownership.test.js`
- `client/src/pages/MyTrips.jsx` + `MyTrips.css`
- `client/src/components/AddToTripsButton.jsx`
- `client/src/hooks/useTrips.js`
- `client/public/sw.js` — service worker (push listener)
- `client/src/utils/push.js` — enroll in browser PushManager

### Modified

- `server/src/models/db.js` — migrations for `user_trips` + `push_tokens`
- `server/src/index.js` — mount `/api/trips`, `/api/push`, start `tripAlertWorker`
- `client/src/App.jsx` — wire `MyTrips` route + nav link (React Router or conditional state)
- `client/src/components/FlightCard.jsx` — add `<AddToTripsButton flight={flight} />`
- `server/.env.example` — `TRIPS_ENABLED`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`
- `.github/workflows/deploy.yml` — pass VAPID keys through

---

## Task 1: DB migrations — user_trips + push_tokens

**Files:**
- Modify: `server/src/models/db.js`
- Create: `server/src/__tests__/trips.migrations.test.js`

- [ ] **Step 1: Test**

```js
// server/src/__tests__/trips.migrations.test.js
describe('trips + push migrations', () => {
  let db;
  beforeAll(() => { jest.resetModules(); process.env.NODE_ENV = 'test'; db = require('../models/db').db; });

  test('user_trips columns', () => {
    const cols = db.prepare("PRAGMA table_info(user_trips)").all().map(c => c.name);
    expect(cols).toEqual(expect.arrayContaining([
      'id','user_id','airline_iata','flight_number','dep_iata','arr_iata',
      'scheduled_dep','scheduled_arr','note','alerts_enabled','created_at',
    ]));
  });

  test('push_tokens columns', () => {
    const cols = db.prepare("PRAGMA table_info(push_tokens)").all().map(c => c.name);
    expect(cols).toEqual(expect.arrayContaining(['id','user_id','endpoint','p256dh','auth','created_at']));
  });
});
```

- [ ] **Step 2: Append migrations**

```js
// After Plan 2 ingestion migrations in db.js
db.exec(`
  CREATE TABLE IF NOT EXISTS user_trips (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    airline_iata    TEXT NOT NULL,
    flight_number   TEXT NOT NULL,
    dep_iata        TEXT NOT NULL,
    arr_iata        TEXT NOT NULL,
    scheduled_dep   INTEGER NOT NULL,
    scheduled_arr   INTEGER NOT NULL,
    note            TEXT,
    alerts_enabled  INTEGER NOT NULL DEFAULT 1,
    created_at      INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_trips_user ON user_trips(user_id);
  CREATE INDEX IF NOT EXISTS idx_trips_upcoming ON user_trips(scheduled_dep);
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS push_tokens (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    endpoint   TEXT NOT NULL UNIQUE,
    p256dh     TEXT NOT NULL,
    auth       TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_push_user ON push_tokens(user_id);
`);
```

- [ ] **Step 3: Run test → PASS**

Run: `cd server && npx jest src/__tests__/trips.migrations.test.js`

- [ ] **Step 4: Commit**

```bash
git add server/src/models/db.js server/src/__tests__/trips.migrations.test.js
git commit -m "feat(db): user_trips + push_tokens migrations"
```

---

## Task 2: trips.js + pushTokens.js models

**Files:**
- Create: `server/src/models/trips.js`, `server/src/models/pushTokens.js`

- [ ] **Step 1: trips.js (ALL queries scoped by user_id)**

```js
'use strict';
const { db } = require('./db');

const stmts = {
  create: db.prepare(`
    INSERT INTO user_trips
      (user_id, airline_iata, flight_number, dep_iata, arr_iata, scheduled_dep, scheduled_arr, note, alerts_enabled, created_at)
    VALUES (@user_id, @airline_iata, @flight_number, @dep_iata, @arr_iata, @scheduled_dep, @scheduled_arr, @note, @alerts_enabled, @now)
  `),
  listByUser: db.prepare(`
    SELECT * FROM user_trips WHERE user_id = ? ORDER BY scheduled_dep ASC
  `),
  getOwned: db.prepare(`
    SELECT * FROM user_trips WHERE id = ? AND user_id = ?
  `),
  deleteOwned: db.prepare(`
    DELETE FROM user_trips WHERE id = ? AND user_id = ?
  `),
  listUpcomingWithAlerts: db.prepare(`
    SELECT * FROM user_trips
     WHERE alerts_enabled = 1 AND scheduled_dep > ? AND scheduled_dep < ?
  `),
};

module.exports = {
  create(row) {
    const info = stmts.create.run({ now: Date.now(), alerts_enabled: 1, note: null, ...row });
    return info.lastInsertRowid;
  },
  listByUser(userId)  { return stmts.listByUser.all(userId); },
  getOwned(tripId, userId) { return stmts.getOwned.get(tripId, userId); },
  deleteOwned(tripId, userId) {
    const info = stmts.deleteOwned.run(tripId, userId);
    return info.changes === 1;
  },
  listUpcomingWithAlerts(fromMs, toMs) { return stmts.listUpcomingWithAlerts.all(fromMs, toMs); },
};
```

- [ ] **Step 2: pushTokens.js**

```js
'use strict';
const { db } = require('./db');

const stmts = {
  upsert: db.prepare(`
    INSERT INTO push_tokens (user_id, endpoint, p256dh, auth, created_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(endpoint) DO UPDATE SET
      user_id = excluded.user_id,
      p256dh  = excluded.p256dh,
      auth    = excluded.auth
  `),
  listByUser: db.prepare('SELECT * FROM push_tokens WHERE user_id = ?'),
  removeEndpoint: db.prepare('DELETE FROM push_tokens WHERE endpoint = ?'),
};

module.exports = {
  upsert(userId, { endpoint, keys }) {
    stmts.upsert.run(userId, endpoint, keys.p256dh, keys.auth, Date.now());
  },
  listByUser(userId) { return stmts.listByUser.all(userId); },
  remove(endpoint) { stmts.removeEndpoint.run(endpoint); },
};
```

- [ ] **Step 3: Commit**

```bash
git add server/src/models/trips.js server/src/models/pushTokens.js
git commit -m "feat(models): trips + pushTokens prepared statements (owner-scoped)"
```

---

## Task 3: Trip-ownership integration test (CRITICAL — MUST tier)

**Files:**
- Create: `server/src/__tests__/trips.ownership.test.js`

User A cannot GET / DELETE user B's trip. This is the privacy-breach test.

- [ ] **Step 1: Test**

```js
// server/src/__tests__/trips.ownership.test.js
const express = require('express');
const request = require('supertest');

const { db } = require('../models/db');
const tripsModel = require('../models/trips');
const controller = require('../controllers/tripsController');

// Minimal fake auth middleware — sets req.user from a header for the test.
function fakeAuth(req, _res, next) {
  const id = Number(req.headers['x-user-id']);
  req.user = { id, subscription_tier: 'pro_lifetime', sub_valid_until: null };
  next();
}

function app() {
  const a = express();
  a.use(express.json());
  a.use(fakeAuth);
  a.get('/trips',         controller.list);
  a.post('/trips',        controller.create);
  a.get('/trips/:id',     controller.get);
  a.delete('/trips/:id',  controller.remove);
  return a;
}

let userA, userB, tripA;

beforeAll(() => {
  db.exec("DELETE FROM user_trips");
  db.exec("DELETE FROM users WHERE email LIKE '%.ownership@test'");
  const now = Date.now();
  userA = db.prepare("INSERT INTO users (email, password_hash, created_at, updated_at, email_verified) VALUES ('a.ownership@test','x',?,?,1)").run(now, now).lastInsertRowid;
  userB = db.prepare("INSERT INTO users (email, password_hash, created_at, updated_at, email_verified) VALUES ('b.ownership@test','x',?,?,1)").run(now, now).lastInsertRowid;
  tripA = tripsModel.create({
    user_id: userA, airline_iata: 'BA', flight_number: '175',
    dep_iata: 'LHR', arr_iata: 'JFK',
    scheduled_dep: now + 86400000, scheduled_arr: now + 86400000 + 7 * 3600000,
  });
});

describe('trip ownership', () => {
  test('user B cannot GET user A trip', async () => {
    const res = await request(app()).get(`/trips/${tripA}`).set('x-user-id', String(userB));
    expect(res.status).toBe(404);
  });

  test('user B cannot DELETE user A trip', async () => {
    const res = await request(app()).delete(`/trips/${tripA}`).set('x-user-id', String(userB));
    expect(res.status).toBe(404);
    const still = tripsModel.getOwned(tripA, userA);
    expect(still).toBeTruthy(); // unchanged
  });

  test("user B's /trips list does NOT contain user A trip", async () => {
    const res = await request(app()).get('/trips').set('x-user-id', String(userB));
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  test('user A can GET + DELETE their own trip', async () => {
    const g = await request(app()).get(`/trips/${tripA}`).set('x-user-id', String(userA));
    expect(g.status).toBe(200);
    expect(g.body.data.flight_number).toBe('175');
    const d = await request(app()).delete(`/trips/${tripA}`).set('x-user-id', String(userA));
    expect(d.status).toBe(200);
  });
});
```

- [ ] **Step 2: Don't run yet — the controller doesn't exist. Move on to Task 4.**

---

## Task 4: tripsController + routes

**Files:**
- Create: `server/src/controllers/tripsController.js`, `server/src/routes/trips.js`

- [ ] **Step 1: Controller**

```js
'use strict';

const tripsModel = require('../models/trips');
const tripStatus = require('../services/tripStatusService');

function list(req, res) {
  const rows = tripsModel.listByUser(req.user.id);
  res.json({ success: true, data: rows });
}

function get(req, res) {
  const row = tripsModel.getOwned(Number(req.params.id), req.user.id);
  if (!row) return res.status(404).json({ success: false, message: 'Not found' });
  res.json({ success: true, data: row });
}

async function getStatus(req, res) {
  const row = tripsModel.getOwned(Number(req.params.id), req.user.id);
  if (!row) return res.status(404).json({ success: false, message: 'Not found' });
  try {
    const status = await tripStatus.compute(row);
    res.json({ success: true, data: status });
  } catch (err) {
    console.error('[trips] status failed:', err);
    res.status(500).json({ success: false, message: 'Status failed' });
  }
}

function create(req, res) {
  const b = req.body || {};
  const required = ['airline_iata','flight_number','dep_iata','arr_iata','scheduled_dep','scheduled_arr'];
  for (const f of required) {
    if (!b[f]) return res.status(400).json({ success: false, message: `Missing ${f}` });
  }
  const id = tripsModel.create({
    user_id: req.user.id,
    airline_iata: b.airline_iata,
    flight_number: String(b.flight_number).replace(/[^0-9]/g, ''),
    dep_iata: b.dep_iata.toUpperCase(),
    arr_iata: b.arr_iata.toUpperCase(),
    scheduled_dep: Number(b.scheduled_dep),
    scheduled_arr: Number(b.scheduled_arr),
    note: b.note || null,
    alerts_enabled: b.alerts_enabled === false ? 0 : 1,
  });
  res.json({ success: true, id });
}

function remove(req, res) {
  const ok = tripsModel.deleteOwned(Number(req.params.id), req.user.id);
  if (!ok) return res.status(404).json({ success: false, message: 'Not found' });
  res.json({ success: true });
}

module.exports = { list, get, getStatus, create, remove };
```

- [ ] **Step 2: Routes**

```js
'use strict';
const express = require('express');
const requireAuth = require('../middleware/requireAuth');
const requireTier = require('../middleware/entitlement');
const controller  = require('../controllers/tripsController');

const router = express.Router();

// All trip routes require auth. Creation additionally requires Pro.
router.use(requireAuth);

router.get('/',              controller.list);
router.get('/:id',           controller.get);
router.get('/:id/status',    controller.getStatus);
router.delete('/:id',        controller.remove);
router.post('/',             requireTier('pro'), controller.create);

module.exports = router;
```

- [ ] **Step 3: Mount in index.js**

Add near the other router mounts:

```js
if (process.env.TRIPS_ENABLED !== '0') {
  app.use('/api/trips', require('./routes/trips'));
}
```

- [ ] **Step 4: Run the ownership test — expect PASS**

```bash
cd server && npx jest src/__tests__/trips.ownership.test.js --verbose
```
Expected: 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/controllers/tripsController.js server/src/routes/trips.js server/src/index.js
git commit -m "feat(trips): CRUD endpoints with owner-scoped queries + TRIPS_ENABLED gate"
git add server/src/__tests__/trips.ownership.test.js
git commit -m "test(trips): user A cannot access user B trips (privacy)"
```

---

## Task 5: tripStatusService — live status computation

**Files:**
- Create: `server/src/services/tripStatusService.js`

Aggregates:
- Live gate/terminal from AeroDataBox
- Delay prediction from Plan 2
- Inbound aircraft: lookup the incoming leg via adsb.lol (by callsign or tail), tell user where the plane is now

- [ ] **Step 1: Create service**

```js
'use strict';

const aerodatabox = require('./aerodataboxService');
const adsblol     = require('./adsblolService');
const { predictDelay } = require('./delayPredictionService');

async function compute(trip) {
  const [live, inbound, prediction] = await Promise.all([
    safeLive(trip),
    safeInbound(trip),
    Promise.resolve(predictDelay({
      airline: trip.airline_iata,
      flightNumber: trip.flight_number,
      dep: trip.dep_iata, arr: trip.arr_iata,
    })),
  ]);

  return {
    trip: {
      id: trip.id,
      route: `${trip.dep_iata} → ${trip.arr_iata}`,
      flight: `${trip.airline_iata}${trip.flight_number}`,
      scheduledDep: trip.scheduled_dep,
      scheduledArr: trip.scheduled_arr,
    },
    live,         // { status, actualDep?, actualArr?, gate, terminal } or null
    inbound,      // { callsign, fromIata, nowLatLon } or null
    prediction,   // from predictDelay()
  };
}

async function safeLive(trip) {
  if (!aerodatabox.isEnabled?.()) return null;
  try {
    const date = new Date(trip.scheduled_dep).toISOString().slice(0, 10);
    const f = await aerodatabox.getFlightByNumber(`${trip.airline_iata}${trip.flight_number}`, date);
    if (!f) return null;
    return {
      status: f.status || null,
      actualDep:  f.departure?.actualTimeUtc ? Date.parse(f.departure.actualTimeUtc) : null,
      actualArr:  f.arrival?.actualTimeUtc   ? Date.parse(f.arrival.actualTimeUtc)   : null,
      originGate: f.departure?.gate || null,
      originTerminal: f.departure?.terminal || null,
      destGate: f.arrival?.gate || null,
      destTerminal: f.arrival?.terminal || null,
      baggage: f.arrival?.baggageBelt || null,
    };
  } catch (err) {
    console.warn('[tripStatus] live fail:', err.message);
    return null;
  }
}

async function safeInbound(trip) {
  // adsb.lol — look up current position by callsign. If no live hit, return null.
  if (!adsblol.isEnabled?.()) return null;
  try {
    const callsign = `${trip.airline_iata}${trip.flight_number}`.toUpperCase();
    const hit = await adsblol.findByCallsign?.(callsign);
    if (!hit) return null;
    return {
      callsign,
      altitude:  hit.altitude || null,
      position:  hit.lat && hit.lon ? { lat: hit.lat, lon: hit.lon } : null,
      heading:   hit.track || null,
      origin:    hit.origin || null,
      destination: hit.destination || null,
    };
  } catch (err) {
    console.warn('[tripStatus] inbound fail:', err.message);
    return null;
  }
}

module.exports = { compute };
```

Note: if `adsblolService` doesn't yet export `findByCallsign`, add a thin wrapper around the existing `/v2/callsign/{cs}` endpoint. Worker patterns in Plan 2 show the adsb.lol client surface.

- [ ] **Step 2: Commit**

```bash
git add server/src/services/tripStatusService.js
git commit -m "feat(trips): tripStatusService — live gate + inbound lookup + prediction"
```

---

## Task 6: Web-push service + routes

**Files:**
- Create: `server/src/services/pushService.js`, `server/src/controllers/pushController.js`, `server/src/routes/push.js`

- [ ] **Step 1: Install web-push**

```bash
cd server && npm install web-push
```

- [ ] **Step 2: pushService.js**

```js
'use strict';

const webpush = require('web-push');
const tokensModel = require('../models/pushTokens');

let configured = false;
function ensureConfigured() {
  if (configured) return;
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) throw new Error('VAPID keys not set');
  webpush.setVapidDetails(VAPID_SUBJECT || 'mailto:admin@himaxym.com', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  configured = true;
}

function isConfigured() {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

async function sendToUser(userId, payload) {
  if (!isConfigured()) return { sent: 0, failed: 0, skipped: true };
  ensureConfigured();
  const tokens = tokensModel.listByUser(userId);
  let sent = 0, failed = 0;
  for (const t of tokens) {
    try {
      await webpush.sendNotification(
        { endpoint: t.endpoint, keys: { p256dh: t.p256dh, auth: t.auth } },
        JSON.stringify(payload)
      );
      sent++;
    } catch (err) {
      failed++;
      if (err.statusCode === 410 || err.statusCode === 404) {
        // endpoint expired — remove it
        tokensModel.remove(t.endpoint);
      } else {
        console.warn('[push] send failed:', err.message);
      }
    }
  }
  return { sent, failed };
}

module.exports = { sendToUser, isConfigured };
```

- [ ] **Step 3: pushController.js**

```js
'use strict';

const tokensModel = require('../models/pushTokens');

function subscribe(req, res) {
  const { endpoint, keys } = req.body || {};
  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    return res.status(400).json({ success: false, message: 'Missing endpoint or keys' });
  }
  tokensModel.upsert(req.user.id, { endpoint, keys });
  res.json({ success: true });
}

function unsubscribe(req, res) {
  const { endpoint } = req.body || {};
  if (!endpoint) return res.status(400).json({ success: false, message: 'Missing endpoint' });
  tokensModel.remove(endpoint);
  res.json({ success: true });
}

function publicKey(_req, res) {
  res.json({ success: true, publicKey: process.env.VAPID_PUBLIC_KEY || null });
}

module.exports = { subscribe, unsubscribe, publicKey };
```

- [ ] **Step 4: routes/push.js**

```js
'use strict';
const express = require('express');
const requireAuth = require('../middleware/requireAuth');
const requireTier = require('../middleware/entitlement');
const controller  = require('../controllers/pushController');

const router = express.Router();
router.get('/public-key', controller.publicKey); // public — browser needs it before login even
router.post('/subscribe',   requireAuth, requireTier('pro'), controller.subscribe);
router.post('/unsubscribe', requireAuth, controller.unsubscribe);

module.exports = router;
```

- [ ] **Step 5: Mount + env**

In `server/src/index.js`:
```js
app.use('/api/push', require('./routes/push'));
```

In `server/.env.example`:
```
# Web-Push (VAPID) — generate once via:
#   npx web-push generate-vapid-keys
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=mailto:admin@himaxym.com
TRIPS_ENABLED=1
```

- [ ] **Step 6: Commit**

```bash
git add server/package.json server/package-lock.json server/src/services/pushService.js server/src/controllers/pushController.js server/src/routes/push.js server/src/index.js server/.env.example
git commit -m "feat(push): web-push subscribe/unsubscribe + VAPID scaffolding"
```

---

## Task 7: tripAlertWorker — scans and pushes

**Files:**
- Create: `server/src/workers/tripAlertWorker.js`

- [ ] **Step 1: Worker**

```js
'use strict';

const tripsModel = require('../models/trips');
const tripStatus = require('../services/tripStatusService');
const push       = require('../services/pushService');

const INITIAL_DELAY_MS = 5 * 60 * 1000;
const CYCLE_INTERVAL_MS = 15 * 60 * 1000; // every 15 min
const ALERT_THRESHOLD_MIN = 30;            // tell user if predicted delay ≥ 30 min
const LOOKAHEAD_MS = 24 * 60 * 60 * 1000;  // only scan trips in the next 24h

// In-memory dedup: (tripId -> lastAlertedAtMs). Lost on restart — fine for v1.
const alertedAt = new Map();
const REALERT_COOLDOWN_MS = 60 * 60 * 1000;

async function runCycle() {
  const now = Date.now();
  const trips = tripsModel.listUpcomingWithAlerts(now, now + LOOKAHEAD_MS);
  if (!trips.length) return;
  let notified = 0;
  for (const t of trips) {
    try {
      const status = await tripStatus.compute(t);
      const pred   = status.prediction;
      if (!pred || pred.confidence === 'low') continue;
      if (pred.median < ALERT_THRESHOLD_MIN) continue;
      const last = alertedAt.get(t.id) || 0;
      if (now - last < REALERT_COOLDOWN_MS) continue;
      await push.sendToUser(t.user_id, {
        title: `Possible delay on ${t.airline_iata}${t.flight_number}`,
        body:  `Predicted median delay ~${pred.median} min based on ${pred.sample} observations.`,
        url: `/trips/${t.id}`,
      });
      alertedAt.set(t.id, now);
      notified++;
    } catch (err) {
      console.warn(`[tripAlert] trip ${t.id} failed:`, err.message);
    }
  }
  if (notified) console.log(`[tripAlert] cycle notified=${notified}`);
}

exports.startTripAlertWorker = () => {
  if (process.env.TRIPS_ENABLED === '0' || !push.isConfigured()) {
    console.log('[tripAlert] disabled');
    return () => {};
  }
  let intervalTimer = null;
  const initialTimer = setTimeout(() => {
    runCycle().catch(err => console.warn('[tripAlert] initial failed:', err.message));
    intervalTimer = setInterval(() => {
      runCycle().catch(err => console.warn('[tripAlert] failed:', err.message));
    }, CYCLE_INTERVAL_MS);
  }, INITIAL_DELAY_MS);
  return function stop() {
    clearTimeout(initialTimer);
    if (intervalTimer) clearInterval(intervalTimer);
  };
};

exports._runCycleForTest = runCycle;
```

- [ ] **Step 2: Wire into index.js next to other workers**

```js
const { startTripAlertWorker } = require('./workers/tripAlertWorker');
const stopTripAlertWorker = startTripAlertWorker();
```

- [ ] **Step 3: Commit**

```bash
git add server/src/workers/tripAlertWorker.js server/src/index.js
git commit -m "feat(workers): tripAlertWorker — web-push alerts on predicted-delay threshold"
```

---

## Task 8: Client — service worker + push enrollment

**Files:**
- Create: `client/public/sw.js`, `client/src/utils/push.js`

- [ ] **Step 1: sw.js — push listener**

```js
// client/public/sw.js
self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {};
  const title = data.title || 'himaxym';
  const options = {
    body: data.body || '',
    icon: '/android-chrome-192x192.png',
    badge: '/favicon-32x32.png',
    data: { url: data.url || '/' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(clients.openWindow(url));
});
```

- [ ] **Step 2: utils/push.js**

```js
// client/src/utils/push.js
import { API_BASE } from '../config/api';

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

export async function enablePushNotifications() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    throw new Error('Push not supported by this browser');
  }
  const reg = await navigator.serviceWorker.register('/sw.js');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Permission denied');

  const { publicKey } = await fetch(`${API_BASE}/api/push/public-key`).then(r => r.json());
  if (!publicKey) throw new Error('Server has no VAPID key');

  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });

  const token = localStorage.getItem('authToken');
  const res = await fetch(`${API_BASE}/api/push/subscribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(sub.toJSON()),
  });
  const j = await res.json();
  if (!j.success) throw new Error(j.message || 'subscribe failed');
  return true;
}
```

- [ ] **Step 3: Commit**

```bash
git add client/public/sw.js client/src/utils/push.js
git commit -m "feat(push): service worker + browser enrollment util"
```

---

## Task 9: My Trips page + AddToTripsButton

**Files:**
- Create: `client/src/pages/MyTrips.jsx`, `MyTrips.css`
- Create: `client/src/components/AddToTripsButton.jsx`
- Create: `client/src/hooks/useTrips.js`

- [ ] **Step 1: useTrips hook**

```js
// client/src/hooks/useTrips.js
import { useState, useEffect, useCallback } from 'react';
import { API_BASE } from '../config/api';

function authHeaders() {
  const token = localStorage.getItem('authToken');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function useTrips() {
  const [trips, setTrips] = useState(null);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/trips`, { headers: authHeaders() });
      const j = await res.json();
      if (!j.success) throw new Error(j.message);
      setTrips(j.data);
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);
  return { trips, error, refresh };
}

export async function addTrip(payload) {
  const res = await fetch(`${API_BASE}/api/trips`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(payload),
  });
  return res.json();
}

export async function deleteTrip(id) {
  const res = await fetch(`${API_BASE}/api/trips/${id}`, {
    method: 'DELETE', headers: authHeaders(),
  });
  return res.json();
}

export async function fetchTripStatus(id) {
  const res = await fetch(`${API_BASE}/api/trips/${id}/status`, { headers: authHeaders() });
  return res.json();
}
```

- [ ] **Step 2: AddToTripsButton.jsx**

```jsx
// client/src/components/AddToTripsButton.jsx
import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import UpgradeModal from './UpgradeModal';
import { addTrip } from '../hooks/useTrips';
import { enablePushNotifications } from '../utils/push';

export default function AddToTripsButton({ flight }) {
  const { user } = useAuth();
  const [upgrade, setUpgrade] = useState(false);
  const [saving, setSaving]   = useState(false);
  const [added, setAdded]     = useState(false);

  const isPro = user?.subscription_tier?.startsWith('pro_');

  async function onClick() {
    if (!user) { window.location.href = '/login'; return; }
    if (!isPro) { setUpgrade(true); return; }
    setSaving(true);
    try {
      const { success } = await addTrip({
        airline_iata:  flight.airline,
        flight_number: flight.flightNumber || flight.number,
        dep_iata:      flight.departure?.code,
        arr_iata:      flight.arrival?.code,
        scheduled_dep: new Date(flight.departureTime).getTime(),
        scheduled_arr: new Date(flight.arrivalTime).getTime(),
      });
      if (success) {
        setAdded(true);
        enablePushNotifications().catch(err => console.warn('[push] enrollment skipped:', err.message));
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="btn btn-add-trip"
        onClick={onClick}
        disabled={saving || added}
      >
        {added ? '✓ Added to My Trips' : saving ? 'Adding…' : '+ Add to My Trips'}
      </button>
      <UpgradeModal
        open={upgrade}
        reason="Track this flight live, get push alerts on delays, and see gate/terminal in My Trips."
        onClose={() => setUpgrade(false)}
      />
    </>
  );
}
```

- [ ] **Step 3: MyTrips.jsx**

```jsx
// client/src/pages/MyTrips.jsx
import { useState } from 'react';
import { useTrips, deleteTrip, fetchTripStatus } from '../hooks/useTrips';
import './MyTrips.css';

export default function MyTrips() {
  const { trips, error, refresh } = useTrips();
  const [statusById, setStatusById] = useState({});

  if (error) return <div className="mytrips-error">{error}</div>;
  if (!trips) return <div className="mytrips-loading">Loading…</div>;
  if (!trips.length) return (
    <div className="mytrips-empty">
      <h2>No trips yet</h2>
      <p>Find a flight and click <strong>+ Add to My Trips</strong> to track it here.</p>
    </div>
  );

  async function loadStatus(id) {
    const j = await fetchTripStatus(id);
    if (j.success) setStatusById(s => ({ ...s, [id]: j.data }));
  }

  return (
    <div className="mytrips">
      <h1>My Trips</h1>
      <ul className="trip-list">
        {trips.map(t => (
          <li key={t.id} className="trip-card">
            <div className="trip-head">
              <div className="trip-title">
                {t.airline_iata}{t.flight_number} · {t.dep_iata} → {t.arr_iata}
              </div>
              <div className="trip-when">{new Date(t.scheduled_dep).toLocaleString()}</div>
            </div>
            <div className="trip-actions">
              <button onClick={() => loadStatus(t.id)}>Refresh status</button>
              <button onClick={async () => { await deleteTrip(t.id); refresh(); }}>Remove</button>
            </div>
            {statusById[t.id] && <TripStatus status={statusById[t.id]} />}
          </li>
        ))}
      </ul>
    </div>
  );
}

function TripStatus({ status }) {
  const { live, prediction, inbound } = status;
  return (
    <div className="trip-status">
      {live && (
        <div className="trip-live">
          <span>Gate: {live.originGate || '—'} · Terminal: {live.originTerminal || '—'}</span>
          {live.destGate && <span> · Arrival gate: {live.destGate} · T{live.destTerminal}</span>}
          {live.baggage && <span> · Baggage: {live.baggage}</span>}
        </div>
      )}
      {prediction && prediction.confidence !== 'low' && (
        <div className="trip-pred">
          Predicted delay: median {prediction.median} min (p75 {prediction.p75}) · {prediction.sample} samples · {prediction.confidence} confidence
        </div>
      )}
      {inbound?.position && (
        <div className="trip-inbound">
          Inbound: {inbound.callsign} @ {inbound.altitude} ft — {inbound.position.lat.toFixed(2)},{inbound.position.lon.toFixed(2)}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Minimal CSS**

```css
/* client/src/pages/MyTrips.css */
.mytrips { max-width: 900px; margin: 24px auto; padding: 0 16px; }
.trip-list { list-style: none; padding: 0; display: grid; gap: 12px; }
.trip-card { border: 1px solid #e5e7eb; border-radius: 8px; padding: 14px; background: #fff; }
.trip-head { display: flex; justify-content: space-between; align-items: baseline; }
.trip-title { font-weight: 600; }
.trip-when { color: #6b7280; font-size: 14px; }
.trip-actions { margin-top: 10px; display: flex; gap: 8px; }
.trip-actions button { padding: 6px 10px; border-radius: 6px; border: 1px solid #d1d5db; background: #f9fafb; cursor: pointer; }
.trip-status { margin-top: 10px; font-size: 13px; color: #374151; display: grid; gap: 4px; }
.mytrips-empty { text-align: center; padding: 48px 16px; }
```

- [ ] **Step 5: Mount route + add button in FlightCard**

In `App.jsx` (or router root), add a `/trips` route rendering `<MyTrips />`. Add a nav link visible when `user` is present.

In `FlightCard.jsx`, add `<AddToTripsButton flight={flight} />` inside the existing actions area.

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/MyTrips.jsx client/src/pages/MyTrips.css client/src/components/AddToTripsButton.jsx client/src/hooks/useTrips.js client/src/components/FlightCard.jsx client/src/App.jsx
git commit -m "feat(ui): My Trips page + AddToTripsButton wired into FlightCard"
```

---

## Task 10: Deploy workflow — VAPID secrets

**Files:**
- Modify: `.github/workflows/deploy.yml`

- [ ] **Step 1: Pass VAPID secrets to the server**

Add in the deploy env block (alongside Plan 1's Stripe secrets):

```yaml
          VAPID_PUBLIC_KEY:  ${{ secrets.VAPID_PUBLIC_KEY }}
          VAPID_PRIVATE_KEY: ${{ secrets.VAPID_PRIVATE_KEY }}
          VAPID_SUBJECT:     ${{ secrets.VAPID_SUBJECT }}
          TRIPS_ENABLED:     ${{ secrets.TRIPS_ENABLED }}
```

- [ ] **Step 2: User note**

Generate VAPID keys locally once:
```bash
cd server && npx web-push generate-vapid-keys
```
Paste output into GitHub repo Secrets. Set `VAPID_SUBJECT` = `mailto:your@email`.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/deploy.yml
git commit -m "chore(deploy): pass VAPID/TRIPS env through workflow"
```

---

## Task 11: End-to-end smoke (local)

- [ ] **Step 1: Generate VAPID, set in server/.env**

```bash
cd server && npx web-push generate-vapid-keys
```
Copy keys into `.env`. Start the server.

- [ ] **Step 2: Login as Pro, add a trip via UI**

Click "+ Add to My Trips" on a FlightCard. Expect:
- Trip created (200 from POST /api/trips)
- Browser asks for Notifications permission → grant
- `/api/push/subscribe` POST succeeds
- Visit `/trips`, see the trip card
- Click "Refresh status" → see prediction block (or "collecting data" if samples < 10)

- [ ] **Step 3: Manually trigger a push**

```bash
node -e "require('./src/services/pushService').sendToUser(<USER_ID>, {title:'Test',body:'Hi',url:'/trips'})"
```
Expected: browser shows a notification.

- [ ] **Step 4: Privacy check — second user**

Create user B, login, hit `GET /api/trips/<USER_A_TRIP_ID>` with user B's token. Expect 404.

- [ ] **Step 5: Run full test suite**

```bash
cd server && npm test
cd ../client && npm run test
```

---

## Self-review checklist

- [ ] Every trips query is owner-scoped (model uses `WHERE id = ? AND user_id = ?` for reads/writes)
- [ ] `trips.ownership.test.js` passes — user B cannot read/delete user A's trip
- [ ] `POST /api/trips` requires Pro (`requireTier('pro')`); GET/DELETE only require auth
- [ ] `TRIPS_ENABLED=0` disables the router at mount time (no 500s, cleanly hidden)
- [ ] Web-push subscribe is gated by `requireTier('pro')`
- [ ] VAPID keys are NOT hard-coded — `.env.example` documents how to generate
- [ ] Expired push endpoints (410/404) are auto-removed from `push_tokens` table
- [ ] Service worker path matches where it's served (`/sw.js` at domain root → `client/public/sw.js`)
- [ ] `tripAlertWorker` has a restart-safe dedup (in-memory is fine for v1 but documented)

Next plan: **Plan 5 — Pricing page + legal + launch.**
