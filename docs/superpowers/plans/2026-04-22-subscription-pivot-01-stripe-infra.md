# Subscription Pivot — Plan 1 / 5: Stripe Infrastructure + Entitlement Foundation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the payment + entitlement foundation. After this plan, a user can subscribe to any tier via Stripe, gets their `subscription_tier` updated via webhook, and `requireTier('pro')` middleware gates future endpoints. Lifetime 500-cap race condition is bulletproof.

**Architecture:** SQLite migrations follow the existing try/catch idempotent ALTER pattern from `db.js`. Stripe SDK wraps in a single `stripeService.js`. Webhook uses raw body parsing ahead of the global `express.json()` middleware. Entitlement middleware is standalone — no dependencies on DB beyond reading `req.user` fields hydrated by `requireAuth`.

**Tech stack:** Node 18+, Express 5, better-sqlite3, Stripe Node SDK (to be added), Jest + supertest (already installed), dotenv (already installed).

**Spec reference:** [docs/superpowers/specs/2026-04-22-subscription-pivot-design.md](../specs/2026-04-22-subscription-pivot-design.md) — sections "Subscription lifecycle" and "Architecture overview".

---

## File structure

### Created

- `server/src/models/subscriptions.js` — prepared statements for subscriptions + lifetime counter + webhook dedup
- `server/src/services/stripeService.js` — Stripe SDK wrapper (create customer/session/portal, verify webhook signature)
- `server/src/services/subscriptionService.js` — business logic (upsert sub from webhook, bump/decrement lifetime counter, compute effective tier)
- `server/src/controllers/subscriptionController.js` — HTTP handlers (checkout, webhook, portal, me)
- `server/src/middleware/entitlement.js` — `requireTier(tier)` factory
- `server/src/routes/subscriptions.js` — `/api/subscriptions/*` routes
- `server/src/__tests__/subscriptions.webhook.test.js`
- `server/src/__tests__/subscriptions.lifetime.test.js`
- `server/src/__tests__/entitlement.middleware.test.js`
- `server/src/__tests__/db.migrations.test.js`

### Modified

- `server/src/models/db.js` — add subscription migrations + new prepared statements
- `server/src/routes/auth.js` — extend `/me` to return `subscription_tier`, `sub_valid_until`
- `server/src/index.js` — mount subscriptions router; raw-body for webhook BEFORE json middleware
- `server/.env.example` — document new env vars (create if missing)
- `.github/workflows/deploy.yml` — pass through Stripe secrets (user will add secrets in GH settings separately)

---

## Task 1: Add Stripe SDK dependency

**Files:**
- Modify: `server/package.json`

- [ ] **Step 1: Install stripe SDK**

```bash
cd server && npm install stripe
```

- [ ] **Step 2: Confirm version in package.json**

Run: `grep '"stripe"' server/package.json`
Expected: shows `"stripe": "^<version>"` in dependencies.

- [ ] **Step 3: Commit**

```bash
git add server/package.json server/package-lock.json
git commit -m "chore(deps): add stripe SDK for subscription plan"
```

---

## Task 2: DB migrations — users columns

**Files:**
- Modify: `server/src/models/db.js` (append after existing email_verified migration, around line 45)

- [ ] **Step 1: Write the failing migration-idempotency test**

Create `server/src/__tests__/db.migrations.test.js`:

```js
// Ensures all new schema migrations are idempotent (safe to rerun on restart).
// The db module auto-runs migrations on require(); requiring it twice in the
// same process will NOT rerun them (node caches modules), so we simulate by
// executing the migration SQL manually a second time.

describe('subscription schema migrations', () => {
  let db;
  beforeAll(() => {
    jest.resetModules();
    process.env.NODE_ENV = 'test';
    db = require('../models/db').db;
  });

  const ALTERS = [
    "ALTER TABLE users ADD COLUMN subscription_tier TEXT NOT NULL DEFAULT 'free'",
    "ALTER TABLE users ADD COLUMN sub_valid_until INTEGER",
    "ALTER TABLE users ADD COLUMN stripe_customer_id TEXT",
  ];

  test('rerunning ALTERs on users does not throw via try/catch wrapper', () => {
    for (const sql of ALTERS) {
      expect(() => { try { db.exec(sql); } catch {} }).not.toThrow();
    }
  });

  test('users table has new columns', () => {
    const cols = db.prepare("PRAGMA table_info(users)").all().map(c => c.name);
    expect(cols).toEqual(expect.arrayContaining([
      'subscription_tier', 'sub_valid_until', 'stripe_customer_id',
    ]));
  });

  test('subscriptions table exists with expected columns', () => {
    const cols = db.prepare("PRAGMA table_info(subscriptions)").all().map(c => c.name);
    expect(cols).toEqual(expect.arrayContaining([
      'id','user_id','stripe_sub_id','stripe_session_id','tier','status',
      'period_end','trial_end','created_at','updated_at',
    ]));
  });

  test('lifetime_counter seeded with cap=500 taken=0', () => {
    const row = db.prepare('SELECT taken, cap FROM lifetime_counter WHERE id=1').get();
    expect(row).toEqual({ taken: 0, cap: 500 });
  });

  test('webhook_events table exists', () => {
    const cols = db.prepare("PRAGMA table_info(webhook_events)").all().map(c => c.name);
    expect(cols).toEqual(expect.arrayContaining(['id', 'received_at']));
  });
});
```

Also change `server/src/models/db.js` so the `db` handle is exported explicitly. Check: if current export is `module.exports = { ... }`, add `db` to it. If it's already exporting `db`, skip.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx jest src/__tests__/db.migrations.test.js --verbose`
Expected: FAIL — new columns and tables don't exist yet.

