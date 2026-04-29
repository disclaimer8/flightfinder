const path = require('path');
const fixture = require(path.join(__dirname, 'fixtures', 'google-sidecar-response.json'));
const svc = require('../services/googleFlightsService');

describe('googleFlightsService.parse', () => {
  test('parses sidecar response into normalized flight array', () => {
    const flights = svc.parse(fixture);
    expect(Array.isArray(flights)).toBe(true);
    expect(flights.length).toBeGreaterThan(0);

    const f = flights[0];
    expect(f).toHaveProperty('departure.code');
    expect(f).toHaveProperty('arrival.code');
    expect(f).toHaveProperty('departureTime');
    expect(f).toHaveProperty('arrivalTime');
    expect(typeof f.duration).toBe('number');
    expect(typeof f.stops).toBe('number');
    expect(f).toHaveProperty('airlineIata');
    expect(f).toHaveProperty('flightNumber');
    expect(Array.isArray(f.segments)).toBe(true);
    expect(f.segments.length).toBeGreaterThan(0);
  });

  test('returns empty array when offers is missing', () => {
    expect(svc.parse({})).toEqual([]);
    expect(svc.parse({ offers: null })).toEqual([]);
    expect(svc.parse(null)).toEqual([]);
  });

  test('duration is reasonable (greater than 30 min, less than 24h)', () => {
    const flights = svc.parse(fixture);
    expect(flights[0].duration).toBeGreaterThan(30);
    expect(flights[0].duration).toBeLessThan(24 * 60);
  });

  test('airlineIata is a 2-3 letter code, not null, when flight number is well-formed', () => {
    const flights = svc.parse(fixture);
    const f = flights.find(x => x.flightNumber);
    expect(f.airlineIata).toMatch(/^[A-Z0-9]{2,3}$/);
  });
});

const axios = require('axios');
jest.mock('axios');

describe('googleFlightsService.search', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns null on ECONNREFUSED', async () => {
    axios.get.mockRejectedValue({ code: 'ECONNREFUSED', message: 'connect ECONNREFUSED 127.0.0.1:5002' });
    const result = await svc.search({ departure: 'LIS', arrival: 'JFK', date: '2026-06-01' });
    expect(result).toBeNull();
  });

  test('returns null on timeout', async () => {
    axios.get.mockRejectedValue({ code: 'ECONNABORTED', message: 'timeout of 10000ms exceeded' });
    const result = await svc.search({ departure: 'LIS', arrival: 'JFK', date: '2026-06-01' });
    expect(result).toBeNull();
  });

  test('returns parsed flights on 200', async () => {
    axios.get.mockResolvedValue({ status: 200, data: fixture });
    const result = await svc.search({ departure: 'LIS', arrival: 'JFK', date: '2026-06-01' });
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
  });
});
