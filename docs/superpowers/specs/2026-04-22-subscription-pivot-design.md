# Subscription Pivot — Design Spec

**Date:** 2026-04-22
**Status:** Approved
**Author:** denyskolomiiets (with brainstorming session)

## Problem

The affiliate model (Aviasales / Travelpayouts CTAs) on himaxym.com did not convert at rates capable of sustaining the project. Users land on the site for aircraft- and route-centric exploration (by-aircraft search, route maps, `ValidityCalendar`), then see a "Find this route on Aviasales" button that feels bolted on. The revenue model does not match user intent.

## Goal

Pivot to a paid-subscription product built around the project's actual edge: **aircraft-aware, data-rich flight cards and trip companion features**. Stop trying to be a booking funnel; be an information utility that enthusiasts, frequent flyers, and aircraft geeks pay to use.

## Non-goals (v1)

- Native iOS/Android in-app purchases (defers Apple 3.1.1 30% cut — web-only payment for MVP; Capacitor app stays free-tier, payment happens via web login)
- Machine-learned delay prediction (rule-based stats only in v1)
- APNs / FCM push (web-push Notification API only in v1)
- Flexible per-feature entitlements table (hard-coded paywall mappings in middleware)
- Postgres migration (SQLite is fine until ~10K paying users)
- Postponed to v2: live aircraft tracking integration, seat maps, crowdsourced reviews, loyalty program integrations

## Architecture overview

```
CLIENT (React SPA + Capacitor iOS/Android)
  existing: FlightCard, ByAircraft, RouteMap, ValidityCalendar
  new:      Pricing/Paywall UI, My Trips, UpgradeModal, teaser blocks

SERVER (Express, Node — existing)
  existing: /api/auth, /api/flights, /api/aircraft, /api/map
  new:      /api/subscriptions (checkout, webhook, portal)
            /api/trips (CRUD, status)
            /api/flights/:id/enriched (γ card data)
            /api/push/subscribe (web-push)
  new middleware: entitlement.js — requireTier('pro')
  new services:   enrichmentService — aggregates γ fields

WORKERS (background, opt-in via ENV)
  existing: adsblolWorker (observed_routes)
  new:      delayIngestionWorker (scheduled vs actual every 6h)
            fleetBootstrapWorker (Mictronics + OpenSky aircraft metadata)

DB (SQLite, server/data/app.db)
  existing tables unchanged; add:
    users.subscription_tier, users.sub_valid_until, users.stripe_customer_id
    subscriptions, lifetime_counter, webhook_events
    flight_observations, aircraft_fleet, airline_liveries, airline_amenities
    user_trips, push_tokens

EXTERNAL
  new:      Stripe (payments), OpenWeather (free tier)
  existing: AeroDataBox, adsb.lol, Mailgun, Sentry, Travelpayouts (data only)
```

### Key architectural decisions

- **Minimal entitlement schema:** `users.subscription_tier` + `sub_valid_until` columns. Feature gates hard-coded in middleware. A flexible entitlements table is v2.
- **Stripe = single source of truth.** Webhook updates `subscriptions` table and denormalises into `users.subscription_tier`. No self-healing reconciliation jobs — Stripe webhooks are reliable and retried.
- **Web-push only in v1** — service worker on himaxym.com. Native APNs/FCM deferred to when IAP integration lands.
- **Capacitor app hides Pricing in v1.** Inside the native app, the Pricing page and "Subscribe" buttons are hidden; "Upgrade to Pro" CTAs redirect to the website in an external browser. This sidesteps Apple guideline 3.1.1 while we validate the model web-first. Native IAP is a v2 decision.
- **Pluggable data source interface** — every ingestion service (AeroDataBox, OpenWeather, Wikimedia, etc.) implements a common `DataSource` contract so new sources can be added without rewriting the enrichment service.

## Subscription tiers & pricing — "Launch Lever"

