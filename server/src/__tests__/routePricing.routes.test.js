'use strict';
const request = require('supertest');

jest.mock('../services/routePricingService', () => ({
  getPricesForRoute: jest.fn(),
  getRoutesForAircraft: jest.fn(),
}));

const svc = require('../services/routePricingService');
const cacheService = require('../services/cacheService');
const app = require('../index');

beforeEach(() => {
  jest.clearAllMocks();
  if (typeof cacheService.flush === 'function') cacheService.flush();
});

describe('GET /api/routes/:pair/prices', () => {
  it('400 on malformed pair', async () => {
    const res = await request(app).get('/api/routes/notapair/prices');
    expect(res.status).toBe(400);
    expect(svc.getPricesForRoute).not.toHaveBeenCalled();
  });

  it('404 on unknown pair (empty result)', async () => {
    svc.getPricesForRoute.mockReturnValue([]);
    const res = await request(app).get('/api/routes/zzz-yyy/prices');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'no price data' });
  });

  it('200 with payload', async () => {
    svc.getPricesForRoute.mockReturnValue([
      { aircraft_icao: 'B789', aircraft_name: 'Boeing 787-9', median_eur: 500,
        min_eur: 400, max_eur: 600, n_quotes: 8, airlines: ['BAW'],
        airlines_display: 'British Airways',
        safety: { accident_count_5y: 0, level: 'green' }, snapshot_at: 1 },
    ]);
    const res = await request(app).get('/api/routes/lhr-jfk/prices');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.prices).toHaveLength(1);
    expect(res.body.prices[0].aircraft_icao).toBe('B789');
    expect(res.headers['cache-control']).toContain('max-age=300');
  });
});

describe('GET /api/aircraft/:icao/prices', () => {
  it('400 on invalid ICAO', async () => {
    const res = await request(app).get('/api/aircraft/!!!/prices');
    expect(res.status).toBe(400);
  });

  it('404 on aircraft with no data', async () => {
    svc.getRoutesForAircraft.mockReturnValue([]);
    const res = await request(app).get('/api/aircraft/zzzz/prices');
    expect(res.status).toBe(404);
  });

  it('200 with payload', async () => {
    svc.getRoutesForAircraft.mockReturnValue([
      { dep_iata: 'LHR', arr_iata: 'JFK', dep_city: 'London', arr_city: 'New York',
        median_eur: 500, min_eur: 400, max_eur: 600, n_quotes: 12 },
    ]);
    const res = await request(app).get('/api/aircraft/b789/prices');
    expect(res.status).toBe(200);
    expect(res.body.routes).toHaveLength(1);
    expect(res.headers['cache-control']).toContain('max-age=300');
  });
});
