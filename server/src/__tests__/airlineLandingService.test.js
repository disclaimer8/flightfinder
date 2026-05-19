'use strict';
const { db } = require('../models/db');
const airlineLandingService = require('../services/airlineLandingService');

jest.mock('../services/jontyRouteService', () => ({
  getAirlineNetwork: jest.fn(),
  getCarrierMeta: jest.fn(),
}));
jest.mock('../services/airlineAircraftService', () => ({
  getTopAircraftForAirline: jest.fn(),
  getTopHubsForAirline: jest.fn(),
  getTopDestinationsForAirline: jest.fn(),
  listValidCombinations: jest.fn(),
  buildValidComboSet: jest.fn(),
}));
jest.mock('../services/openFlightsService', () => ({
  getAirline: jest.fn(),
  getAirlineByIcao: jest.fn(),
}));

const jonty = require('../services/jontyRouteService');
const aa    = require('../services/airlineAircraftService');
const of    = require('../services/openFlightsService');

beforeEach(() => { jest.clearAllMocks(); });

describe('airlineLandingService.getAirlineLanding', () => {
  it('returns full shape when both jonty and observed have data', () => {
    of.getAirline.mockReturnValue({ iata: 'LH', icao: 'DLH', name: 'Lufthansa' });
    jonty.getAirlineNetwork.mockReturnValue([
      { origin_iata: 'FRA', origin_city: 'Frankfurt', origin_country: 'Germany',
        dest_iata: 'JFK', dest_country: 'USA' },
      { origin_iata: 'FRA', origin_city: 'Frankfurt', origin_country: 'Germany',
        dest_iata: 'LHR', dest_country: 'UK' },
      { origin_iata: 'MUC', origin_city: 'Munich', origin_country: 'Germany',
        dest_iata: 'JFK', dest_country: 'USA' },
    ]);
    aa.getTopAircraftForAirline.mockReturnValue([
      { icao_aircraft: 'A320', name: 'Airbus A320', n_pairs: 87 },
      { icao_aircraft: 'B748', name: 'Boeing 747-8', n_pairs: 12 },
    ]);
    aa.getTopHubsForAirline.mockReturnValue([
      { iata: 'FRA', city: 'Frankfurt', country: 'Germany', pair_count: 142 },
    ]);
    aa.getTopDestinationsForAirline.mockReturnValue([
      { iata: 'JFK', city: 'New York', country: 'USA', pair_count: 12 },
    ]);
    aa.listValidCombinations.mockReturnValue([{ iata: 'LH', icao: 'A320' }]);
    aa.buildValidComboSet.mockReturnValue(new Set(['lh:a320']));

    const out = airlineLandingService.getAirlineLanding('LH');

    expect(out).toEqual({
      airline: { iata: 'LH', icao: 'DLH', name: 'Lufthansa' },
      jonty: {
        totalRoutes: 3,
        totalCountries: 3,
        hubCount: 0,
        origins: [
          { iata: 'FRA', city: 'Frankfurt', country: 'Germany', routeCount: 2 },
          { iata: 'MUC', city: 'Munich',    country: 'Germany', routeCount: 1 },
        ],
      },
      observed: {
        topAircraft: [
          { icao: 'A320', name: 'Airbus A320', nPairs: 87, hasMatrix: true },
          { icao: 'B748', name: 'Boeing 747-8', nPairs: 12, hasMatrix: false },
        ],
        hubs: [
          { iata: 'FRA', city: 'Frankfurt', country: 'Germany', pairCount: 142 },
        ],
        topDests: [
          { iata: 'JFK', city: 'New York', country: 'USA', pairCount: 12 },
        ],
      },
    });
  });
});