| Tier          | Price        | Availability  | Notes                                                  |
|---------------|--------------|---------------|--------------------------------------------------------|
| Free          | —            | always        | Everything currently on himaxym.com stays free         |
| Pro Monthly   | $4.99 / mo   | always        | 7-day trial with card                                  |
| Pro Annual    | $39 / year   | always        | ~$3.25/mo equivalent; 7-day trial                      |
| Pro Lifetime  | $99 one-time | **500 caps**  | Founders tier. Hard cap, never reopens.                |

**Rationale:** Lifetime at 500 caps creates one-time scarcity urgency without permanently undercutting recurring revenue. Free tier preserves all existing functionality — no existing-user regression.

## Free vs Pro feature split

**Everything currently on himaxym.com stays Free.** Pro adds NEW capabilities — no feature is moved from Free → Pro.

### γ "Insider Card" (Pro) — shown on all search results

Pro users see enriched FlightCard:

- **Livery photo** of the actual aircraft type in the airline's livery (Wikimedia Commons)
- **Aircraft registration + build year** ("G-STBA · built 2010 · 15 yrs")
- **On-time performance (90d)** — "87% ✓" from `flight_observations` aggregation
- **Typical delay** — median + p75 from historic data
- **CO₂ per passenger** — ICAO fuel-burn formula × great-circle distance
- **Amenities** — WiFi / Power / Entertainment / Meal (manually seeded ~200 airlines)
- **Terminal / Gate** at origin + destination (when available via AeroDataBox)
- **Weather at origin + destination** — OpenWeather, 30-min cache

Free users see **teasers** — field labels and icons visible but values blurred with a 🔒 Pro badge. Click → UpgradeModal.

### α "Traveler Shield" (Pro) — My Trips page

Distinct page reached via "Add to My Trips" button on FlightCard:

- Trip list with live status per trip
- **Delay prediction** computed on request from `flight_observations` (rule-based, 3-tier fallback)
- **Inbound aircraft lookup** — where the tail# is coming from now (adsb.lol by tail#)
- **Gate / terminal / baggage** live from AeroDataBox
- **Connection risk** — if one leg delays, which connections are at risk
- **Web-push alerts** — browser Notification API, service worker on himaxym.com

## Subscription lifecycle

### Flow

```
1. User clicks "Subscribe" (Monthly / Annual / Lifetime)
2. POST /api/subscriptions/checkout
3. Server validates: if Lifetime, atomic counter check
4. stripe.checkout.sessions.create() → redirect URL
5. User pays on Stripe-hosted checkout
6. Stripe → POST /api/subscriptions/webhook (signed)
7. Server verifies signature, dedups by event.id, updates DB
8. Client GET /api/auth/me → sees new tier → unlocks γ + α UI
```

### Schema

```sql
-- users: three new columns
ALTER TABLE users ADD COLUMN subscription_tier TEXT NOT NULL DEFAULT 'free';
ALTER TABLE users ADD COLUMN sub_valid_until INTEGER;      -- unix ms, NULL for free/lifetime
ALTER TABLE users ADD COLUMN stripe_customer_id TEXT;
CREATE UNIQUE INDEX idx_users_stripe_cust
  ON users(stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;

-- One row per Stripe subscription (or one-time lifetime charge)
CREATE TABLE subscriptions (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stripe_sub_id     TEXT UNIQUE,          -- NULL for lifetime (one-time charge)
  stripe_session_id TEXT,
  tier              TEXT NOT NULL,         -- 'pro_monthly' | 'pro_annual' | 'pro_lifetime'
  status            TEXT NOT NULL,         -- 'trialing' | 'active' | 'past_due' | 'canceled' | 'refunded'
  period_end        INTEGER,               -- unix ms, NULL for lifetime
  trial_end         INTEGER,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);
CREATE INDEX idx_subs_user ON subscriptions(user_id);

-- Single-row counter for the 500-cap lifetime slots
CREATE TABLE lifetime_counter (
  id    INTEGER PRIMARY KEY CHECK (id = 1),
  taken INTEGER NOT NULL DEFAULT 0,
  cap   INTEGER NOT NULL DEFAULT 500
);
INSERT OR IGNORE INTO lifetime_counter (id, taken, cap) VALUES (1, 0, 500);

-- Webhook dedup (Stripe can retry)
CREATE TABLE webhook_events (
  id          TEXT PRIMARY KEY,            -- stripe event.id
  received_at INTEGER NOT NULL
);
```

