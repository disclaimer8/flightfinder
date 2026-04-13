'use strict';

const NOW = Date.now();

jest.mock('../../src/services/openSkyService', () => ({
  getDepartures: jest.fn(),
}));
jest.mock('../../src/services/wikidataService', () => ({
  getRoutes: jest.fn(),
}));
jest.mock('../../src/services/openFlightsService', () => ({
  getAirport:              jest.fn().mockReturnValue({ iata: 'MAD', icao: 'LEMD' }),
  getDirectDestinations:   jest.fn(),
}));

const openSkyService  = require('../../src/services/openSkyService');
const wikidataService = require('../../src/services/wikidataService');
const openFlights     = require('../../src/services/openFlightsService');
const routesService   = require('../../src/services/routesService');

beforeEach(() => jest.clearAllMocks());

describe('routesService.getRoutes', () => {
  test('live confidence: OpenSky result within 7 days', async () => {
    openSkyService.getDepartures.mockResolvedValue([
      { destIata: 'LHR', lastSeen: new Date(NOW - 2 * 86400 * 1000) }, // 2 days ago
    ]);
    wikidataService.getRoutes.mockReturnValue(new Set());
    openFlights.getDirectDestinations.mockReturnValue([]);

    const result = await routesService.getRoutes('MAD');
    expect(result.confidences['LHR']).toBe('live');
    expect(result.destinations).toContain('LHR');
  });

  test('scheduled confidence: Wikidata-only route', async () => {
    openSkyService.getDepartures.mockResolvedValue([]);
    wikidataService.getRoutes.mockReturnValue(new Set(['BCN']));
    openFlights.getDirectDestinations.mockReturnValue([]);

    const result = await routesService.getRoutes('MAD');
    expect(result.confidences['BCN']).toBe('scheduled');
  });

  test('historical confidence: routes.dat-only route', async () => {
    openSkyService.getDepartures.mockResolvedValue([]);
    wikidataService.getRoutes.mockReturnValue(new Set());
    openFlights.getDirectDestinations.mockReturnValue(['HAV']);

    const result = await routesService.getRoutes('MAD');
    expect(result.confidences['HAV']).toBe('historical');
  });

  test('live beats scheduled: same route in both sources gets live tier', async () => {
    openSkyService.getDepartures.mockResolvedValue([
      { destIata: 'JFK', lastSeen: new Date(NOW - 1 * 86400 * 1000) },
    ]);
    wikidataService.getRoutes.mockReturnValue(new Set(['JFK']));
    openFlights.getDirectDestinations.mockReturnValue(['JFK']);

    const result = await routesService.getRoutes('MAD');
    expect(result.confidences['JFK']).toBe('live');
  });

  test('continues gracefully when OpenSky throws', async () => {
    openSkyService.getDepartures.mockRejectedValue(new Error('network error'));
    wikidataService.getRoutes.mockReturnValue(new Set(['BCN']));
    openFlights.getDirectDestinations.mockReturnValue([]);

    const result = await routesService.getRoutes('MAD');
    expect(result.confidences['BCN']).toBe('scheduled');
  });

  test('response includes origin field', async () => {
    openSkyService.getDepartures.mockResolvedValue([]);
    wikidataService.getRoutes.mockReturnValue(new Set(['BCN']));
    openFlights.getDirectDestinations.mockReturnValue([]);

    const result = await routesService.getRoutes('MAD');
    expect(result.origin).toBe('MAD');
  });
});