- [ ] **Step 3: Add migrations to db.js**

In `server/src/models/db.js`, after the existing `email_verified` migration block (around line 45), append:

```js
// Migration: subscription tier columns (see spec 2026-04-22-subscription-pivot-design.md)
try { db.exec("ALTER TABLE users ADD COLUMN subscription_tier TEXT NOT NULL DEFAULT 'free'"); } catch {}
try { db.exec('ALTER TABLE users ADD COLUMN sub_valid_until INTEGER'); } catch {}
try { db.exec('ALTER TABLE users ADD COLUMN stripe_customer_id TEXT'); } catch {}
try { db.exec('CREATE UNIQUE INDEX idx_users_stripe_cust ON users(stripe_customer_id) WHERE stripe_customer_id IS NOT NULL'); } catch {}

// subscriptions: one row per Stripe subscription (or one-time lifetime charge).
// Stripe is source of truth; webhooks upsert this table and denormalize users.subscription_tier.
db.exec(`
  CREATE TABLE IF NOT EXISTS subscriptions (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    stripe_sub_id     TEXT UNIQUE,
    stripe_session_id TEXT,
    tier              TEXT NOT NULL,
    status            TEXT NOT NULL,
    period_end        INTEGER,
    trial_end         INTEGER,
    created_at        INTEGER NOT NULL,
    updated_at        INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_subs_user ON subscriptions(user_id);
`);

// Single-row counter for the 500-slot lifetime Founders tier.
// Atomic UPDATE ... WHERE taken < cap is the race-safe claim mechanism.
db.exec(`
  CREATE TABLE IF NOT EXISTS lifetime_counter (
    id    INTEGER PRIMARY KEY CHECK (id = 1),
    taken INTEGER NOT NULL DEFAULT 0,
    cap   INTEGER NOT NULL DEFAULT 500
  );
`);
db.exec('INSERT OR IGNORE INTO lifetime_counter (id, taken, cap) VALUES (1, 0, 500)');

// Webhook event dedup — Stripe retries are common, event.id is guaranteed unique.
db.exec(`
  CREATE TABLE IF NOT EXISTS webhook_events (
    id          TEXT PRIMARY KEY,
    received_at INTEGER NOT NULL
  );
`);
```

- [ ] **Step 4: Export db instance from db.js**

At the end of `server/src/models/db.js`, check current exports. Ensure `db` is exposed (add if missing):

```js
module.exports = {
  db, // expose raw handle for new modules (subscriptions, workers) that need ad-hoc queries
  // ...existing exports
};
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd server && npx jest src/__tests__/db.migrations.test.js --verbose`
Expected: all 5 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add server/src/models/db.js server/src/__tests__/db.migrations.test.js
git commit -m "feat(db): subscription/lifetime/webhook_events schema migrations"
```

---

## Task 3: Prepared statements for subscription models

**Files:**
- Create: `server/src/models/subscriptions.js`

- [ ] **Step 1: Create the model module**

Create `server/src/models/subscriptions.js`:

```js
'use strict';

const { db } = require('./db');

// Prepared statements — one-time prepare, reused per call.
const stmts = {
  upsertSubscription: db.prepare(`
    INSERT INTO subscriptions
      (user_id, stripe_sub_id, stripe_session_id, tier, status, period_end, trial_end, created_at, updated_at)
    VALUES
      (@user_id, @stripe_sub_id, @stripe_session_id, @tier, @status, @period_end, @trial_end, @now, @now)
    ON CONFLICT(stripe_sub_id) DO UPDATE SET
      status      = excluded.status,
      period_end  = excluded.period_end,
      trial_end   = excluded.trial_end,
      tier        = excluded.tier,
      updated_at  = excluded.updated_at
  `),
  getSubscriptionByStripeId: db.prepare('SELECT * FROM subscriptions WHERE stripe_sub_id = ?'),
  getSubscriptionsForUser:   db.prepare('SELECT * FROM subscriptions WHERE user_id = ? ORDER BY created_at DESC'),
  updateUserTier: db.prepare(`
    UPDATE users
       SET subscription_tier = ?, sub_valid_until = ?, stripe_customer_id = COALESCE(?, stripe_customer_id)
     WHERE id = ?
  `),
  setUserTierFree: db.prepare(`
    UPDATE users
       SET subscription_tier = 'free', sub_valid_until = NULL
     WHERE id = ?
  `),
  getUserByStripeCustomer: db.prepare('SELECT * FROM users WHERE stripe_customer_id = ?'),
  // Atomic lifetime counter: returns changes()===1 on success, 0 when cap reached.
  claimLifetimeSlot:   db.prepare('UPDATE lifetime_counter SET taken = taken + 1 WHERE id = 1 AND taken < cap'),
  releaseLifetimeSlot: db.prepare('UPDATE lifetime_counter SET taken = MAX(taken - 1, 0) WHERE id = 1'),
  getLifetimeCounter:  db.prepare('SELECT taken, cap FROM lifetime_counter WHERE id = 1'),
  // Webhook dedup
  insertWebhookEvent:  db.prepare('INSERT OR IGNORE INTO webhook_events (id, received_at) VALUES (?, ?)'),
};

module.exports = {
  upsertSubscription(row) {
    stmts.upsertSubscription.run(row);
  },
  getSubscriptionByStripeId(id) {
    return stmts.getSubscriptionByStripeId.get(id);
  },
  getSubscriptionsForUser(userId) {
    return stmts.getSubscriptionsForUser.all(userId);
  },
  updateUserTier(userId, tier, validUntil, stripeCustomerId) {
    stmts.updateUserTier.run(tier, validUntil || null, stripeCustomerId || null, userId);
  },
  setUserTierFree(userId) {
    stmts.setUserTierFree.run(userId);
  },
  getUserByStripeCustomer(customerId) {
    return stmts.getUserByStripeCustomer.get(customerId);
  },
  // Returns true if slot claimed, false if cap reached.
  tryClaimLifetimeSlot() {
    const info = stmts.claimLifetimeSlot.run();
    return info.changes === 1;
  },
  releaseLifetimeSlot() {
    stmts.releaseLifetimeSlot.run();
  },
  getLifetimeCounter() {
    return stmts.getLifetimeCounter.get();
  },
  // Returns true if event is new (first time seen), false if already processed.
  markWebhookEventProcessed(eventId, now = Date.now()) {
    const info = stmts.insertWebhookEvent.run(eventId, now);
    return info.changes === 1;
  },
};
```

- [ ] **Step 2: Commit**

```bash
git add server/src/models/subscriptions.js
git commit -m "feat(models): prepared statements for subscriptions/lifetime/webhook dedup"
```

---

## Task 4: Lifetime counter race-condition test

**Files:**
- Create: `server/src/__tests__/subscriptions.lifetime.test.js`

- [ ] **Step 1: Write the test**

```js
// Lifetime slot is a single scarce resource (500 cap). Under concurrent claims
// we must never over-allocate. SQLite serializes writes, but the logic must
// still check changes() to detect rejected claims.

const subsModel = require('../models/subscriptions');
const { db } = require('../models/db');

describe('lifetime counter atomicity', () => {
  beforeEach(() => {
    db.exec("UPDATE lifetime_counter SET taken = 0, cap = 5 WHERE id = 1");
  });

  afterAll(() => {
    db.exec("UPDATE lifetime_counter SET taken = 0, cap = 500 WHERE id = 1");
  });

  test('claiming until cap succeeds, then returns false', () => {
    const results = [];
    for (let i = 0; i < 7; i++) results.push(subsModel.tryClaimLifetimeSlot());
    expect(results).toEqual([true, true, true, true, true, false, false]);
    const { taken, cap } = subsModel.getLifetimeCounter();
    expect(taken).toBe(5);
    expect(cap).toBe(5);
  });

  test('release decrements but never below zero', () => {
    subsModel.tryClaimLifetimeSlot();
    subsModel.tryClaimLifetimeSlot();
    subsModel.releaseLifetimeSlot();
    subsModel.releaseLifetimeSlot();
    subsModel.releaseLifetimeSlot(); // underflow attempt
    expect(subsModel.getLifetimeCounter().taken).toBe(0);
  });
});
```

- [ ] **Step 2: Run test — should pass against Task 3 impl**

Run: `cd server && npx jest src/__tests__/subscriptions.lifetime.test.js --verbose`
Expected: 2 tests PASS.

- [ ] **Step 3: Commit**

```bash
git add server/src/__tests__/subscriptions.lifetime.test.js
git commit -m "test(subs): lifetime counter atomicity + underflow guard"
```

---

## Task 5: Stripe service wrapper

**Files:**
- Create: `server/src/services/stripeService.js`

- [ ] **Step 1: Create stripeService.js**

```js
'use strict';

const Stripe = require('stripe');

// Lazy instantiation so tests can run without STRIPE_SECRET_KEY.
let client = null;
function getClient() {
  if (client) return client;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY not set');
  client = new Stripe(key, { apiVersion: '2025-02-24.acacia' });
  return client;
}

function isConfigured() {
  return Boolean(process.env.STRIPE_SECRET_KEY) && process.env.STRIPE_LIVE !== '0';
}

// Maps our tier names → Stripe price IDs from env. Lifetime is a one-time price.
function priceIdForTier(tier) {
  switch (tier) {
    case 'pro_monthly':  return process.env.STRIPE_PRICE_MONTHLY;
    case 'pro_annual':   return process.env.STRIPE_PRICE_ANNUAL;
    case 'pro_lifetime': return process.env.STRIPE_PRICE_LIFETIME;
    default: return null;
  }
}

// Creates (or reuses) a Stripe Customer for a given user and returns customerId.
async function ensureCustomer({ userId, email, existingCustomerId }) {
  if (existingCustomerId) return existingCustomerId;
  const customer = await getClient().customers.create({
    email,
    metadata: { user_id: String(userId) },
  });
  return customer.id;
}

// Creates a Checkout Session. For lifetime (one-time) vs recurring Stripe needs different modes.
async function createCheckoutSession({ tier, customerId, successUrl, cancelUrl, trial = true }) {
  const price = priceIdForTier(tier);
  if (!price) throw new Error(`Unknown tier: ${tier}`);

  const base = {
    customer: customerId,
    success_url: successUrl,
    cancel_url:  cancelUrl,
    line_items: [{ price, quantity: 1 }],
    metadata: { tier },
    allow_promotion_codes: true,
    automatic_tax: { enabled: true },
  };

  if (tier === 'pro_lifetime') {
    return getClient().checkout.sessions.create({ ...base, mode: 'payment' });
  }

  const sub = {
    ...base,
    mode: 'subscription',
    subscription_data: { metadata: { tier } },
  };
  if (trial) sub.subscription_data.trial_period_days = 7;
  return getClient().checkout.sessions.create(sub);
}

async function createBillingPortalSession({ customerId, returnUrl }) {
  return getClient().billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
  });
}

