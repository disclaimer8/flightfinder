'use strict';

const request = require('supertest');

// Set env before requiring app
process.env.NODE_ENV = 'test';

const app = require('../../src/index');

describe('GET /api/health', () => {
  test('returns 200 with status ok', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});

describe('Debug endpoints', () => {
  test('/api/debug/airlabs no longer exists (removed)', async () => {
    // The old airlabs debug endpoint (which had no env guard) has been removed
    const res = await request(app).get('/api/debug/airlabs');
    expect(res.status).toBe(404);
  });

  test('/api/debug/amadeus is accessible in non-production', async () => {
    // NODE_ENV=test → IS_DEV=true → endpoint is registered
    const res = await request(app).get('/api/debug/amadeus');
    // May be 200 (no creds) or 400 (missing creds) — never 404 in dev/test
    expect(res.status).not.toBe(404);
  });

  test('/api/debug/cache is accessible in non-production', async () => {
    const res = await request(app).get('/api/debug/cache');
    expect(res.status).not.toBe(404);
  });
});

describe('Security headers', () => {
  test('helmet sets X-Content-Type-Options', async () => {
    const res = await request(app).get('/api/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  test('helmet sets X-Frame-Options', async () => {
    const res = await request(app).get('/api/health');
    expect(res.headers['x-frame-options']).toBeDefined();
  });
});
