'use strict';
const request = require('supertest');

jest.mock('../services/airlineLandingService', () => ({
  getAirlineLanding: jest.fn(),
}));
const svc = require('../services/airlineLandingService');
const cacheService = require('../services/cacheService');
const app = require('../index');

beforeEach(() => {
  jest.clearAllMocks();
  cacheService.flush();
});

describe('GET /api/airline/:iata', () => {
  it('400 on invalid IATA', async () => {
    const res = await request(app).get('/api/airline/!!');
    expect(res.status).toBe(400);
    expect(svc.getAirlineLanding).not.toHaveBeenCalled();
  });

  it('404 when service returns null', async () => {
    svc.getAirlineLanding.mockReturnValue(null);
    const res = await request(app).get('/api/airline/zzz');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'no airline data' });
  });

  it('200 with payload when service returns data', async () => {
    svc.getAirlineLanding.mockReturnValue({
      airline: { iata: 'LH', icao: 'DLH', name: 'Lufthansa' },
      jonty: { totalRoutes: 287, totalCountries: 64, hubCount: 3, origins: [] },
      observed: { topAircraft: [], hubs: [], topDests: [] },
    });
    const res = await request(app).get('/api/airline/lh');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.airline.iata).toBe('LH');
    expect(res.headers['cache-control']).toContain('max-age=300');
  });

  it('does not collide with /api/airline/:iata/aircraft/:icao/routes', async () => {
    svc.getAirlineLanding.mockReturnValue(null);
    await request(app).get('/api/airline/lh/aircraft/a320/routes');
    expect(svc.getAirlineLanding).not.toHaveBeenCalled();
  });
});
