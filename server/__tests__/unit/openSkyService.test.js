'use strict';

jest.mock('axios');
jest.mock('../../src/services/openFlightsService', () => ({
  getAirportByIcao: (icao) => {
    const map = { EGLL: { iata: 'LHR' }, LEMD: { iata: 'MAD' }, LFPG: { iata: 'CDG' } };
    return map[icao] || null;
  },
}));

const axios = require('axios');
const openSkyService = require('../../src/services/openSkyService');

const NOW = 1713304800; // fixed "now" for tests

beforeEach(() => {
  jest.clearAllMocks();
  openSkyService._clearCache();
});

describe('getDepartures', () => {
  test('returns destinations with lastSeen dates on success', async () => {
    axios.get.mockResolvedValue({
      data: [
        { estArrivalAirport: 'EGLL', lastSeen: NOW - 100 },
        { estArrivalAirport: 'LFPG', lastSeen: NOW - 200 },
        { estArrivalAirport: null,   lastSeen: NOW - 300 }, // should be filtered
      ],
    });

    const result = await openSkyService.getDepartures('LEMD', 7);

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ destIata: 'LHR' });
    expect(result[1]).toMatchObject({ destIata: 'CDG' });
    expect(result[0].lastSeen).toBeInstanceOf(Date);
  });

  test('returns empty array when OpenSky returns 404', async () => {
    axios.get.mockRejectedValue({ response: { status: 404 } });
    const result = await openSkyService.getDepartures('ZZZZ', 7);
    expect(result).toEqual([]);
  });

  test('deduplicates destinations — keeps most recent lastSeen', async () => {
    axios.get.mockResolvedValue({
      data: [
        { estArrivalAirport: 'EGLL', lastSeen: NOW - 100 },
        { estArrivalAirport: 'EGLL', lastSeen: NOW - 50 }, // newer
      ],
    });

    const result = await openSkyService.getDepartures('LEMD', 7);
    expect(result).toHaveLength(1);
    expect(result[0].lastSeen.getTime()).toBe((NOW - 50) * 1000);
  });

  test('caches result and does not call axios again within TTL', async () => {
    axios.get.mockResolvedValue({ data: [{ estArrivalAirport: 'EGLL', lastSeen: NOW }] });

    await openSkyService.getDepartures('LEMD', 7);
    await openSkyService.getDepartures('LEMD', 7);

    expect(axios.get).toHaveBeenCalledTimes(1);
  });
});
