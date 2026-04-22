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
