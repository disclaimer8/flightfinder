'use strict';

jest.mock('../workers/adsblolWorker', () => ({
  getLastCycle: () => ({
    ran_at: 1779000000000, duration_ms: 184321, types: 48,
    fetched: 38214, resolved: 12903, persisted: 874,
  }),
}));

const request  = require('supertest');
const express  = require('express');
const ingestRouter = require('../routes/ingestStatus');

const app = express();
app.use('/', ingestRouter);

beforeAll(() => {
  process.env.ADMIN_TOKEN = 'test-admin-token';
});

afterAll(() => {
  delete process.env.ADMIN_TOKEN;
});

describe('GET /api/admin/ingest-status — adsblol/adsbdb fields', () => {
  it('includes observedRoutes.{newest_seen_at,oldest_seen_at,last24h,last7d}', async () => {
    const res = await request(app).get('/').set('Authorization', 'Bearer test-admin-token');
    expect(res.status).toBe(200);
    const { observedRoutes } = res.body;
    expect(observedRoutes.total).toEqual(expect.any(Number));
    expect(observedRoutes.last24h).toEqual(expect.any(Number));
    expect(observedRoutes.last7d).toEqual(expect.any(Number));
    expect(observedRoutes.last30d).toEqual(expect.any(Number));
    expect('oldest_seen_at' in observedRoutes).toBe(true);
    expect('newest_seen_at' in observedRoutes).toBe(true);
  });

  it('includes adsblolLastCycle reflecting worker.getLastCycle()', async () => {
    const res = await request(app).get('/').set('Authorization', 'Bearer test-admin-token');
    expect(res.body.adsblolLastCycle).toEqual({
      ran_at: 1779000000000, duration_ms: 184321, types: 48,
      fetched: 38214, resolved: 12903, persisted: 874,
    });
  });

  it('includes adsbdbCache totals', async () => {
    const res = await request(app).get('/').set('Authorization', 'Bearer test-admin-token');
    expect(res.body.adsbdbCache).toEqual(expect.objectContaining({
      total: expect.any(Number),
      resolved: expect.any(Number),
      negative: expect.any(Number),
    }));
  });

  it('still rejects without ADMIN_TOKEN header', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(401);
  });
});
