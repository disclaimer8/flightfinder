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
        dest_iata: 'JFK', dest_country: 'USA', carrier_name: 'Lufthansa' },
      { origin_iata: 'FRA', origin_city: 'Frankfurt', origin_country: 'Germany',
        dest_iata: 'LHR', dest_country: 'UK', carrier_name: 'Lufthansa' },
      { origin_iata: 'MUC', origin_city: 'Munich', origin_country: 'Germany',
        dest_iata: 'JFK', dest_country: 'USA', carrier_name: 'Lufthansa' },
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

  it('returns shape with jonty=null when only observed_routes has data', () => {
    of.getAirline.mockReturnValue({ iata: 'BA', icao: 'BAW', name: 'British Airways' });
    jonty.getAirlineNetwork.mockReturnValue([]);
    aa.getTopAircraftForAirline.mockReturnValue([
      { icao_aircraft: 'A388', name: 'Airbus A380', n_pairs: 6 },
    ]);
    aa.getTopHubsForAirline.mockReturnValue([]);
    aa.getTopDestinationsForAirline.mockReturnValue([]);
    aa.listValidCombinations.mockReturnValue([]);
    aa.buildValidComboSet.mockReturnValue(new Set());

    const out = airlineLandingService.getAirlineLanding('BA');

    expect(out).not.toBeNull();
    expect(out.jonty).toBeNull();
    expect(out.observed.topAircraft).toHaveLength(1);
    expect(out.observed.topAircraft[0].hasMatrix).toBe(false);
  });

  it('returns shape with empty observed lists when only jonty has data', () => {
    of.getAirline.mockReturnValue({ iata: 'UIA', icao: 'AUI', name: 'Ukraine International' });
    jonty.getAirlineNetwork.mockReturnValue([
      { origin_iata: 'KBP', origin_city: 'Kyiv', origin_country: 'Ukraine',
        dest_iata: 'VIE', dest_country: 'Austria' },
    ]);
    aa.getTopAircraftForAirline.mockReturnValue([]);
    aa.getTopHubsForAirline.mockReturnValue([]);
    aa.getTopDestinationsForAirline.mockReturnValue([]);
    aa.listValidCombinations.mockReturnValue([]);
    aa.buildValidComboSet.mockReturnValue(new Set());

    const out = airlineLandingService.getAirlineLanding('UIA');

    expect(out).not.toBeNull();
    expect(out.jonty.totalRoutes).toBe(1);
    expect(out.observed).toEqual({ topAircraft: [], hubs: [], topDests: [] });
  });

  it('returns null when airline unknown', () => {
    of.getAirline.mockReturnValue(null);
    expect(airlineLandingService.getAirlineLanding('ZZZ')).toBeNull();
  });

  it('returns null when known airline but both sources empty', () => {
    of.getAirline.mockReturnValue({ iata: 'XX', icao: 'XXX', name: 'Empty Air' });
    jonty.getAirlineNetwork.mockReturnValue([]);
    aa.getTopAircraftForAirline.mockReturnValue([]);
    aa.getTopHubsForAirline.mockReturnValue([]);
    aa.getTopDestinationsForAirline.mockReturnValue([]);
    aa.listValidCombinations.mockReturnValue([]);
    aa.buildValidComboSet.mockReturnValue(new Set());

    expect(airlineLandingService.getAirlineLanding('XX')).toBeNull();
  });

  it('prefers jonty carrier_name over openFlights name when jonty has data', () => {
    // Real-world case: IATA "LH" → openFlights returns "Lufthansa Cargo" (first
    // match), but jonty's carrier_name is the mainline "Lufthansa". Prefer jonty
    // to match SSR.
    of.getAirline.mockReturnValue({ iata: 'LH', icao: 'GEC', name: 'Lufthansa Cargo' });
    jonty.getAirlineNetwork.mockReturnValue([
      { origin_iata: 'FRA', origin_city: 'Frankfurt', origin_country: 'Germany',
        dest_iata: 'JFK', dest_country: 'USA', carrier_name: 'Lufthansa' },
    ]);
    aa.getTopAircraftForAirline.mockReturnValue([]);
    aa.getTopHubsForAirline.mockReturnValue([]);
    aa.getTopDestinationsForAirline.mockReturnValue([]);
    aa.listValidCombinations.mockReturnValue([]);
    aa.buildValidComboSet.mockReturnValue(new Set());

    const out = airlineLandingService.getAirlineLanding('LH');
    expect(out.airline.name).toBe('Lufthansa');
    // jonty section returned to caller does not leak the internal _carrierName
    expect(out.jonty).not.toHaveProperty('_carrierName');
  });

  it('falls back to openFlights name when jonty has no rows', () => {
    of.getAirline.mockReturnValue({ iata: 'BA', icao: 'BAW', name: 'British Airways' });
    jonty.getAirlineNetwork.mockReturnValue([]);
    aa.getTopAircraftForAirline.mockReturnValue([
      { icao_aircraft: 'A388', name: 'Airbus A380', n_pairs: 6 },
    ]);
    aa.getTopHubsForAirline.mockReturnValue([]);
    aa.getTopDestinationsForAirline.mockReturnValue([]);
    aa.listValidCombinations.mockReturnValue([]);
    aa.buildValidComboSet.mockReturnValue(new Set());

    const out = airlineLandingService.getAirlineLanding('BA');
    expect(out.airline.name).toBe('British Airways');
  });

  it('survives jonty.db throwing — falls back to jonty=null', () => {
    of.getAirline.mockReturnValue({ iata: 'BA', icao: 'BAW', name: 'British Airways' });
    jonty.getAirlineNetwork.mockImplementation(() => { throw new Error('jonty.db not present'); });
    aa.getTopAircraftForAirline.mockReturnValue([
      { icao_aircraft: 'A388', name: 'Airbus A380', n_pairs: 6 },
    ]);
    aa.getTopHubsForAirline.mockReturnValue([]);
    aa.getTopDestinationsForAirline.mockReturnValue([]);
    aa.listValidCombinations.mockReturnValue([]);
    aa.buildValidComboSet.mockReturnValue(new Set());

    const out = airlineLandingService.getAirlineLanding('BA');
    expect(out).not.toBeNull();
    expect(out.jonty).toBeNull();
  });
});