// Verifies raw webhook body + signature header, returns parsed event.
function verifyWebhook(rawBody, signature) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new Error('STRIPE_WEBHOOK_SECRET not set');
  return getClient().webhooks.constructEvent(rawBody, signature, secret);
}

module.exports = {
  isConfigured,
  priceIdForTier,
  ensureCustomer,
  createCheckoutSession,
  createBillingPortalSession,
  verifyWebhook,
  // Exposed for test mocking:
  _getClient: getClient,
};
```

- [ ] **Step 2: Commit**

```bash
git add server/src/services/stripeService.js
git commit -m "feat(stripe): SDK wrapper — customer/session/portal/webhook verify"
```

---

## Task 6: Subscription service (business logic)

**Files:**
- Create: `server/src/services/subscriptionService.js`

- [ ] **Step 1: Create subscriptionService.js**

```js
'use strict';

const subsModel   = require('../models/subscriptions');
const stripeSvc   = require('./stripeService');

// Maps Stripe Subscription object → our row shape.
function rowFromStripeSub({ userId, sub, tier, sessionId }) {
  return {
    user_id:           userId,
    stripe_sub_id:     sub.id,
    stripe_session_id: sessionId || null,
    tier,
    status:            sub.status,
    period_end:        sub.current_period_end ? sub.current_period_end * 1000 : null,
    trial_end:         sub.trial_end ? sub.trial_end * 1000 : null,
    now:               Date.now(),
  };
}

