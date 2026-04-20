'use strict';

jest.mock('axios');
const axios = require('axios');

// axios.create() returns the mocked axios so adsblolClient.get/post === axios.get/post
axios.create.mockReturnValue(axios);

// Mock db so upserts can be asserted without touching SQLite
jest.mock('../models/db', () => ({
  upsertObservedRoute: jest.fn(),
}));
const db = require('../models/db');

// Also flush cache between tests so repeated getAircraftByType calls actually hit axios
const cacheService = require('../services/cacheService');

let adsblolService;

beforeAll(() => {
  process.env.ADSBLOL_ENABLED = '1';
  adsblolService = require('../services/adsblolService');
});

afterEach(() => {
  jest.clearAllMocks();
  cacheService.flush();
});

describe('adsblolService.getAircraftByType', () => {
  it('filters out entries without flight/lat/lon and trims callsigns', async () => {
    axios.get.mockResolvedValueOnce({
      data: {
        ac: [
          { flight: 'BAW178  ', lat: 51.4, lon: -0.4, hex: 'abc', r: 'G-XWBA', t: 'A359' },
          { flight: '', lat: 40.6, lon: -73.7 },                                  // no callsign
          { flight: 'LH400', lat: null, lon: -73.7 },                              // no lat
          { flight: 'AFR006', lat: 40.6, lon: undefined },                         // no lon
          { flight: 'UAL901', lat: 37.6, lon: -122.4 },
        ],
      },
    });

    const planes = await adsblolService.getAircraftByType('A359');

    expect(planes).toHaveLength(2);
    expect(planes[0].callsign).toBe('BAW178');      // trimmed
    expect(planes[0].lat).toBe(51.4);
    expect(planes[0].lng).toBe(-0.4);
    expect(planes[0].type).toBe('A359');
    expect(planes[1].callsign).toBe('UAL901');
  });

  it('returns empty array when service disabled', async () => {
    process.env.ADSBLOL_ENABLED = '0';
    try {
      const planes = await adsblolService.getAircraftByType('A359');
      expect(planes).toEqual([]);
      expect(axios.get).not.toHaveBeenCalled();
    } finally {
      process.env.ADSBLOL_ENABLED = '1';
    }
  });

  it('returns empty array on network error', async () => {
    axios.get.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const planes = await adsblolService.getAircraftByType('B77W');
    expect(planes).toEqual([]);
  });
});

describe('adsblolService.resolveRoutes', () => {
  it('skips "unknown" airport codes and parses valid IATA pairs', async () => {
    axios.post.mockResolvedValueOnce({
      data: [
        {
          callsign: 'BAW178',
          _airport_codes_iata: 'LHR-JFK',
          _airports: [
            { iata: 'LHR', icao: 'EGLL' },
            { iata: 'JFK', icao: 'KJFK' },
          ],
          airline_code: 'BAW',
          plausible: true,
        },
        {
          callsign: 'NKS1',
          _airport_codes_iata: 'unknown-unknown',
          _airports: [],
          plausible: false,
        },
        {
          callsign: 'AFR006',
          _airport_codes_iata: 'JFK-CDG',
          _airports: [
            { iata: 'JFK', icao: 'KJFK' },
            { iata: 'CDG', icao: 'LFPG' },
          ],
          airline_code: 'AFR',
          plausible: false,
        },
      ],
    });

    const input = [
      { callsign: 'BAW178', lat: 51, lng: 0 },
      { callsign: 'NKS1',   lat: 40, lng: -74 },
      { callsign: 'AFR006', lat: 40, lng: -74 },
    ];
    const routes = await adsblolService.resolveRoutes(input);

    expect(routes).toHaveLength(2);
    expect(routes[0]).toMatchObject({
      callsign: 'BAW178',
      depIata: 'LHR',
      arrIata: 'JFK',
      depIcao: 'EGLL',
      arrIcao: 'KJFK',
      airlineCode: 'BAW',
    });
    expect(routes[1]).toMatchObject({
      callsign: 'AFR006',
      depIata: 'JFK',
      arrIata: 'CDG',
      airlineCode: 'AFR',
    });
  });

  it('batches at 100 planes per POST', async () => {
    // 250 planes -> 3 batches (100, 100, 50)
    const planes = Array.from({ length: 250 }, (_, i) => ({
      callsign: `CS${i}`, lat: 1 + i * 0.001, lng: 2 + i * 0.001,
    }));

    // Each batch response: 1 valid row + 1 unknown
    axios.post.mockResolvedValue({
      data: [
        {
          callsign: 'X',
          _airport_codes_iata: 'LAX-ICN',
          _airports: [{ iata: 'LAX', icao: 'KLAX' }, { iata: 'ICN', icao: 'RKSI' }],
          airline_code: 'KAL',
        },
        { callsign: 'Y', _airport_codes_iata: 'unknown-unknown', _airports: [] },
      ],
    });

    const routes = await adsblolService.resolveRoutes(planes);

    expect(axios.post).toHaveBeenCalledTimes(3);
    // verify batch sizes on the posted payload
    const sizes = axios.post.mock.calls.map(c => c[1].planes.length);
    expect(sizes).toEqual([100, 100, 50]);
    // 1 valid per batch = 3 total
    expect(routes).toHaveLength(3);
    expect(routes.every(r => r.depIata === 'LAX' && r.arrIata === 'ICN')).toBe(true);
  });

  it('returns [] for empty input', async () => {
    const routes = await adsblolService.resolveRoutes([]);
    expect(routes).toEqual([]);
    expect(axios.post).not.toHaveBeenCalled();
  });
});

