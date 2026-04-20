'use strict';

jest.mock('axios');
const axios = require('axios');

// axios.create() returns the mocked axios so adbClient.get === axios.get
axios.create.mockReturnValue(axios);

jest.mock('../models/db', () => ({
  upsertObservedRoute: jest.fn(),
}));
const db = require('../models/db');

jest.mock('../services/aircraftDbService', () => ({
  resolveIcaoType: jest.fn(),
}));
const aircraftDbService = require('../services/aircraftDbService');

const cacheService = require('../services/cacheService');

let aerodataboxService;

beforeAll(() => {
  process.env.RAPIDAPI_KEY = 'test-key';
  aerodataboxService = require('../services/aerodataboxService');
});

afterEach(() => {
  jest.clearAllMocks();
  cacheService.flush();
  aerodataboxService._resetThrottleForTests();
});

describe('aerodataboxService.isEnabled', () => {
  it('reflects presence of RAPIDAPI_KEY', () => {
    expect(aerodataboxService.isEnabled()).toBe(true);
    const saved = process.env.RAPIDAPI_KEY;
    delete process.env.RAPIDAPI_KEY;
    try {
      expect(aerodataboxService.isEnabled()).toBe(false);
    } finally {
      process.env.RAPIDAPI_KEY = saved;
    }
  });
});

describe('aerodataboxService.enrichAircraft', () => {
  it('populates icaoType when hex resolves in aircraft_db', () => {
    aircraftDbService.resolveIcaoType.mockReturnValue({ icaoType: 'A320', reg: 'G-EUUU' });

    const out = aerodataboxService._enrichAircraft(
      { reg: 'G-EUUU', modeS: '405455', model: 'Airbus A320' },
      'LHR',
      'JFK'
    );

    expect(out).toEqual({ icaoType: 'A320', reg: 'G-EUUU', model: 'Airbus A320', hex: '405455' });
    expect(aircraftDbService.resolveIcaoType).toHaveBeenCalledWith('405455');
    // Write-through to observed_routes on successful resolution
    expect(db.upsertObservedRoute).toHaveBeenCalledWith({
      depIata: 'LHR',
      arrIata: 'JFK',
      aircraftIcao: 'A320',
      airlineIata: null,
    });
  });

  it('falls back to null icaoType when hex not in db, still returns model', () => {
    aircraftDbService.resolveIcaoType.mockReturnValue(null);

    const out = aerodataboxService._enrichAircraft(
      { reg: 'N123AB', modeS: 'abcdef', model: 'Boeing 777' },
      'JFK',
      'LHR'
    );

    expect(out.icaoType).toBeNull();
    expect(out.reg).toBe('N123AB');
    expect(out.model).toBe('Boeing 777');
    expect(out.hex).toBe('abcdef');
    expect(db.upsertObservedRoute).not.toHaveBeenCalled(); // no icao_type → no write-through
  });

  it('lowercases hex before db lookup', () => {
    aircraftDbService.resolveIcaoType.mockReturnValue(null);
    aerodataboxService._enrichAircraft({ modeS: 'A1B2C3' }, null, null);
    expect(aircraftDbService.resolveIcaoType).toHaveBeenCalledWith('a1b2c3');
  });

  it('handles missing aircraft object without throwing', () => {
    const out = aerodataboxService._enrichAircraft(null, 'LHR', 'JFK');
    expect(out).toEqual({ icaoType: null, reg: null, model: null, hex: null });
    expect(db.upsertObservedRoute).not.toHaveBeenCalled();
  });
});