### Paywall middleware

```js
// server/src/middleware/entitlement.js
function requireTier(minTier = 'pro') {
  return (req, res, next) => {
    const user = req.user; // from JWT
    if (!user) return res.status(401).json({ code: 'AUTH_REQUIRED' });

    const tier = user.subscription_tier;
    const validUntil = user.sub_valid_until;
    const isPro = tier.startsWith('pro_') &&
                  (tier === 'pro_lifetime' || validUntil > Date.now());

    if (!isPro) return res.status(403).json({ code: 'PAYWALL', upgradeUrl: '/pricing' });
    next();
  };
}
```

Usage:

```js
router.get('/api/flights/:id/enriched', requireTier('pro'), getEnrichedCard);
router.post('/api/trips', requireTier('pro'), createTrip);
```

### Webhook events to handle

| Event                              | Action                                                          |
|------------------------------------|-----------------------------------------------------------------|
| `checkout.session.completed`       | Create sub row, set tier, bump lifetime counter if applicable   |
| `customer.subscription.updated`    | Update period_end, status                                       |
| `customer.subscription.deleted`    | tier → 'free', valid_until = now                                |
| `invoice.payment_failed`           | status → 'past_due', 3-day grace                                |
| `charge.refunded`                  | If lifetime: decrement counter, free the slot                   |
| `checkout.session.expired`         | If lifetime session: decrement counter, release reserved slot   |

Ignored: `invoice.*` (except failed), `customer.created/updated`, `payment_intent.*`, `trial_will_end` (Stripe handles notification).

### Critical details

- **Lifetime race condition:** atomic `UPDATE lifetime_counter SET taken=taken+1 WHERE taken<cap`. If `changes()===0` → return 409 and hide Lifetime option in UI. Counter is bumped **before** creating the Stripe session (to prevent overselling under concurrent checkout).
- **Abandoned lifetime checkouts:** if the user closes the browser and the Stripe session expires, `checkout.session.expired` releases the reserved slot. Stripe sessions default to 24h TTL — this is the max slot-reservation leak window.
- **Webhook idempotency:** insert into `webhook_events` with `event.id` as PK; on conflict, no-op. Handles Stripe retries.
- **Stripe billing portal:** reuse `stripe.billingPortal.sessions.create()` for cancel / update card / receipts — no custom code.
- **Trials require card** (standard practice; conversion drops ~3× without card collection).

## Data ingestion (Track 2)

Starts week 1, parallel to infra. By launch we want 6–8 weeks of delay history on top-30 routes, plus ready reference tables for γ.

| Data               | Source                              | Frequency                               | Storage                 | Uses                          |
|--------------------|-------------------------------------|-----------------------------------------|-------------------------|-------------------------------|
| Delay history      | AeroDataBox scheduled + actual      | Hybrid: eager cron (top-30/6h) + lazy on-search (if <10 obs) | `flight_observations`   | α predict, γ on-time %        |
| Aircraft fleet     | Mictronics aircraftDB + OpenSky     | Bootstrap once, refresh monthly          | `aircraft_fleet`        | γ age, registration, history  |
| Livery photos      | Wikimedia Commons API               | Lazy, per airline+type                   | `airline_liveries`      | γ photo                       |
| Weather            | OpenWeather free (1K req/day)       | Lazy per airport + 30-min memo           | In-memory cache         | γ weather                     |
| Amenities          | Manual seed ~200 airlines           | One-shot git-tracked JSON                | `airline_amenities`     | γ wifi/power/meal             |
| CO₂ per pax        | ICAO formula (type × GCD)           | Compute on-the-fly                       | —                       | γ carbon footprint            |

### `flight_observations` schema

