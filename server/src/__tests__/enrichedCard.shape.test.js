// Contract test: the /enriched response shape is a hard contract with the client.
// If the test fails, the FlightCard will break. Mocks the service to make the test
// deterministic; this is about the HTTP layer + shape, not about enrichment logic.

const express = require('express');
const request = require('supertest');

jest.mock('../services/enrichmentService', () => ({
  enrichFlight: jest.fn(async () => ({
    livery: { imageUrl: 'https://example.com/a.jpg', attribution: 'Wiki' },
    aircraft: { registration: 'G-STBA', icaoType: 'B738', buildYear: 2010, ageYears: 16 },
    onTime: { pct90d: 87, medianDelay: 5, p75Delay: 14, sample: 42, confidence: 'high', scope: 'exact-flight' },
    delayForecast: { median: 5, p75: 14, onTimePct: 0.87, confidence: 'high', sample: 42, scope: 'exact-flight' },
    co2: { kgPerPax: 105, distanceKm: 850 },
    amenities: { wifi: true, power: true, entertainment: false, meal: false },
    gate: { originGate: 'A21', originTerminal: '2', destGate: 'B7', destTerminal: '3' },
    weather: {
      origin: { tempC: 18, condition: 'Clouds', description: 'scattered clouds', windMps: 4, icon: '03d', observedAt: 1 },
      destination: { tempC: 24, condition: 'Clear', description: 'clear sky', windMps: 2, icon: '01d', observedAt: 1 },
    },
  })),
}));

const controller = require('../controllers/enrichmentController');

function makeApp() {
  const app = express();
  // pretend auth + pro — skip middleware in unit
  app.get('/api/flights/:id/enriched', controller.getEnriched);
  app.get('/api/flights/:id/enriched/teaser', controller.getTeaser);
  return app;
}

describe('GET /api/flights/:id/enriched', () => {
  test('invalid id → 400', async () => {
    const res = await request(makeApp()).get('/api/flights/bogus/enriched?dep=LHR&arr=JFK&type=B738');
    expect(res.status).toBe(400);
  });

  test('happy path returns expected shape', async () => {
    const res = await request(makeApp()).get('/api/flights/BA175:2026-05-15/enriched?dep=LHR&arr=JFK&type=B738');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.tier).toBe('pro');
    expect(res.body.data).toEqual(expect.objectContaining({
      livery:   expect.objectContaining({ imageUrl: expect.any(String) }),
      aircraft: expect.objectContaining({ registration: expect.any(String) }),
      onTime:   expect.objectContaining({ pct90d: expect.any(Number), confidence: expect.any(String) }),
      co2:      expect.objectContaining({ kgPerPax: expect.any(Number) }),
      amenities: expect.objectContaining({ wifi: expect.any(Boolean) }),
      gate:     expect.objectContaining({ originGate: expect.any(String) }),
      weather:  expect.objectContaining({
        origin: expect.any(Object),
        destination: expect.any(Object),
      }),
    }));
  });

  test('teaser returns same keys with all null values', async () => {
    const res = await request(makeApp()).get('/api/flights/BA175:2026-05-15/enriched/teaser');
    expect(res.status).toBe(200);
    expect(res.body.tier).toBe('free');
    expect(res.body.data).toEqual({
      livery: null, aircraft: null, onTime: null, delayForecast: null,
      co2: null, amenities: null, gate: null,
      weather: { origin: null, destination: null },
    });
  });
});