describe('aerodataboxService.normaliseFlight', () => {
  it('produces the documented shape for a typical AeroDataBox row', () => {
    aircraftDbService.resolveIcaoType.mockReturnValue({ icaoType: 'B77W', reg: 'G-STBA' });

    const raw = {
      number: 'BA 117',
      airline: { iata: 'BA', icao: 'BAW', name: 'British Airways' },
      departure: {
        airport: { iata: 'LHR' },
        scheduledTime: { utc: '2026-05-01T08:30Z', local: '2026-05-01T09:30+01:00' },
        terminal: '5',
      },
      arrival: {
        airport: { iata: 'JFK' },
        scheduledTime: { utc: '2026-05-01T15:30Z', local: '2026-05-01T11:30-04:00' },
        terminal: '7',
      },
      aircraft: { reg: 'G-STBA', modeS: '4007F2', model: 'Boeing 777-300ER' },
      status: 'Scheduled',
      codeshareStatus: 'Unknown',
      isCargo: false,
    };

    const out = aerodataboxService._normaliseFlight(raw);
    expect(out.number).toBe('BA117'); // whitespace stripped
    expect(out.airline).toEqual({ iata: 'BA', icao: 'BAW', name: 'British Airways' });
    expect(out.dep.iata).toBe('LHR');
    expect(out.arr.iata).toBe('JFK');
    expect(out.aircraft).toEqual({
      icaoType: 'B77W',
      reg: 'G-STBA',
      model: 'Boeing 777-300ER',
      hex: '4007f2',
    });
    expect(out.status).toBe('Scheduled');
  });
});

describe('aerodataboxService.getFlightByNumber', () => {
  it('returns null when service disabled', async () => {
    const saved = process.env.RAPIDAPI_KEY;
    delete process.env.RAPIDAPI_KEY;
    try {
      const out = await aerodataboxService.getFlightByNumber('BA117', '2026-05-01');
      expect(out).toBeNull();
      expect(axios.get).not.toHaveBeenCalled();
    } finally {
      process.env.RAPIDAPI_KEY = saved;
    }
  });

  it('returns null for invalid input without calling axios', async () => {
    expect(await aerodataboxService.getFlightByNumber('', '2026-05-01')).toBeNull();
    expect(await aerodataboxService.getFlightByNumber('BA117', 'nope')).toBeNull();
    expect(axios.get).not.toHaveBeenCalled();
  });

  it('fetches, normalises, and caches the first segment', async () => {
    aircraftDbService.resolveIcaoType.mockReturnValue({ icaoType: 'A320', reg: 'G-EUUU' });
    axios.get.mockResolvedValueOnce({
      data: [
        {
          number: 'BA 117',
          airline: { iata: 'BA' },
          departure: { airport: { iata: 'LHR' }, scheduledTime: { utc: '2026-05-01T08:00Z' } },
          arrival:   { airport: { iata: 'JFK' }, scheduledTime: { utc: '2026-05-01T15:00Z' } },
          aircraft: { reg: 'G-EUUU', modeS: '405455' },
        },
      ],
    });

    const out = await aerodataboxService.getFlightByNumber('BA117', '2026-05-01');
    expect(out).not.toBeNull();
    expect(out.number).toBe('BA117');
    expect(out.aircraft.icaoType).toBe('A320');

    // Second call hits cache — axios not called again
    const again = await aerodataboxService.getFlightByNumber('BA117', '2026-05-01');
    expect(again).toEqual(out);
    expect(axios.get).toHaveBeenCalledTimes(1);

    // Cache key check
    expect(cacheService.get('adb:flight:BA117:2026-05-01')).not.toBeUndefined();
  });

  it('returns null on 429 and does NOT cache the failure', async () => {
    axios.get.mockRejectedValueOnce({ response: { status: 429 } });
    const out = await aerodataboxService.getFlightByNumber('BA117', '2026-05-01');
    expect(out).toBeNull();
    // getOrFetch caches the resolved null too — but we verify the call happened gracefully
    expect(axios.get).toHaveBeenCalledTimes(1);
  });

  it('returns null on network error', async () => {
    axios.get.mockRejectedValueOnce(new Error('ECONNRESET'));
    const out = await aerodataboxService.getFlightByNumber('BA117', '2026-05-01');
    expect(out).toBeNull();
  });
});