```sql
CREATE TABLE flight_observations (
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
  delay_minutes  INTEGER,      -- actual_arr - scheduled_arr
  status         TEXT,         -- 'completed' | 'canceled' | 'diverted'
  observed_at    INTEGER NOT NULL,
  UNIQUE(airline_iata, flight_number, scheduled_dep)
);
CREATE INDEX idx_obs_route  ON flight_observations(dep_iata, arr_iata, observed_at);
CREATE INDEX idx_obs_flight ON flight_observations(airline_iata, flight_number, scheduled_dep);
```

### Rule-based delay prediction

Three-tier fallback, no ML in v1:

```js
function predictDelay({ airline, flightNumber, dep, arr }) {
  // tier 1: same flight, last 90 days
  let rows = q(`SELECT delay_minutes FROM flight_observations
                WHERE airline_iata=? AND flight_number=? AND observed_at > ?
                  AND status='completed' AND delay_minutes IS NOT NULL`,
               [airline, flightNumber, now() - 90*864e5]);
  let scope = 'exact-flight';

  if (rows.length < 10) {  // tier 2: same route + airline
    rows = q(`... AND dep_iata=? AND arr_iata=? AND airline_iata=? ...`);
    scope = 'route-airline';
  }
  if (rows.length < 10) return { confidence: 'low', message: 'collecting data' };

  const median   = percentile(rows.map(r => r.delay_minutes), 50);
  const p75      = percentile(rows.map(r => r.delay_minutes), 75);
  const onTimePct = rows.filter(r => r.delay_minutes < 15).length / rows.length;
  const confidence = rows.length >= 30 ? 'high' : 'medium';

  return { median, p75, onTimePct, confidence, sample: rows.length, scope };
}
```

### Ingestion principles

- **Hybrid strategy:** eager cron for top-30 routes (from existing `observed_routes`); lazy on-search for everything else. Respects AeroDataBox Basic 500 req/day (150 eager + 350 lazy budget).
- **Honest UI:** if sample < 10, show "Collecting data — predictions available soon" instead of hiding the field. This is value, not a defect.
- **Workers opt-in via ENV:** `INGEST_ENABLED=1` matches existing pattern (`ADSBLOL_ENABLED`). Tests don't start workers; single PM2 instance stays safe.
- **Amenities seed:** `server/data/airline-amenities.json`, git-tracked, loaded by migration into SQLite on boot. ~200 airlines, contributor-friendly.
- **Wikimedia liveries:** search `"Aircraft of <airline>"` + aircraft type filter. If no match → fallback to generic aircraft-type photo. Never show "no photo".

## Enrichment endpoints

```
GET  /api/flights/:id/enriched     γ data (photo, on-time, CO₂, amenities, weather)
POST /api/trips                    save trip
GET  /api/trips                    list user's trips
GET  /api/trips/:id/status         live (gate, delay, inbound)
DELETE /api/trips/:id
POST /api/push/subscribe           web-push endpoint

POST /api/subscriptions/checkout
POST /api/subscriptions/webhook    Stripe-signed
GET  /api/subscriptions/portal     returns Stripe portal URL
```

**Lazy enrichment:** `/:id/enriched` is called only on card hover/expand, not for every card in a search list. Saves AeroDataBox/OpenWeather quota.

**Single UpgradeModal component:** `<UpgradeModal reason="..." />` — context propagated ("Unlock on-time stats" vs "Track this flight"). All paywall triggers funnel here.

## Affiliate removal (targeted, not wholesale)

### Delete

- [client/src/components/FlightCard.jsx](client/src/components/FlightCard.jsx) lines 150–172 — "Find this route on Aviasales" button + `emitAffiliateClick`
- [client/src/components/BookingModal.jsx](client/src/components/BookingModal.jsx) — entire file
- [client/src/utils/booking.js](client/src/utils/booking.js) — `buildBookingUrl`, `emitAffiliateClick`
- All "Book" / "Find on Aviasales" links from UI
- SEO meta description mentions of "book flights"

### Keep