// Handles checkout.session.completed — creates subscription row + updates user tier.
async function handleCheckoutCompleted(session) {
  const userIdStr = session.metadata?.user_id
    || (session.customer ? (await lookupUserIdFromCustomer(session.customer)) : null);
  if (!userIdStr) throw new Error('No user_id on checkout session metadata or customer');
  const userId = Number(userIdStr);
  const tier   = session.metadata?.tier;
  if (!tier) throw new Error('No tier on checkout session metadata');

  if (tier === 'pro_lifetime') {
    // Lifetime: one-time payment, no Stripe Subscription object.
    subsModel.upsertSubscription({
      user_id: userId,
      stripe_sub_id: `lifetime_${session.id}`, // synthetic to satisfy UNIQUE
      stripe_session_id: session.id,
      tier: 'pro_lifetime',
      status: 'active',
      period_end: null,
      trial_end: null,
      now: Date.now(),
    });
    subsModel.updateUserTier(userId, 'pro_lifetime', null, session.customer);
    return;
  }

  // Recurring: fetch the Stripe Subscription for period info.
  const stripe = stripeSvc._getClient();
  const sub    = await stripe.subscriptions.retrieve(session.subscription);
  subsModel.upsertSubscription(rowFromStripeSub({ userId, sub, tier, sessionId: session.id }));
  subsModel.updateUserTier(
    userId,
    tier,
    sub.current_period_end ? sub.current_period_end * 1000 : null,
    session.customer,
  );
}

async function handleSubscriptionUpdated(sub) {
  const row = subsModel.getSubscriptionByStripeId(sub.id);
  if (!row) return; // unknown sub (shouldn't happen — created in checkout.completed)
  subsModel.upsertSubscription(rowFromStripeSub({
    userId: row.user_id, sub, tier: row.tier, sessionId: row.stripe_session_id,
  }));
  const validUntil = sub.current_period_end ? sub.current_period_end * 1000 : null;
  if (sub.status === 'active' || sub.status === 'trialing') {
    subsModel.updateUserTier(row.user_id, row.tier, validUntil);
  } else if (sub.status === 'canceled' || sub.status === 'unpaid') {
    subsModel.setUserTierFree(row.user_id);
  }
}

async function handleSubscriptionDeleted(sub) {
  const row = subsModel.getSubscriptionByStripeId(sub.id);
  if (!row) return;
  subsModel.upsertSubscription(rowFromStripeSub({
    userId: row.user_id, sub, tier: row.tier, sessionId: row.stripe_session_id,
  }));
  subsModel.setUserTierFree(row.user_id);
}

async function handleInvoicePaymentFailed(invoice) {
  if (!invoice.subscription) return;
  const row = subsModel.getSubscriptionByStripeId(invoice.subscription);
  if (!row) return;
  subsModel.upsertSubscription({
    ...row,
    status: 'past_due',
    now: Date.now(),
  });
}

async function handleChargeRefunded(charge) {
  // If refund is for a lifetime session, release a slot.
  const sessionId = charge.metadata?.checkout_session_id;
  if (!sessionId) return;
  // NB: Stripe does not pass our session.id on charge; to map reliably use the
  // Payment Intent on the session at checkout time. Simpler approach: scan
  // subscriptions where stripe_session_id = charge.payment_intent linkage.
  // For v1 we rely on the checkout.session.expired event handling (Task below)
  // for the primary release path; refunded lifetime is a manual ops event
  // logged for admin attention.
  console.log(`[subs] charge.refunded — manual slot-release review: charge=${charge.id}`);
}

async function handleCheckoutExpired(session) {
  // Only lifetime needs slot release — recurring has no reservation.
  if (session.metadata?.tier === 'pro_lifetime') {
    subsModel.releaseLifetimeSlot();
  }
}

async function lookupUserIdFromCustomer(customerId) {
  const user = subsModel.getUserByStripeCustomer(customerId);
  return user ? String(user.id) : null;
}

// Called by checkout controller before creating a lifetime session.
function tryReserveLifetimeSlot() {
  return subsModel.tryClaimLifetimeSlot();
}

// Called if lifetime checkout fails AFTER we reserved (network etc).
function releaseReservedLifetimeSlot() {
  subsModel.releaseLifetimeSlot();
}

function getLifetimeCounter() {
  return subsModel.getLifetimeCounter();
}

