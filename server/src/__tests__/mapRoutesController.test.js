'use strict';

// ── Model mock ────────────────────────────────────────────────────────────────
jest.mock('../models/observedRoutes', () => ({
  aggregateForMap: jest.fn(() => [
    {
      dep_iata: 'LHR', arr_iata: 'JFK',
      dep_lat: 51.477, dep_lon: -0.461,
      arr_lat: 40.641, arr_lon: -73.778,
      airline_count: 2, aircraft_count: 1,
      last_seen_at: 1700000000000,
    },
  ]),
  distinctAirlinesWithCounts: jest.fn(() => [
    { iata: 'BA', name: 'British Airways', count: 50 },
    { iata: 'AA', name: 'American Airlines', count: 30 },
  ]),
  distinctAircraftWithCounts: jest.fn(() => [
    { icao: 'B789', label: 'Boeing 787 Dreamliner', count: 40 },
    { icao: 'A320', label: 'Airbus A320 family', count: 20 },
  ]),
}));

// ── cacheService mock — always miss so controller runs model code ─────────────
jest.mock('../services/cacheService', () => ({
  get: jest.fn(() => undefined),
  set: jest.fn(),
}));

const request = require('supertest');
const express = require('express');
const mapRouter = require('../routes/map');

// Build a minimal Express app with just the map router so tests are isolated
// from the full server startup (workers, DB migrations, etc.).
const app = express();
app.use('/', mapRouter);

// ── Test 1: GET /routes (no filters) ─────────────────────────────────────────
test('GET /routes returns 200 with routes array and Cache-Control header', async () => {
  const res = await request(app).get('/routes');

  expect(res.status).toBe(200);
  expect(Array.isArray(res.body.routes)).toBe(true);
  expect(res.headers['cache-control']).toBe('public, max-age=300');
});

// ── Test 2: GET /routes?airline=ba — model receives uppercased value ──────────
// The controller uppercases after sanitising so the cache key is consistent
// and the model always receives upper-case codes.
test('GET /routes?airline=ba uppercases airline before passing to model', async () => {
  const { aggregateForMap } = require('../models/observedRoutes');
  aggregateForMap.mockClear();

  const res = await request(app).get('/routes?airline=ba');

  expect(res.status).toBe(200);
  expect(aggregateForMap).toHaveBeenCalledTimes(1);
  // Controller normalises to upper-case before calling the model
  expect(aggregateForMap.mock.calls[0][0].airline).toBe('BA');
});

// ── Test 3: invalid chars return 400 ─────────────────────────────────────────
test.each([
  ['airline', '<<>>',  '/routes?airline=%3C%3C%3E%3E'],
  ['airline', ';',     '/routes?airline=%3B'],
  ['airline', "'",     "/routes?airline=%27"],
  ['airline', ' ',     '/routes?airline=%20'],
  ['airline', '%00',   '/routes?airline=%2500'],
  ['airline', 'A-1',   '/routes?airline=A-1'],
  ['aircraft', '<<>>', '/routes?aircraft=%3C%3C%3E%3E'],
  ['aircraft', ';',    '/routes?aircraft=%3B'],
  ['aircraft', "'",    "/routes?aircraft=%27"],
  ['aircraft', ' ',    '/routes?aircraft=%20'],
  ['aircraft', '%00',  '/routes?aircraft=%2500'],
  ['aircraft', 'B7-8', '/routes?aircraft=B7-8'],
])('GET %s=%s returns 400 for invalid chars', async (_param, _input, url) => {
  const res = await request(app).get(url);

  expect(res.status).toBe(400);
  expect(res.body.success).toBe(false);
});

// ── Test 4: GET /filters returns 200, airlines ≤200, both sorted by count DESC ─
test('GET /filters returns 200 with airlines (≤200) and aircraft sorted by count DESC', async () => {
  const res = await request(app).get('/filters');

  expect(res.status).toBe(200);
  expect(Array.isArray(res.body.airlines)).toBe(true);
  expect(Array.isArray(res.body.aircraft)).toBe(true);

  // airlines capped at 200
  expect(res.body.airlines.length).toBeLessThanOrEqual(200);

  // verify sort order — count DESC
  const airlines = res.body.airlines;
  for (let i = 1; i < airlines.length; i++) {
    expect(airlines[i - 1].count).toBeGreaterThanOrEqual(airlines[i].count);
  }

  const aircraft = res.body.aircraft;
  for (let i = 1; i < aircraft.length; i++) {
    expect(aircraft[i - 1].count).toBeGreaterThanOrEqual(aircraft[i].count);
  }

  // Cache-Control header
  expect(res.headers['cache-control']).toBe('public, max-age=300');
});