- [server/src/services/travelpayoutsService.js](server/src/services/travelpayoutsService.js) — data source for `/api/flights/explore` + `cheap-calendar`
- `GET /api/flights/cheap-calendar` — used by `ValidityCalendar`
- TP credentials in `.env`
- CSP entries `emrldtp.cc` / `www.travelpayouts.com` if fetches still occur

## Migration & rollout

**Context:** himaxym.com has no active users as of 2026-04-22 (confirmed by user). Breaking changes are safe; grandfather policy and beta-whitelist are unnecessary. Once the first paying user signs up (~W7, pricing live), the standard "careful with breaking changes" posture returns.

### 8-week timeline (two tracks, batched deploys)

| Week  | Track 1 — Infra                                                                           | Track 2 — Data                                                                   | User-visible                                                   |
|-------|-------------------------------------------------------------------------------------------|----------------------------------------------------------------------------------|----------------------------------------------------------------|
| W1    | DB migrations (subs, obs, fleet, trips, liveries, push_tokens, amenities). Stripe account + test keys. | `INGEST_ENABLED=1`, `delayIngestionWorker` starts. AeroDataBox scheduled-sampling top-30 routes. | Infra only — UI unchanged                                      |
| W2    | `/api/subscriptions` checkout + webhook + portal. Entitlement middleware. Atomic lifetime counter. | Amenities seed JSON (~200 airlines, manual). `fleetBootstrap` from Mictronics + OpenSky. | Routes live, UI still on old card                              |
| W3-4  | γ enrichment service. `/api/flights/:id/enriched`. FlightCard new layout (teasers + paywall). | Wikimedia liveries lazy fetch. OpenWeather integration. CO₂ calculator module.   | New card shipped (`ENRICHED_CARD=1` default)                   |
| W5-6  | α `/api/trips` CRUD, `/api/trips/:id/status`. My Trips page. Web-push subscription + worker. | `delay_prediction` service. On-time aggregate query tuning. Inbound lookup via adsb.lol. | My Trips available to all logged-in users (Pro for create)     |
| W7    | Pricing page. Upgrade modal. Stripe live keys. ToS + Privacy Policy updates. Legal review of Lifetime terms. | 7 weeks of delay data accumulated. Confidence tuning.                            | Pricing live — first trial users                               |
| W8    | Marketing push. Affiliate CTA already gone (W3-4). SEO + social announce.                 | Data pipeline runs unchanged.                                                    | Public launch communications                                   |

### Zero-downtime DB migration pattern

Idempotent ALTER + CREATE TABLE IF NOT EXISTS, matching the existing `email_verified` pattern:

```js
// server/src/models/db.js
try { db.exec('ALTER TABLE users ADD COLUMN subscription_tier TEXT NOT NULL DEFAULT "free"'); } catch {}
try { db.exec('ALTER TABLE users ADD COLUMN sub_valid_until INTEGER'); } catch {}
try { db.exec('ALTER TABLE users ADD COLUMN stripe_customer_id TEXT'); } catch {}
try { db.exec('CREATE UNIQUE INDEX idx_users_stripe_cust ON users(stripe_customer_id) WHERE stripe_customer_id IS NOT NULL'); } catch {}
db.exec(`CREATE TABLE IF NOT EXISTS subscriptions (...)`);
db.exec(`CREATE TABLE IF NOT EXISTS flight_observations (...)`);
// ... etc
```

### Kill-switches (ENV)

Used as dev-tools to quickly disable a broken feature in production without revert. **Default = ON.** Not for gradual rollout (no user cohorts to gate).

| ENV                 | Effect when OFF                                                 |
|---------------------|-----------------------------------------------------------------|
| `ENRICHED_CARD=0`   | All users see the old card. Teasers disappear, paywall hidden.  |
| `INGEST_ENABLED=0`  | Worker stops. Persisted data retained.                          |
| `STRIPE_LIVE=0`     | Checkout returns 503 with banner "Subscriptions temporarily unavailable". |
| `TRIPS_ENABLED=0`   | My Trips page hides; existing trip data retained.               |

