'use strict';

process.env.NODE_ENV = 'test';

const request = require('supertest');

// Mock heavy external services so tests run offline
jest.mock('../../src/services/amadeusService', () => ({
  searchFlights: jest.fn().mockResolvedValue({ data: [], dictionaries: { carriers: {}, aircraft: {} } }),
  parseDuration: jest.fn().mockReturnValue('1h 0m'),
}));
jest.mock('../../src/services/duffelService',  () => ({
  searchFlights: jest.fn().mockResolvedValue({ data: { offers: [] } }),
  createOrder:   jest.fn(),
}));
jest.mock('../../src/services/airlabsService', () => ({
  getMultipleAircraft: jest.fn().mockResolvedValue({}),
  getMultipleAirlines: jest.fn().mockResolvedValue({}),
}));
jest.mock('../../src/services/cacheService', () => ({
  get:       jest.fn().mockReturnValue(null),
  set:       jest.fn(),
  getOrFetch: jest.fn().mockImplementation((_key, fetcher) =>
    fetcher().then(data => ({ data, fromCache: false }))),
  stats: jest.fn().mockReturnValue({}),
  flush: jest.fn(),
  TTL: { flights: 600, explore: 1800 },
}));

const app = require('../../src/index');

const TOMORROW = new Date(Date.now() + 86400000).toISOString().split('T')[0];

// ─── GET /api/flights ─────────────────────────────────────────────────────────

describe('GET /api/flights — validation', () => {
  test('400 when departure missing', async () => {
    const res = await request(app).get('/api/flights?arrival=JFK');
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test('400 when arrival missing', async () => {
    const res = await request(app).get('/api/flights?departure=LIS');
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test('400 when departure === arrival', async () => {
    const res = await request(app)
      .get(`/api/flights?departure=LIS&arrival=LIS&date=${TOMORROW}`);
    expect(res.status).toBe(400);
  });

  test('400 when date is in the past', async () => {
    const res = await request(app)
      .get('/api/flights?departure=LIS&arrival=JFK&date=2020-01-01');
    expect(res.status).toBe(400);
  });

  test('400 when passengers > 9', async () => {
    const res = await request(app)
      .get(`/api/flights?departure=LIS&arrival=JFK&date=${TOMORROW}&passengers=10`);
    expect(res.status).toBe(400);
  });

  test('400 when aircraftType is unknown', async () => {
    const res = await request(app)
      .get(`/api/flights?departure=LIS&arrival=JFK&date=${TOMORROW}&aircraftType=biplane`);
    expect(res.status).toBe(400);
  });

  test('200 with valid params returns flights array', async () => {
    const res = await request(app)
      .get(`/api/flights?departure=LIS&arrival=JFK&date=${TOMORROW}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});

// ─── GET /api/flights/explore ─────────────────────────────────────────────────

describe('GET /api/flights/explore — validation', () => {
  test('400 when departure missing', async () => {
    const res = await request(app).get('/api/flights/explore?aircraftType=jet');
    expect(res.status).toBe(400);
  });

  test('400 when no aircraft criteria provided', async () => {
    const res = await request(app)
      .get(`/api/flights/explore?departure=LIS&date=${TOMORROW}`);
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/aircraftType or aircraftModel/);
  });

  test('200 with departure + aircraftType returns array', async () => {
    const res = await request(app)
      .get(`/api/flights/explore?departure=LIS&date=${TOMORROW}&aircraftType=jet`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});

// ─── GET /api/flights/filter-options ─────────────────────────────────────────

describe('GET /api/flights/filter-options', () => {
  test('returns cities, aircraftTypes, aircraft arrays', async () => {
    const res = await request(app).get('/api/flights/filter-options');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.cities)).toBe(true);
    expect(Array.isArray(res.body.aircraftTypes)).toBe(true);
    expect(Array.isArray(res.body.aircraft)).toBe(true);
  });

  test('returns apiStatus object', async () => {
    const res = await request(app).get('/api/flights/filter-options');
    expect(res.body.apiStatus).toBeDefined();
    expect(typeof res.body.apiStatus.amadeus).toBe('boolean');
  });
});

// ─── POST /api/flights/book ───────────────────────────────────────────────────

describe('POST /api/flights/book — validation', () => {
  const validBody = {
    offerId:      'off_test123',
    passengerIds: ['pas_1'],
    passengerInfo: [{
      firstName:   'John',
      lastName:    'Smith',
      email:       'john@example.com',
      dateOfBirth: '1990-05-10',
      title:       'mr',
      gender:      'M',
      phone:       '+1 555 000 0000',
    }],
    currency:    'EUR',
    totalAmount: '299.00',
  };

  test('400 when offerId missing', async () => {
    const { offerId: _omit, ...body } = validBody;
    const res = await request(app).post('/api/flights/book').send(body);
    expect(res.status).toBe(400);
  });

  test('400 when passengerInfo empty', async () => {
    const res = await request(app)
      .post('/api/flights/book')
      .send({ ...validBody, passengerInfo: [] });
    expect(res.status).toBe(400);
  });

  test('400 when passenger under 18', async () => {
    const res = await request(app)
      .post('/api/flights/book')
      .send({
        ...validBody,
        passengerInfo: [{ ...validBody.passengerInfo[0], dateOfBirth: '2015-01-01' }],
      });
    expect(res.status).toBe(400);
  });

  test('400 when email invalid', async () => {
    const res = await request(app)
      .post('/api/flights/book')
      .send({
        ...validBody,
        passengerInfo: [{ ...validBody.passengerInfo[0], email: 'bad-email' }],
      });
    expect(res.status).toBe(400);
  });

  test('400 when currency unsupported', async () => {
    const res = await request(app)
      .post('/api/flights/book')
      .send({ ...validBody, currency: 'XYZ' });
    expect(res.status).toBe(400);
  });

  test('503 when Duffel API key not configured', async () => {
    const saved = process.env.DUFFEL_API_KEY;
    delete process.env.DUFFEL_API_KEY;

    const res = await request(app).post('/api/flights/book').send(validBody);
    expect(res.status).toBe(503);

    process.env.DUFFEL_API_KEY = saved;
  });
});