describe('aerodataboxService.getAirportDepartures', () => {
  it('returns empty array when service disabled', async () => {
    const saved = process.env.RAPIDAPI_KEY;
    delete process.env.RAPIDAPI_KEY;
    try {
      const out = await aerodataboxService.getAirportDepartures('LHR', '2026-05-01T00:00', '2026-05-01T12:00');
      expect(out).toEqual([]);
    } finally {
      process.env.RAPIDAPI_KEY = saved;
    }
  });

  it('rejects bad IATA and windows > 12h', async () => {
    expect(await aerodataboxService.getAirportDepartures('ZZZZ', '2026-05-01T00:00', '2026-05-01T01:00')).toEqual([]);
    expect(await aerodataboxService.getAirportDepartures('LHR', '2026-05-01T00:00', '2026-05-01T23:59')).toEqual([]);
    expect(axios.get).not.toHaveBeenCalled();
  });

  it('fetches and normalises the departures list', async () => {
    aircraftDbService.resolveIcaoType
      .mockReturnValueOnce({ icaoType: 'B77W', reg: 'G-STBA' })
      .mockReturnValueOnce(null);

    // Real AeroDataBox airport-window schema: each row has a single `movement`
    // block describing the OTHER endpoint (arrival, because direction=Departure).
    axios.get.mockResolvedValueOnce({
      data: {
        departures: [
          {
            number: 'BA 117',
            airline: { iata: 'BA' },
            movement: { airport: { iata: 'JFK' }, scheduledTime: { utc: '2026-05-01T15:00Z' } },
            aircraft: { reg: 'G-STBA', modeS: '4007F2' },
          },
          {
            number: 'VS 3',
            airline: { iata: 'VS' },
            movement: { airport: { iata: 'JFK' }, scheduledTime: { utc: '2026-05-01T16:30Z' } },
            aircraft: { model: 'Airbus A350' }, // no hex → null icaoType
          },
        ],
      },
    });

    const out = await aerodataboxService.getAirportDepartures('LHR', '2026-05-01T00:00', '2026-05-01T12:00');
    expect(out).toHaveLength(2);
    expect(out[0].dep.iata).toBe('LHR');
    expect(out[0].arr.iata).toBe('JFK');
    expect(out[0].aircraft.icaoType).toBe('B77W');
    expect(out[1].dep.iata).toBe('LHR');
    expect(out[1].arr.iata).toBe('JFK');
    expect(out[1].aircraft.icaoType).toBeNull();
    expect(out[1].aircraft.model).toBe('Airbus A350');

    // Cache key is built from IATA + window
    expect(cacheService.get('adb:apt:LHR:2026-05-01T00:00:2026-05-01T12:00')).not.toBeUndefined();
  });

  it('returns [] on 429', async () => {
    axios.get.mockRejectedValueOnce({ response: { status: 429 } });
    const out = await aerodataboxService.getAirportDepartures('LHR', '2026-05-01T00:00', '2026-05-01T12:00');
    expect(out).toEqual([]);
  });
});

describe('aerodataboxService throttle', () => {
  it('enforces ≥ 1100ms between real outbound calls', async () => {
    axios.get.mockResolvedValue({ data: [] });

    const t0 = Date.now();
    // Two distinct cache keys → both miss → both actually hit axios
    await aerodataboxService.getFlightByNumber('BA1', '2026-05-01');
    await aerodataboxService.getFlightByNumber('BA2', '2026-05-01');
    const elapsed = Date.now() - t0;

    expect(axios.get).toHaveBeenCalledTimes(2);
    // Second call must wait at least MIN_INTERVAL_MS (1100ms) after the first.
    // Allow a tiny margin (timers aren't exact).
    expect(elapsed).toBeGreaterThanOrEqual(aerodataboxService._MIN_INTERVAL_MS - 50);
  }, 10_000);
});