### Rollout rules

- **Batch deploys:** accumulate 3–5 features in a single feature branch. Merge to main → one GitHub Actions run → one PM2 restart. Deploy when the batch is ready OR when the user explicitly asks — not more often.
- **No grandfather / no beta whitelist** while there are zero active users. Flip back to "careful" mode after the first paying user.
- **Deploy only via GitHub Actions** (push to main → workflow → build → pm2 restart). No SSH.
- **Sentry alerts tagged by route** (`subscriptions`, `trips`, `enriched`) for fast isolation of regressions.
- **Stripe charges cannot be rolled back in code.** Refund via Stripe Dashboard; webhook handles `charge.refunded`.

### Legal requirements (W7 hard gate)

- **ToS update:** subscription terms, Lifetime clause ("access for the lifetime of the service"), refund policy (7-day trial + 14-day EU consumer right), cancellation process
- **Privacy Policy:** disclose Stripe data sharing, note `flight_observations` is aggregate anonymous data, document web-push endpoint storage
- **EU VAT:** Stripe Tax enabled — automatic country-based collection, minimal effort
- **Receipts:** Stripe automatic — no custom invoice code in v1
- **Cookie banner:** only if analytics for the pricing-funnel is added; otherwise skipped

## Testing strategy

Minimum tests, placed strictly where failures cost money or privacy. Everything else → smoke + manual.

### Coverage tiers