describe('adsblolService.pullAndPersistType', () => {
  it('upserts one observed_route per resolved route with queried aircraft type', async () => {
    axios.get.mockResolvedValueOnce({
      data: {
        ac: [
          { flight: 'BAW178', lat: 51, lon: 0, hex: 'a', r: 'G-1' },
          { flight: 'AFR006', lat: 40, lon: -74, hex: 'b', r: 'F-1' },
          { flight: 'QFA11',  lat: -33, lon: 151, hex: 'c', r: 'V-1' },
        ],
      },
    });
    axios.post.mockResolvedValueOnce({
      data: [
        { callsign: 'BAW178', _airport_codes_iata: 'LHR-JFK', _airports: [{iata:'LHR',icao:'EGLL'},{iata:'JFK',icao:'KJFK'}], airline_code: 'BAW' },
        { callsign: 'AFR006', _airport_codes_iata: 'JFK-CDG', _airports: [{iata:'JFK',icao:'KJFK'},{iata:'CDG',icao:'LFPG'}], airline_code: 'AFR' },
        { callsign: 'QFA11',  _airport_codes_iata: 'unknown-unknown', _airports: [] },
      ],
    });

    const result = await adsblolService.pullAndPersistType('A359');

    expect(result).toEqual({ fetched: 3, resolved: 2, persisted: 2 });
    expect(db.upsertObservedRoute).toHaveBeenCalledTimes(2);
    expect(db.upsertObservedRoute).toHaveBeenCalledWith({
      depIata: 'LHR', arrIata: 'JFK', aircraftIcao: 'A359', airlineIata: 'BAW',
    });
    expect(db.upsertObservedRoute).toHaveBeenCalledWith({
      depIata: 'JFK', arrIata: 'CDG', aircraftIcao: 'A359', airlineIata: 'AFR',
    });
  });

  it('returns zero counts and skips all I/O when service disabled', async () => {
    process.env.ADSBLOL_ENABLED = '0';
    try {
      const result = await adsblolService.pullAndPersistType('A359');
      expect(result).toEqual({ fetched: 0, resolved: 0, persisted: 0 });
      expect(axios.get).not.toHaveBeenCalled();
      expect(axios.post).not.toHaveBeenCalled();
      expect(db.upsertObservedRoute).not.toHaveBeenCalled();
    } finally {
      process.env.ADSBLOL_ENABLED = '1';
    }
  });

  it('returns zero counts when no aircraft are returned', async () => {
    axios.get.mockResolvedValueOnce({ data: { ac: [] } });
    const result = await adsblolService.pullAndPersistType('A388');
    expect(result).toEqual({ fetched: 0, resolved: 0, persisted: 0 });
    expect(axios.post).not.toHaveBeenCalled();
    expect(db.upsertObservedRoute).not.toHaveBeenCalled();
  });
});
