'use strict';

jest.mock('axios');
const axios = require('axios');
axios.create.mockReturnValue(axios);

let adsbdbService;
let db;

beforeAll(() => {
  process.env.ADSBDB_ENABLED = '1';
  db = require('../models/db').db;
  adsbdbService = require('../services/adsbdbService');
});

afterEach(() => {
  jest.clearAllMocks();
  db.exec('DELETE FROM adsbdb_callsign_cache');
});

const ok = (cs = 'BAW213') => ({
  data: {
    response: {
      flightroute: {
        callsign: cs, callsign_iata: 'BA213',
        airline: { name: 'British Airways', iata: 'BA', icao: 'BAW' },
        origin: { iata_code: 'LHR', icao_code: 'EGLL', name: 'Heathrow' },
        destination: { iata_code: 'JFK', icao_code: 'KJFK', name: 'JFK' },
      },
    },
  },
});

describe('adsbdbService.resolveCallsign', () => {
  it('resolves 200 response, writes cache, returns shape', async () => {
    axios.get.mockResolvedValueOnce(ok('BAW213'));
    const r = await adsbdbService.resolveCallsign('BAW213');
    expect(r).toEqual({
      depIata: 'LHR', arrIata: 'JFK',
      depIcao: 'EGLL', arrIcao: 'KJFK',
      airlineIata: 'BA', airlineIcao: 'BAW',
    });
    const row = db.prepare('SELECT * FROM adsbdb_callsign_cache WHERE callsign=?').get('BAW213');
    expect(row.dep_iata).toBe('LHR');
    expect(row.expires_at).toBeGreaterThan(Date.now() + 6 * 24 * 3600 * 1000);
  });

  it('reads from cache on second call (no axios)', async () => {
    axios.get.mockResolvedValueOnce(ok('BAW213'));
    await adsbdbService.resolveCallsign('BAW213');
    axios.get.mockClear();
    const r2 = await adsbdbService.resolveCallsign('BAW213');
    expect(r2.depIata).toBe('LHR');
    expect(axios.get).not.toHaveBeenCalled();
  });

  it('404 caches negative and returns null', async () => {
    const err404 = new Error('not found');
    err404.response = { status: 404 };
    axios.get.mockRejectedValueOnce(err404);
    const r = await adsbdbService.resolveCallsign('UNKNOWN1');
    expect(r).toBeNull();
    const row = db.prepare('SELECT * FROM adsbdb_callsign_cache WHERE callsign=?').get('UNKNOWN1');
    expect(row).toBeDefined();
    expect(row.dep_iata).toBeNull();
    expect(row.expires_at).toBeGreaterThan(Date.now() + 23 * 3600 * 1000);
    expect(row.expires_at).toBeLessThan(Date.now() + 25 * 3600 * 1000);
  });

  it('429 retries once after backoff then returns null without caching', async () => {
    const err429 = new Error('rate limited');
    err429.response = { status: 429 };
    axios.get.mockRejectedValueOnce(err429).mockRejectedValueOnce(err429);
    const r = await adsbdbService.resolveCallsign('RATE1');
    expect(r).toBeNull();
    expect(axios.get).toHaveBeenCalledTimes(2);
    const row = db.prepare('SELECT * FROM adsbdb_callsign_cache WHERE callsign=?').get('RATE1');
    expect(row).toBeUndefined();
  }, 15000);

  it('network/5xx returns null and does not cache', async () => {
    axios.get.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const r = await adsbdbService.resolveCallsign('NETERR1');
    expect(r).toBeNull();
    const row = db.prepare('SELECT * FROM adsbdb_callsign_cache WHERE callsign=?').get('NETERR1');
    expect(row).toBeUndefined();
  });

  it('returns null when disabled via env without calling axios', async () => {
    const prev = process.env.ADSBDB_ENABLED;
    process.env.ADSBDB_ENABLED = '0';
    try {
      const r = await adsbdbService.resolveCallsign('BAW213');
      expect(r).toBeNull();
      expect(axios.get).not.toHaveBeenCalled();
    } finally {
      process.env.ADSBDB_ENABLED = prev;
    }
  });

  it('normalizes callsign (trim + uppercase) for cache key', async () => {
    axios.get.mockResolvedValueOnce(ok('BAW213'));
    await adsbdbService.resolveCallsign('  baw213  ');
    const row = db.prepare('SELECT callsign FROM adsbdb_callsign_cache').get();
    expect(row.callsign).toBe('BAW213');
  });

  it('malformed 200 (missing iata_code) returns null and does NOT cache', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      axios.get.mockResolvedValueOnce({
        data: { response: { flightroute: {
          callsign: 'MALF1', callsign_iata: 'MA1',
          airline: { name: 'X', iata: 'X', icao: 'XXX' },
          origin: { icao_code: 'EGLL', name: 'Heathrow' },           // ← no iata_code
          destination: { iata_code: 'JFK', icao_code: 'KJFK', name: 'JFK' },
        } } },
      });
      const r = await adsbdbService.resolveCallsign('MALF1');
      expect(r).toBeNull();
      const row = db.prepare('SELECT * FROM adsbdb_callsign_cache WHERE callsign=?').get('MALF1');
      expect(row).toBeUndefined();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('malformed 200'));
    } finally {
      warnSpy.mockRestore();
    }
  });
});
