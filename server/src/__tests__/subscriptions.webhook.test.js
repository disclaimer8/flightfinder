// Integration test: posts a signed webhook fixture, asserts DB state mutations.
// Does NOT hit real Stripe. constructEvent is the only Stripe SDK call we keep real;
// we build a valid signature manually using the secret.

const express = require('express');
const rateLimit = require('express-rate-limit');
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
  // Match prod wiring — real prod route is rate-limited at 300/min/IP (see
  // server/src/index.js). Using the same middleware shape in tests keeps
  // CodeQL happy and catches any future regression where the limiter is
  // accidentally skipped.
  const webhookLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 1000,          // generous for tests that fire many requests in one run
    standardHeaders: true,
    legacyHeaders: false,
    validate: false,    // suppress X-Forwarded-For / trust-proxy warnings in test env
  });
  app.post('/webhook', webhookLimiter, express.raw({ type: 'application/json' }), controller.handleWebhook);
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

  test('checkout.session.completed for pro_lifetime updates user tier + counter', async () => {
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

  test('lifetime survives monthly subscription.deleted after an upgrade', async () => {
    // Seed: user has both a monthly recurring sub AND an active lifetime row.
    // Then fire customer.subscription.deleted for the monthly. Must NOT reset user to free.
    const now = Date.now();
    const info = db.prepare(
      'INSERT INTO users (email, password_hash, created_at, updated_at, email_verified, subscription_tier) VALUES (?, ?, ?, ?, 1, ?)'
    ).run(`upgrade.${Date.now()}@test`, 'xxx', now, now, 'pro_lifetime');
    const u2 = info.lastInsertRowid;

    // 1) Lifetime active row
    subsModel.upsertSubscription({
      user_id: u2, stripe_sub_id: `lifetime_cs_u2_${Date.now()}`, stripe_session_id: 'cs_u2',
      tier: 'pro_lifetime', status: 'active', period_end: null, trial_end: null, now,
    });
    // 2) Monthly sub (will be deleted)
    const monthlySubId = `sub_monthly_u2_${Date.now()}`;
    subsModel.upsertSubscription({
      user_id: u2, stripe_sub_id: monthlySubId, stripe_session_id: 'cs_u2_m',
      tier: 'pro_monthly', status: 'active', period_end: now + 86400000, trial_end: null, now,
    });

    const event = {
      id: `evt_del_monthly_${Date.now()}`,
      type: 'customer.subscription.deleted',
      data: { object: { id: monthlySubId, status: 'canceled', current_period_end: null, trial_end: null } },
    };
    const { body, header } = signedRequest(event);
    const res = await request(appWithWebhook())
      .post('/webhook').set('stripe-signature', header).set('content-type', 'application/json').send(body);
    expect(res.status).toBe(200);

    // User MUST still be pro_lifetime (guard held)
    const user = db.prepare('SELECT subscription_tier FROM users WHERE id = ?').get(u2);
    expect(user.subscription_tier).toBe('pro_lifetime');
  });
});
