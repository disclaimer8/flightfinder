'use strict';

// Mock the db model — we verify bootstrap calls the right db mutators without
// touching real SQLite.
jest.mock('../models/db', () => ({
  aircraftDbSize: jest.fn(),
  bulkUpsertAircraft: jest.fn(),
  getAircraftByHex: jest.fn(),
  upsertAircraft: jest.fn(),
}));
const db = require('../models/db');

const aircraftDbService = require('../services/aircraftDbService');

afterEach(() => {
  jest.clearAllMocks();
});

describe('aircraftDbService._parseMictronicsDict', () => {
  it('lowercases hex and extracts reg + icao_type', () => {
    const rows = aircraftDbService._parseMictronicsDict({
      '000005': { r: '5N-BXF', t: 'E145', f: '00', d: 'Embraer ERJ-145-LR' },
      'ABCDEF': { r: 'G-XWBA', t: 'A359' },
      'badrow': null,
      'empty':  {}, // produces {hex:'empty', reg:null, icaoType:null}
    });
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual({ hex: '000005', reg: '5N-BXF', icaoType: 'E145' });
    expect(rows[1]).toEqual({ hex: 'abcdef', reg: 'G-XWBA', icaoType: 'A359' });
    expect(rows[2]).toEqual({ hex: 'empty', reg: null, icaoType: null });
  });

  it('returns [] for non-object input', () => {
    expect(aircraftDbService._parseMictronicsDict(null)).toEqual([]);
    expect(aircraftDbService._parseMictronicsDict(undefined)).toEqual([]);
    expect(aircraftDbService._parseMictronicsDict('x')).toEqual([]);
  });
});

describe('aircraftDbService.resolveIcaoType', () => {
  it('returns {icaoType, reg} when hex is in db', () => {
    db.getAircraftByHex.mockReturnValue({ hex: '405455', icao_type: 'A320', reg: 'G-EUUU' });
    expect(aircraftDbService.resolveIcaoType('405455')).toEqual({
      icaoType: 'A320',
      reg: 'G-EUUU',
    });
  });

  it('returns null when hex is unknown', () => {
    db.getAircraftByHex.mockReturnValue(null);
    expect(aircraftDbService.resolveIcaoType('ffffff')).toBeNull();
  });
});

describe('aircraftDbService.bootstrap', () => {
  // Replace the network layer with a stub returning our synthetic dataset.
  const syntheticDict = {
    '000001': { r: 'TEST-1', t: 'A320' },
    '000002': { r: 'TEST-2', t: 'B738' },
    '000003': { r: 'TEST-3', t: 'A359' },
  };
  const syntheticJson = JSON.stringify(syntheticDict);

  it('is a no-op when aircraft_db already has > threshold rows', async () => {
    db.aircraftDbSize.mockReturnValue(500_000);

    const result = await aircraftDbService.bootstrap();

    expect(result).toEqual({ inserted: 0, skipped: true, size: 500_000 });
    expect(db.bulkUpsertAircraft).not.toHaveBeenCalled();
  });

  it('downloads, parses, and bulk-upserts rows when threshold not met', async () => {
    db.aircraftDbSize
      .mockReturnValueOnce(0)    // pre-bootstrap
      .mockReturnValueOnce(3);   // post-bootstrap

    // Override the download helper on the exported module
    const origDownload = aircraftDbService._downloadText;
    aircraftDbService._downloadText = jest.fn().mockResolvedValue(syntheticJson);

    try {
      // Need to re-require the service so the overridden _downloadText is actually
      // what bootstrap() invokes. The module captures the local function reference
      // at require-time, so instead we inject via opts.url + mock https — BUT the
      // spec wants a simpler approach: use jest.spyOn on https.get.
      //
      // Re-mount: restore, then spyOn https.get.
      aircraftDbService._downloadText = origDownload;

      const https = require('https');
      const spy = jest.spyOn(https, 'get').mockImplementation((_url, cb) => {
        const { Readable } = require('stream');
        const res = new Readable({ read() {} });
        res.statusCode = 200;
        res.headers = {};
        cb(res);
        res.push(syntheticJson);
        res.push(null);
        // Return a minimal req object exposing on/setTimeout/destroy
        return { on: () => {}, setTimeout: () => {}, destroy: () => {} };
      });

      const result = await aircraftDbService.bootstrap({ force: false });

      expect(spy).toHaveBeenCalled();
      expect(db.bulkUpsertAircraft).toHaveBeenCalledTimes(1);
      const batch = db.bulkUpsertAircraft.mock.calls[0][0];
      expect(batch).toHaveLength(3);
      expect(batch[0]).toEqual({ hex: '000001', reg: 'TEST-1', icaoType: 'A320' });
      expect(result.inserted).toBe(3);
      expect(result.skipped).toBe(false);
      expect(result.size).toBe(3);
      spy.mockRestore();
    } finally {
      aircraftDbService._downloadText = origDownload;
    }
  });

  it('honours force=true to re-run even when threshold already met', async () => {
    db.aircraftDbSize
      .mockReturnValueOnce(500_000)  // pre
      .mockReturnValueOnce(500_003); // post

    const https = require('https');
    const spy = jest.spyOn(https, 'get').mockImplementation((_url, cb) => {
      const { Readable } = require('stream');
      const res = new Readable({ read() {} });
      res.statusCode = 200;
      res.headers = {};
      cb(res);
      res.push(syntheticJson);
      res.push(null);
      return { on: () => {}, setTimeout: () => {}, destroy: () => {} };
    });

    try {
      const result = await aircraftDbService.bootstrap({ force: true });
      expect(result.skipped).toBe(false);
      expect(db.bulkUpsertAircraft).toHaveBeenCalledTimes(1);
      expect(result.inserted).toBe(3);
    } finally {
      spy.mockRestore();
    }
  });
});
