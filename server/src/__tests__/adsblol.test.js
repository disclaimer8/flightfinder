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

jest.mock('../services/adsbdbService', () => ({
  isEnabled: () => true,
  resolveCallsign: jest.fn(),
}));
const adsbdbService = require('../services/adsbdbService');

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

describe('adsblolService.resolveRoutes (via adsbdbService)', () => {
  beforeEach(() => {
    adsbdbService.resolveCallsign.mockReset();
  });

  it('returns [] when disabled', async () => {
    process.env.ADSBLOL_ENABLED = '0';
    try {
      const r = await adsblolService.resolveRoutes([{ callsign: 'BAW213', lat: 0, lng: 0 }]);
      expect(r).toEqual([]);
      expect(adsbdbService.resolveCallsign).not.toHaveBeenCalled();
    } finally {
      process.env.ADSBLOL_ENABLED = '1';
    }
  });

  it('calls adsbdbService.resolveCallsign once per plane and maps shape', async () => {
    adsbdbService.resolveCallsign
      .mockResolvedValueOnce({ depIata: 'LHR', arrIata: 'JFK', depIcao: 'EGLL', arrIcao: 'KJFK', airlineIata: 'BA', airlineIcao: 'BAW' })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ depIata: 'CDG', arrIata: 'NRT', depIcao: 'LFPG', arrIcao: 'RJAA', airlineIata: 'AF', airlineIcao: 'AFR' });

    const planes = [
      { callsign: 'BAW213', lat: 51.4, lng: -0.4 },
      { callsign: 'UNKWN1', lat: 0, lng: 0 },
      { callsign: 'AFR006', lat: 49.0, lng: 2.5 },
    ];
    const r = await adsblolService.resolveRoutes(planes);

    expect(adsbdbService.resolveCallsign).toHaveBeenCalledTimes(3);
    expect(r).toHaveLength(2);
    expect(r.find(x => x.callsign === 'BAW213')).toMatchObject({ depIata: 'LHR', arrIata: 'JFK', airlineCode: 'BAW' });
    expect(r.find(x => x.callsign === 'AFR006')).toMatchObject({ depIata: 'CDG', arrIata: 'NRT', airlineCode: 'AFR' });
  });

  it('skips planes where adsbdb returns null', async () => {
    adsbdbService.resolveCallsign.mockResolvedValue(null);
    const r = await adsblolService.resolveRoutes([
      { callsign: 'X', lat: 0, lng: 0 },
      { callsign: 'Y', lat: 0, lng: 0 },
    ]);
    expect(r).toEqual([]);
  });

  it('returns [] for empty input', async () => {
    const r = await adsblolService.resolveRoutes([]);
    expect(r).toEqual([]);
    expect(adsbdbService.resolveCallsign).not.toHaveBeenCalled();
  });

  it('dedupes duplicate callsigns before calling adsbdbService', async () => {
    adsbdbService.resolveCallsign.mockResolvedValue({
      depIata: 'LHR', arrIata: 'JFK', depIcao: null, arrIcao: null, airlineIata: null, airlineIcao: 'BAW',
    });
    const planes = [
      { callsign: 'BAW213', lat: 0, lng: 0 },
      { callsign: 'BAW213', lat: 1, lng: 1 },  // duplicate callsign, different position
      { callsign: 'BAW213', lat: 2, lng: 2 },  // another duplicate
    ];
    const r = await adsblolService.resolveRoutes(planes);
    expect(adsbdbService.resolveCallsign).toHaveBeenCalledTimes(1);
    expect(r).toHaveLength(1);
  });
});

describe('adsblolService.pullAndPersistType', () => {
  beforeEach(() => {
    adsbdbService.resolveCallsign.mockReset();
  });

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
    adsbdbService.resolveCallsign
      .mockImplementation(async (callsign) => {
        if (callsign === 'BAW178') return { depIata: 'LHR', arrIata: 'JFK', depIcao: 'EGLL', arrIcao: 'KJFK', airlineIata: null, airlineIcao: 'BAW' };
        if (callsign === 'AFR006') return { depIata: 'JFK', arrIata: 'CDG', depIcao: 'KJFK', arrIcao: 'LFPG', airlineIata: null, airlineIcao: 'AFR' };
        return null; // QFA11
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
      expect(adsbdbService.resolveCallsign).not.toHaveBeenCalled();
      expect(db.upsertObservedRoute).not.toHaveBeenCalled();
    } finally {
      process.env.ADSBLOL_ENABLED = '1';
    }
  });

  it('returns zero counts when no aircraft are returned', async () => {
    axios.get.mockResolvedValueOnce({ data: { ac: [] } });
    const result = await adsblolService.pullAndPersistType('A388');
    expect(result).toEqual({ fetched: 0, resolved: 0, persisted: 0 });
    expect(adsbdbService.resolveCallsign).not.toHaveBeenCalled();
    expect(db.upsertObservedRoute).not.toHaveBeenCalled();
  });
});

describe('adsblolService.pullAndPersistType (silent-fail tripwire)', () => {
  let warnSpy;
  let getAircraftByTypeSpy;
  let resolveRoutesSpy;

  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    getAircraftByTypeSpy = jest.spyOn(adsblolService, 'getAircraftByType');
    resolveRoutesSpy     = jest.spyOn(adsblolService, 'resolveRoutes');
  });

  afterEach(() => {
    warnSpy.mockRestore();
    getAircraftByTypeSpy.mockRestore();
    resolveRoutesSpy.mockRestore();
  });

  it('warns "silent-fail tripwire" when fetched>0 but persisted=0', async () => {
    getAircraftByTypeSpy.mockResolvedValueOnce([
      { callsign: 'X', lat: 0, lng: 0, type: 'B738' },
      { callsign: 'Y', lat: 0, lng: 0, type: 'B738' },
    ]);
    resolveRoutesSpy.mockResolvedValueOnce([]);  // 0 resolved
    await adsblolService.pullAndPersistType('B738');
    const tripwireCalls = warnSpy.mock.calls.filter(c => String(c[0]).includes('silent-fail tripwire'));
    expect(tripwireCalls.length).toBe(1);
    expect(tripwireCalls[0][0]).toMatch(/fetched=2/);
    expect(tripwireCalls[0][0]).toMatch(/persisted=0/);
  });

  it('does NOT warn when fetched=0', async () => {
    getAircraftByTypeSpy.mockResolvedValueOnce([]);
    await adsblolService.pullAndPersistType('B738');
    const tripwireCalls = warnSpy.mock.calls.filter(c => String(c[0]).includes('silent-fail tripwire'));
    expect(tripwireCalls.length).toBe(0);
  });

  it('does NOT warn when fetched>0 and persisted>0', async () => {
    getAircraftByTypeSpy.mockResolvedValueOnce([{ callsign: 'X', lat: 0, lng: 0, type: 'B738' }]);
    resolveRoutesSpy.mockResolvedValueOnce([{
      callsign: 'X', depIata: 'LHR', arrIata: 'JFK', depIcao: null, arrIcao: null, airlineCode: 'BAW',
    }]);
    await adsblolService.pullAndPersistType('B738');
    const tripwireCalls = warnSpy.mock.calls.filter(c => String(c[0]).includes('silent-fail tripwire'));
    expect(tripwireCalls.length).toBe(0);
  });
});