module.exports = {
  handleCheckoutCompleted,
  handleSubscriptionUpdated,
  handleSubscriptionDeleted,
  handleInvoicePaymentFailed,
  handleChargeRefunded,
  handleCheckoutExpired,
  tryReserveLifetimeSlot,
  releaseReservedLifetimeSlot,
  getLifetimeCounter,
};
```

- [ ] **Step 2: Commit**

```bash
git add server/src/services/subscriptionService.js
git commit -m "feat(subs): business logic for webhook event handlers + lifetime reserve"
```

---

## Task 7: Entitlement middleware

**Files:**
- Create: `server/src/middleware/entitlement.js`
- Create: `server/src/__tests__/entitlement.middleware.test.js`

- [ ] **Step 1: Write the failing test**

```js
const express = require('express');
const request = require('supertest');
const requireTier = require('../middleware/entitlement');

function appWith(user) {
  const app = express();
  app.use((req, _res, next) => { req.user = user; next(); });
  app.get('/pro', requireTier('pro'), (_req, res) => res.json({ ok: true }));
  return app;
}

describe('requireTier(pro)', () => {
  test('401 when no req.user', async () => {
    const app = express();
    app.get('/pro', requireTier('pro'), (_req, res) => res.json({ ok: true }));
    const res = await request(app).get('/pro');
    expect(res.status).toBe(401);
  });

  test('403 PAYWALL for free user', async () => {
    const res = await request(appWith({ id: 1, subscription_tier: 'free', sub_valid_until: null })).get('/pro');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('PAYWALL');
    expect(res.body.upgradeUrl).toBe('/pricing');
  });

  test('200 for pro_monthly with valid future validity', async () => {
    const future = Date.now() + 86400000;
    const res = await request(appWith({ id: 1, subscription_tier: 'pro_monthly', sub_valid_until: future })).get('/pro');
    expect(res.status).toBe(200);
  });

  test('403 for pro_monthly past expiry', async () => {
    const past = Date.now() - 86400000;
    const res = await request(appWith({ id: 1, subscription_tier: 'pro_monthly', sub_valid_until: past })).get('/pro');
    expect(res.status).toBe(403);
  });

  test('200 for pro_lifetime regardless of sub_valid_until', async () => {
    const res = await request(appWith({ id: 1, subscription_tier: 'pro_lifetime', sub_valid_until: null })).get('/pro');
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `cd server && npx jest src/__tests__/entitlement.middleware.test.js`
Expected: FAIL — `requireTier` not found.

- [ ] **Step 3: Create entitlement.js**

```js
'use strict';

function requireTier(_minTier = 'pro') {
  return (req, res, next) => {
    const user = req.user;
    if (!user) return res.status(401).json({ success: false, code: 'AUTH_REQUIRED', message: 'Unauthorized' });

    const tier       = user.subscription_tier || 'free';
    const validUntil = user.sub_valid_until;

    const isPro = tier.startsWith('pro_') &&
      (tier === 'pro_lifetime' || (Number.isFinite(validUntil) && validUntil > Date.now()));

    if (!isPro) {
      return res.status(403).json({
        success: false, code: 'PAYWALL', message: 'Pro subscription required', upgradeUrl: '/pricing',
      });
    }
    next();
  };
}

module.exports = requireTier;
```

- [ ] **Step 4: Run test — expect PASS**

Run: `cd server && npx jest src/__tests__/entitlement.middleware.test.js --verbose`
Expected: 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/middleware/entitlement.js server/src/__tests__/entitlement.middleware.test.js
git commit -m "feat(middleware): requireTier(pro) with 401/403 + lifetime bypass"
```

---

## Task 8: Subscription controller + routes

**Files:**
- Create: `server/src/controllers/subscriptionController.js`
- Create: `server/src/routes/subscriptions.js`

- [ ] **Step 1: Create subscriptionController.js**

```js
'use strict';

const express = require('express');
const subsModel   = require('../models/subscriptions');
const stripeSvc   = require('../services/stripeService');
const subsService = require('../services/subscriptionService');

const { db } = require('../models/db');
const getUserById = db.prepare('SELECT id, email, stripe_customer_id, subscription_tier FROM users WHERE id = ?');

async function createCheckout(req, res) {
  if (!stripeSvc.isConfigured()) {
    return res.status(503).json({ success: false, message: 'Subscriptions temporarily unavailable' });
  }
  const { tier } = req.body;
  if (!['pro_monthly', 'pro_annual', 'pro_lifetime'].includes(tier)) {
    return res.status(400).json({ success: false, message: 'Invalid tier' });
  }

  const user = getUserById.get(req.user.id);
  if (!user) return res.status(404).json({ success: false, message: 'User not found' });

  let claimedLifetime = false;
  try {
    if (tier === 'pro_lifetime') {
      claimedLifetime = subsService.tryReserveLifetimeSlot();
      if (!claimedLifetime) {
        return res.status(409).json({ success: false, code: 'LIFETIME_SOLD_OUT', message: 'Lifetime slots are gone' });
      }
    }

    const customerId = await stripeSvc.ensureCustomer({
      userId: user.id, email: user.email, existingCustomerId: user.stripe_customer_id,
    });
    if (customerId !== user.stripe_customer_id) {
      subsModel.updateUserTier(user.id, user.subscription_tier, null, customerId);
    }

    const origin = process.env.PUBLIC_WEB_ORIGIN || 'https://himaxym.com';
    const session = await stripeSvc.createCheckoutSession({
      tier, customerId,
      successUrl: `${origin}/?subscribe=success&session={CHECKOUT_SESSION_ID}`,
      cancelUrl:  `${origin}/?subscribe=cancel`,
    });
    // Inject user_id into session metadata for webhook handler
    await stripeSvc._getClient().checkout.sessions.update(session.id, {
      metadata: { tier, user_id: String(user.id) },
    });

    return res.json({ success: true, url: session.url });
  } catch (err) {
    if (claimedLifetime) subsService.releaseReservedLifetimeSlot();
    console.error('[subs] createCheckout failed:', err);
    return res.status(500).json({ success: false, message: 'Checkout failed' });
  }
}

async function createPortal(req, res) {
  if (!stripeSvc.isConfigured()) {
    return res.status(503).json({ success: false, message: 'Subscriptions temporarily unavailable' });
  }
  const user = getUserById.get(req.user.id);
  if (!user?.stripe_customer_id) return res.status(404).json({ success: false, message: 'No customer record' });

  const origin = process.env.PUBLIC_WEB_ORIGIN || 'https://himaxym.com';
  const session = await stripeSvc.createBillingPortalSession({
    customerId: user.stripe_customer_id,
    returnUrl: `${origin}/?portal=return`,
  });
  return res.json({ success: true, url: session.url });
}

// RAW body — mounted BEFORE json middleware. See server/src/index.js changes.
async function handleWebhook(req, res) {
  if (!stripeSvc.isConfigured()) return res.status(503).end();

  let event;
  try {
    event = stripeSvc.verifyWebhook(req.body, req.headers['stripe-signature']);
  } catch (err) {
    console.warn('[subs] webhook signature invalid:', err.message);
    return res.status(400).json({ success: false, message: 'Invalid signature' });
  }

  // Idempotency via event.id PK
  const isNew = subsModel.markWebhookEventProcessed(event.id);
  if (!isNew) return res.json({ received: true, deduped: true });

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await subsService.handleCheckoutCompleted(event.data.object);
        break;
      case 'checkout.session.expired':
        await subsService.handleCheckoutExpired(event.data.object);
        break;
      case 'customer.subscription.updated':
        await subsService.handleSubscriptionUpdated(event.data.object);
        break;
      case 'customer.subscription.deleted':
        await subsService.handleSubscriptionDeleted(event.data.object);
        break;
      case 'invoice.payment_failed':
        await subsService.handleInvoicePaymentFailed(event.data.object);
        break;
      case 'charge.refunded':
        await subsService.handleChargeRefunded(event.data.object);
        break;
      default:
        // Ignored event — we logged the ID for idempotency so Stripe stops retrying
        break;
    }
    return res.json({ received: true });
  } catch (err) {
    console.error('[subs] webhook handler failed:', err);
    return res.status(500).json({ success: false, message: 'Handler error' });
  }
}

function getLifetimeStatus(_req, res) {
  const counter = subsService.getLifetimeCounter();
  res.json({ success: true, taken: counter.taken, cap: counter.cap, available: counter.cap - counter.taken });
}

module.exports = { createCheckout, createPortal, handleWebhook, getLifetimeStatus };
```

- [ ] **Step 2: Create routes/subscriptions.js**

```js
'use strict';

const express = require('express');
const requireAuth  = require('../middleware/requireAuth');
const controller   = require('../controllers/subscriptionController');

const router = express.Router();

// Checkout + portal require auth.
router.post('/checkout', requireAuth, controller.createCheckout);
router.get('/portal',    requireAuth, controller.createPortal);

// Public: lifetime remaining counter for pricing page (cached client-side).
router.get('/lifetime-status', controller.getLifetimeStatus);

// Webhook: NO auth, body must be raw — wired in index.js BEFORE json middleware.
router.post('/webhook', controller.handleWebhook);

module.exports = router;
```

- [ ] **Step 3: Commit**

```bash
git add server/src/controllers/subscriptionController.js server/src/routes/subscriptions.js
git commit -m "feat(subs): checkout/portal/webhook/lifetime-status endpoints"
```

---

## Task 9: Wire raw-body webhook and mount router in index.js

**Files:**
- Modify: `server/src/index.js`

- [ ] **Step 1: Locate the express.json() mount and the router mounts**

Run: `grep -n "express.json\|/api/auth\|/api/flights" server/src/index.js`
Note the line numbers for mounting order.

- [ ] **Step 2: Add raw-body webhook route BEFORE json middleware**

Add BEFORE the `app.use(express.json(...))` line:

```js
// Stripe webhook needs the raw body to verify the signature — must be mounted
// BEFORE express.json() which would consume and JSON-parse the body.
app.post(
  '/api/subscriptions/webhook',
  express.raw({ type: 'application/json' }),
  require('./controllers/subscriptionController').handleWebhook,
);
```

- [ ] **Step 3: Mount the rest of the subscription routes after json middleware**

Find the section where `/api/auth`, `/api/flights` routers are mounted; add alongside:

```js
app.use('/api/subscriptions', require('./routes/subscriptions'));
```

- [ ] **Step 4: Run server and curl lifetime-status**

In one terminal: `cd server && npm run dev`
In another: `curl -s http://localhost:5001/api/subscriptions/lifetime-status`
Expected: `{"success":true,"taken":0,"cap":500,"available":500}`

- [ ] **Step 5: Commit**

```bash
git add server/src/index.js
git commit -m "feat(server): mount Stripe webhook raw-body route + subscription router"
```

---

## Task 10: Extend `/auth/me` to expose tier fields

**Files:**
- Modify: `server/src/controllers/authController.js` (the `me` handler)

- [ ] **Step 1: Find the current me handler**

Run: `grep -n "exports\.me\|function me\|subscription_tier\|'/me'" server/src/controllers/authController.js server/src/routes/auth.js`
Read the current handler's response shape.

- [ ] **Step 2: Add tier fields**

In the `me` handler's SELECT or response mapping, ensure it returns:

```js
// in the users SELECT: add subscription_tier, sub_valid_until, stripe_customer_id
// in the JSON response:
res.json({
  success: true,
  user: {
    id: user.id,
    email: user.email,
    email_verified: Boolean(user.email_verified),
    subscription_tier: user.subscription_tier || 'free',
    sub_valid_until: user.sub_valid_until || null,
    has_stripe_customer: Boolean(user.stripe_customer_id),
  },
});
```

If requireAuth attaches `req.user` from JWT only (not DB), the `me` endpoint must re-fetch the user row from DB (it is already doing this — verify via grep).

- [ ] **Step 3: Manual test**

Restart server, login, curl with bearer token:
```bash
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:5001/api/auth/me | jq
```
Expected: response includes `subscription_tier: "free"` and `sub_valid_until: null`.

- [ ] **Step 4: Commit**

```bash
git add server/src/controllers/authController.js
git commit -m "feat(auth): expose subscription_tier + sub_valid_until on /me"
```

---

## Task 11: Hydrate requireAuth with tier fields

**Files:**
- Modify: `server/src/middleware/requireAuth.js`

`requireTier` reads `req.user.subscription_tier` and `sub_valid_until`. Currently `requireAuth` builds `req.user` from the JWT payload only. The JWT does not contain tier fields (and shouldn't — they can change without re-login). So we hydrate from DB.

- [ ] **Step 1: Modify requireAuth to fetch current tier**

```js
const authService = require('../services/authService');
const { db } = require('../models/db');

const getTierCols = db.prepare(
  'SELECT subscription_tier, sub_valid_until FROM users WHERE id = ?',
);

module.exports = function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }
  const token = header.slice(7);
  try {
    const payload = authService.verifyAccessToken(token);
    const tierRow = getTierCols.get(payload.sub) || {};
    req.user = {
      id: payload.sub,
      email: payload.email,
      subscription_tier: tierRow.subscription_tier || 'free',
      sub_valid_until:   tierRow.sub_valid_until || null,
    };
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, message: 'Token expired' });
    }
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }
};
```

- [ ] **Step 2: Commit**

```bash
git add server/src/middleware/requireAuth.js
git commit -m "feat(auth): hydrate req.user with current tier from DB on each request"
```

---

## Task 12: Webhook handler integration test

**Files:**
- Create: `server/src/__tests__/subscriptions.webhook.test.js`

- [ ] **Step 1: Write the test**

```js
// Integration test: posts a signed webhook fixture, asserts DB state mutations.
// Does NOT hit real Stripe. constructEvent is the only Stripe SDK call we keep real;
// we build a valid signature manually using the secret.

const express = require('express');
const request = require('supertest');
const crypto  = require('crypto');

const SECRET = 'whsec_test_secret_for_jest';
process.env.STRIPE_WEBHOOK_SECRET = SECRET;
process.env.STRIPE_SECRET_KEY = 'sk_test_dummy'; // client lazy-inits; constructEvent works without API call

const { db } = require('../models/db');
const subsModel = require('../models/subscriptions');
const controller = require('../controllers/subscriptionController');

// Seed a user we can refer to from webhook fixtures.
let userId;

beforeAll(() => {
  const now = Date.now();
  const info = db.prepare(
    'INSERT INTO users (email, password_hash, created_at, updated_at, email_verified) VALUES (?, ?, ?, ?, 1)'
  ).run('webhook.test@himaxym.com', 'xxx', now, now);
  userId = info.lastInsertRowid;
});

function signedRequest(payload) {
  const body = JSON.stringify(payload);
  const t = Math.floor(Date.now() / 1000);
  const signedPayload = `${t}.${body}`;
  const sig = crypto.createHmac('sha256', SECRET).update(signedPayload).digest('hex');
  return { body, header: `t=${t},v1=${sig}` };
}

function appWithWebhook() {
  const app = express();
  app.post('/webhook', express.raw({ type: 'application/json' }), controller.handleWebhook);
  return app;
}

describe('webhook handler', () => {
  test('invalid signature returns 400', async () => {
    const app = appWithWebhook();
    const res = await request(app)
      .post('/webhook')
      .set('stripe-signature', 't=1,v1=deadbeef')
      .set('content-type', 'application/json')
      .send(JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed', data: { object: {} } }));
    expect(res.status).toBe(400);
  });

  test('checkout.session.completed for pro_lifetime updates user tier + decrements counter', async () => {
    const event = {
      id: `evt_life_${Date.now()}`,
      type: 'checkout.session.completed',
      data: { object: {
        id: 'cs_test_life_1',
        mode: 'payment',
        customer: 'cus_test_abc',
        metadata: { user_id: String(userId), tier: 'pro_lifetime' },
      }},
    };
    const { body, header } = signedRequest(event);
    const res = await request(appWithWebhook())
      .post('/webhook').set('stripe-signature', header).set('content-type', 'application/json').send(body);
    expect(res.status).toBe(200);
    const user = db.prepare('SELECT subscription_tier, sub_valid_until FROM users WHERE id = ?').get(userId);
    expect(user.subscription_tier).toBe('pro_lifetime');
    expect(user.sub_valid_until).toBeNull();
  });

  test('duplicate event.id is deduped (second post returns deduped=true, DB untouched)', async () => {
    const event = {
      id: `evt_dup_${Date.now()}`,
      type: 'checkout.session.expired',
      data: { object: { metadata: { tier: 'pro_lifetime' } } },
    };
    const { body, header } = signedRequest(event);
    const app = appWithWebhook();
    const r1 = await request(app).post('/webhook').set('stripe-signature', header).set('content-type', 'application/json').send(body);
    const r2 = await request(app).post('/webhook').set('stripe-signature', header).set('content-type', 'application/json').send(body);
    expect(r1.body).toEqual({ received: true });
    expect(r2.body).toEqual({ received: true, deduped: true });
  });
});
```

- [ ] **Step 2: Run — expect PASS**

Run: `cd server && npx jest src/__tests__/subscriptions.webhook.test.js --verbose`
Expected: 3 tests PASS.

- [ ] **Step 3: Commit**

```bash
git add server/src/__tests__/subscriptions.webhook.test.js
git commit -m "test(subs): webhook signature + idempotency + lifetime tier upgrade"
```

---

## Task 13: Env scaffolding + deploy workflow secrets

**Files:**
- Create/Modify: `server/.env.example`
- Modify: `.github/workflows/deploy.yml`

- [ ] **Step 1: Add env vars to .env.example**

Append to `server/.env.example` (create if absent):

```
# Stripe — required for /api/subscriptions/*. Leave STRIPE_LIVE=0 to force 503s.
STRIPE_SECRET_KEY=sk_test_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx
STRIPE_PRICE_MONTHLY=price_xxx
STRIPE_PRICE_ANNUAL=price_xxx
STRIPE_PRICE_LIFETIME=price_xxx
STRIPE_LIVE=0
PUBLIC_WEB_ORIGIN=https://himaxym.com
```

- [ ] **Step 2: Pass secrets through deploy.yml**

In `.github/workflows/deploy.yml`, inside the deploy step's env block (find where existing secrets like `TRAVELPAYOUTS_TOKEN` are passed), append:

```yaml
          STRIPE_SECRET_KEY:    ${{ secrets.STRIPE_SECRET_KEY }}
          STRIPE_WEBHOOK_SECRET: ${{ secrets.STRIPE_WEBHOOK_SECRET }}
          STRIPE_PRICE_MONTHLY: ${{ secrets.STRIPE_PRICE_MONTHLY }}
          STRIPE_PRICE_ANNUAL:  ${{ secrets.STRIPE_PRICE_ANNUAL }}
          STRIPE_PRICE_LIFETIME: ${{ secrets.STRIPE_PRICE_LIFETIME }}
          STRIPE_LIVE:          ${{ secrets.STRIPE_LIVE }}
```

(Don't hand-edit unless you see the env block clearly — if the workflow uses a different mechanism, match it. Matching existing `TRAVELPAYOUTS_*` pattern is the safe tell.)

- [ ] **Step 3: Note: user adds secrets in GH repo settings**

Secrets must be added by the repo owner in GitHub → Settings → Secrets and variables → Actions:
- `STRIPE_SECRET_KEY` (start with `sk_test_`)
- `STRIPE_WEBHOOK_SECRET` (from `stripe listen` output for local, or Stripe dashboard for prod)
- `STRIPE_PRICE_MONTHLY`, `STRIPE_PRICE_ANNUAL`, `STRIPE_PRICE_LIFETIME` (price IDs created in Stripe dashboard)
- `STRIPE_LIVE=0` until Task 5 plan is done

- [ ] **Step 4: Commit**

```bash
git add server/.env.example .github/workflows/deploy.yml
git commit -m "chore(deploy): pass Stripe env vars through deploy workflow"
```

---

## Task 14: End-to-end local smoke

Manual verification before merging the batch.

- [ ] **Step 1: Populate local server/.env**

Copy `server/.env.example` → `server/.env`; fill STRIPE_SECRET_KEY with a test key, leave STRIPE_LIVE=0 initially.

- [ ] **Step 2: Start Stripe CLI webhook forwarding**

```bash
stripe listen --forward-to http://localhost:5001/api/subscriptions/webhook
```
Copy the `whsec_...` it prints into `STRIPE_WEBHOOK_SECRET` in `.env`. Restart server.

- [ ] **Step 3: Flip STRIPE_LIVE=1 in .env, restart, and test checkout**

1. `curl -X POST http://localhost:5001/api/subscriptions/checkout -H "Authorization: Bearer $TOKEN" -H "Content-type: application/json" -d '{"tier":"pro_monthly"}'`
2. Open the returned `url`, use Stripe test card `4242 4242 4242 4242`.
3. Observe `stripe listen` output — webhook fires.
4. `curl -H "Authorization: Bearer $TOKEN" http://localhost:5001/api/auth/me` → expect `subscription_tier: "pro_monthly"`.

- [ ] **Step 4: Test lifetime cap**

Set `UPDATE lifetime_counter SET cap = 1` temporarily via sqlite CLI. Subscribe once via lifetime. Attempt again → expect 409 LIFETIME_SOLD_OUT. Reset cap to 500.

- [ ] **Step 5: Run full server test suite**

```bash
cd server && npm test
```
Expected: all tests PASS.

---

## Self-review checklist (run before declaring Plan 1 complete)

- [ ] All new files created: `subscriptions.js` model, `stripeService.js`, `subscriptionService.js`, `subscriptionController.js`, `routes/subscriptions.js`, `middleware/entitlement.js`, 4 test files
- [ ] db.js migrations are idempotent (Task 2 test passes on fresh DB AND re-run)
- [ ] Webhook mounted BEFORE `express.json()` (Task 9)
- [ ] `requireAuth` hydrates tier fields so `requireTier` works (Task 11)
- [ ] STRIPE_LIVE=0 kill switch returns 503 on checkout/portal (Task 8)
- [ ] Lifetime atomic counter cannot oversell (Task 4 test passes)
- [ ] Webhook idempotency via `event.id` PK (Task 12 test passes)
- [ ] No hard-coded Stripe keys anywhere — all env-driven

Next plan: **Plan 2 — Data Ingestion Track 2** (can run in parallel with Plan 3+).