**MUST (hard gate in CI):**
- Stripe webhook signature verification + idempotency via `event.id`
- Lifetime counter race condition (501st purchase → 409)
- Paywall middleware — free → 403, pro → 200, expired → 403, lifetime → always 200
- Migration idempotency (boot twice, no error)
- Trip ownership (user A cannot GET/DELETE user B's trip)
- `/enriched` response shape (contract for the card)
- Entitlement flags from `/auth/me`

Tools: server uses **Jest + supertest**, client uses **Vitest + @testing-library/react** (both already installed per each `package.json`).

**SHOULD (simple unit, local):**
- `predictDelay` 3-tier fallback
- `co2(type, km)` pure function
- ~10 tests, written in under an hour

**SMOKE (manual, not in CI):**
- Golden-path Playwright before each batch deploy: signup → verify → subscribe (Stripe test card) → sees enriched card
- My Trips add flow → status updates visible
- Cancel subscription → paywall returns on next day

**SKIP deliberately:**
- Mocks for AeroDataBox / adsb.lol / OpenWeather — their shape changes, mocks lie. Use contract tests instead: given a fixture JSON input, assert our transformer outputs the expected shape.
- Snapshot tests (churn)
- UI unit tests for components without logic
- Load tests (SQLite + <1K paying users — unnecessary)
- Live Stripe webhooks in CI — Stripe CLI is for local; in CI, mock `stripe.webhooks.constructEvent` + fixture payload

### Test files

```
server/src/__tests__/
  subscriptions.webhook.test.js   signature, idempotency, checkout.session.completed
  subscriptions.lifetime.test.js  atomic counter, 501st → 409
  entitlement.middleware.test.js  403 free / 200 pro / 200 lifetime / grace past_due
  delayPrediction.test.js         3 tiers, confidence levels
  trips.ownership.test.js         user A cannot access user B's trip
  db.migrations.test.js           rerun migrations twice — no error
  enrichedCard.shape.test.js      response matches card contract

client/src/__tests__/
  UpgradeModal.test.jsx           renders with reason prop (one sanity test)
```

### Batch pre-deploy checklist

1. `npm test -w server` — run MUST + SHOULD locally (seconds)
2. `npm run build -w client` — confirm build succeeds
3. Manual Playwright golden path: signup → subscribe (test card) → enriched card visible
4. Confirm all new ENV flags in prod `.env` (defaults already configured)
5. Push → GitHub Actions deploy → 5-min smoke on himaxym.com: home loads, `/pricing` loads, `/api/auth/me` → 200

### Post-deploy feedback loop (no active users → no cohort rollout)

```
Deploy batch (code in main, flags ON by default)
  ↓
Manual smoke on himaxym.com 5–10 minutes — key flows
  ↓
Sentry monitor for 24h — if error spike, flip flag OFF, fix, next batch
  ↓
Clean → proceed to next batch
```

**When the first paying user signs up (post-W7), this loop gains a cohort step:** flip new features for a beta whitelist (`BETA_USERS` env, email-gated) before flipping globally. That gate is designed but dormant until real users exist.

## Key decisions log

| # | Decision                                                                          | Why                                                                                         |
|---|-----------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------|
| 1 | Paid tier = α Traveler Shield + γ Insider Card (no β influencer/social features)  | α = retention driver (returns to check trips); γ = max willingness-to-pay at high-intent moment |
| 2 | Web-only payment in v1, no IAP                                                    | Avoid Apple 3.1.1 30% cut for MVP; Capacitor app stays free, web login for payment           |
| 3 | Launch Lever pricing ($4.99/mo, $39/yr, $99 lifetime cap 500)                     | Scarcity without permanent revenue drag                                                       |
| 4 | Keep current free tier intact + remove affiliate completely                       | No regression for existing product behaviour; affiliate doesn't match product intent          |
| 5 | Zero-burn data strategy (AeroDataBox Basic + free sources + own ingestion)        | No runway for paid data vendors; 6–8 weeks of own data by launch suffices                    |
| 6 | Pluggable data-source interface from day 1                                        | User wants freedom to add more sources later without rewiring enrichment                     |
| 7 | Dual-Track build (infra + data ingestion in parallel, not linear)                 | Ingestion needs calendar time to accumulate useful history; cannot wait for infra completion  |
| 8 | Rule-based delay prediction, no ML                                                | Sufficient signal from 6–8 weeks of data; ML is v2 once volume warrants                      |
| 9 | SQLite through v1                                                                 | Fine to ~10K paying users; Postgres migration only when real load demands                    |
| 10| Kill-switches as dev-tools, not rollout mechanism                                 | No active users → no cohorts to gate. Default ON. Flip OFF only to rescue broken feature      |
| 11| Batch deploys (3–5 features per branch)                                           | Save tokens on per-feature CI; deploy cadence governed by readiness, not PR count            |

## Open questions / v2 candidates

- **Native IAP integration** — deferred until subscription model is validated web-side
- **ML delay prediction** — v2 once `flight_observations` has >6 months of data
- **Flexible entitlements table** — if we ever sell per-feature add-ons instead of pure Pro
- **Postgres** — only if SQLite contention becomes real (unlikely <10K paying users)
- **APNs / FCM** — when native app launches
- **Seat maps, crowdsourced reviews, loyalty integrations** — post-launch roadmap, not v1

## Critical files (existing, will be touched)

- [server/src/models/db.js](server/src/models/db.js) — add new migrations following existing try/catch idempotent ALTER pattern
- [server/src/routes/](server/src/routes/) — register `/api/subscriptions`, `/api/trips`, extend `/api/flights`
- [server/src/middleware/](server/src/middleware/) — add `entitlement.js`
- [server/src/services/travelpayoutsService.js](server/src/services/travelpayoutsService.js) — keep for `explore` + `cheap-calendar`, no changes
- [client/src/components/FlightCard.jsx](client/src/components/FlightCard.jsx) — remove affiliate button (L150-172), replace body with enriched-with-teasers layout
- [client/src/components/BookingModal.jsx](client/src/components/BookingModal.jsx) — delete
- [client/src/utils/booking.js](client/src/utils/booking.js) — delete
- [.github/workflows/deploy.yml](.github/workflows/deploy.yml) — extend with Stripe secrets

## Out of scope for this spec

- RouteMap, ByAircraft, ValidityCalendar features themselves (separate specs already approved)
- Capacitor mobile UX beyond "free tier works, login via web"
- Customer support / refund process beyond Stripe dashboard workflow
- Analytics/funnel instrumentation — add only if cookie banner is worth the friction
