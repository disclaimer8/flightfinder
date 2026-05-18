'use strict';

describe('IndexNow key validation route', () => {
  let request, app;

  beforeAll(() => {
    process.env.INDEXNOW_KEY = 'abc123def456abc123def456abc123de'; // 32 hex chars
    jest.resetModules();
    request = require('supertest');
    app = require('../index');
  });

  afterAll(() => {
    delete process.env.INDEXNOW_KEY;
  });

  test('serves key as text/plain at /${KEY}.txt', async () => {
    const res = await request(app).get('/abc123def456abc123def456abc123de.txt');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/plain/);
    expect(res.text).toBe('abc123def456abc123def456abc123de');
  });

  test('returns 404 for wrong filename', async () => {
    const res = await request(app).get('/wrong-filename.txt');
    expect(res.status).not.toBe(200);
  });

  test('does not intercept other routes', async () => {
    const res = await request(app).get('/sitemap.xml');
    // sitemap may 200 or 500 depending on DB availability in test;
    // the point is it isn't 404 from the IndexNow handler
    expect(res.status).not.toBe(404);
  });
});

describe('IndexNow key route — missing or malformed key', () => {
  beforeEach(() => {
    delete process.env.INDEXNOW_KEY;
    jest.resetModules();
  });

  test('no route registered when key is missing', async () => {
    const request = require('supertest');
    const app = require('../index');
    const res = await request(app).get('/abc123.txt');
    expect(res.status).toBe(404);
  });

  test('no route registered when key is malformed', async () => {
    process.env.INDEXNOW_KEY = 'too-short';
    const request = require('supertest');
    const app = require('../index');
    const res = await request(app).get('/too-short.txt');
    expect(res.status).toBe(404);
    delete process.env.INDEXNOW_KEY;
  });
});
