// Tests for fr24Service.fetchRouteAircraftBuckets.
//
// Contract:
//   null  → not fetched (disabled, missing args, HTTP/transport error)
//   []    → fetched OK but no usable per-flight aircraft data
//   [...] → array of { aircraft_icao, airline_icao, sample_size }
//
// TOS-isolation rationale: raw lightRows never cross the service boundary;
// only derived per-(ac,al) counts are returned.

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  jest.resetModules();
  delete process.env.FR24_API_KEY;
});

afterAll(() => { process.env = ORIGINAL_ENV; });

describe('fr24Service.fetchRouteAircraftBuckets — disabled / arg guards', () => {
  it('returns null when isEnabled() is false (no FR24_API_KEY)', async () => {
    const fr24 = require('../services/fr24Service');
    expect(await fr24.fetchRouteAircraftBuckets('JFK', 'LHR')).toBeNull();
  });

  it('returns null when orig is empty', async () => {
    process.env.FR24_API_KEY = 'sandbox-test-key';
    const fr24 = require('../services/fr24Service');
    expect(await fr24.fetchRouteAircraftBuckets('', 'LHR')).toBeNull();
    expect(await fr24.fetchRouteAircraftBuckets(null, 'LHR')).toBeNull();
  });

  it('returns null when dest is empty', async () => {
    process.env.FR24_API_KEY = 'sandbox-test-key';
    const fr24 = require('../services/fr24Service');
    expect(await fr24.fetchRouteAircraftBuckets('JFK', '')).toBeNull();
    expect(await fr24.fetchRouteAircraftBuckets('JFK', undefined)).toBeNull();
  });
});

describe('fr24Service.fetchRouteAircraftBuckets — happy path / bucket derivation', () => {
  let mockGet;

  beforeEach(() => {
    process.env.FR24_API_KEY = 'sandbox-test-key';
    jest.resetModules();
    mockGet = jest.fn();
    jest.doMock('axios', () => ({ create: () => ({ get: mockGet }) }));
    jest.spyOn(global, 'setTimeout').mockImplementation((cb) => { cb(); return 0; });
  });

  afterEach(() => {
    jest.dontMock('axios');
    jest.restoreAllMocks();
  });

  it('returns [] when _fetchLight returns empty lightRows', async () => {
    mockGet.mockResolvedValueOnce({ data: { data: [] } });
    const fr24 = require('../services/fr24Service');
    expect(await fr24.fetchRouteAircraftBuckets('JFK', 'LHR')).toEqual([]);
  });

  it('groups rows by (aircraft_icao, airline_icao) and counts sample_size', async () => {
    mockGet.mockResolvedValueOnce({
      data: { data: [
        { aircraft_icao_type: 'B77W', operating_as: 'BAW' },
        { aircraft_icao_type: 'B77W', operating_as: 'BAW' },
        { aircraft_icao_type: 'B77W', operating_as: 'BAW' },
        { aircraft_icao_type: 'A332', operating_as: 'AAL' },
      ] },
    });
    const fr24 = require('../services/fr24Service');
    const out = await fr24.fetchRouteAircraftBuckets('LHR', 'JFK');
    expect(out).toHaveLength(2);
    const byAc = Object.fromEntries(out.map(b => [b.aircraft_icao, b]));
    expect(byAc.B77W).toEqual({ aircraft_icao: 'B77W', airline_icao: 'BAW', sample_size: 3 });
    expect(byAc.A332).toEqual({ aircraft_icao: 'A332', airline_icao: 'AAL', sample_size: 1 });
  });

  it('handles operated_as / operating_as field drift', async () => {
    mockGet.mockResolvedValueOnce({
      data: { data: [
        { aircraft_icao_type: 'B77W', operated_as: 'BAW' },    // /full schema variant
        { aircraft_icao_type: 'B77W', operating_as: 'BAW' },   // /light schema variant
      ] },
    });
    const fr24 = require('../services/fr24Service');
    const out = await fr24.fetchRouteAircraftBuckets('LHR', 'JFK');
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({ aircraft_icao: 'B77W', airline_icao: 'BAW', sample_size: 2 });
  });

  it('handles type / aircraft_icao_type field drift', async () => {
    mockGet.mockResolvedValueOnce({
      data: { data: [
        { type: 'B77W', operating_as: 'BAW' },                 // older field name
        { aircraft_icao_type: 'B77W', operating_as: 'BAW' },   // current
      ] },
    });
    const fr24 = require('../services/fr24Service');
    const out = await fr24.fetchRouteAircraftBuckets('LHR', 'JFK');
    expect(out).toHaveLength(1);
    expect(out[0].sample_size).toBe(2);
  });

  it('skips rows without aircraft type', async () => {
    mockGet.mockResolvedValueOnce({
      data: { data: [
        { aircraft_icao_type: 'B77W', operating_as: 'BAW' },
        { operating_as: 'BAW' },                               // no type → skip
        { aircraft_icao_type: null, operating_as: 'BAW' },     // null type → skip
      ] },
    });
    const fr24 = require('../services/fr24Service');
    const out = await fr24.fetchRouteAircraftBuckets('LHR', 'JFK');
    expect(out).toHaveLength(1);
    expect(out[0].sample_size).toBe(1);
  });

  it("uses '' sentinel for missing airline", async () => {
    mockGet.mockResolvedValueOnce({
      data: { data: [
        { aircraft_icao_type: 'B77W' },                        // no carrier
        { aircraft_icao_type: 'B77W', operating_as: null },    // null carrier
        { aircraft_icao_type: 'B77W', operating_as: '' },      // empty string carrier
      ] },
    });
    const fr24 = require('../services/fr24Service');
    const out = await fr24.fetchRouteAircraftBuckets('LHR', 'JFK');
    expect(out).toHaveLength(1);
    expect(out[0].airline_icao).toBe('');
    expect(out[0].sample_size).toBe(3);
  });

  it('passes routes=ORIG-DEST in URL params', async () => {
    mockGet.mockResolvedValueOnce({ data: { data: [] } });
    const fr24 = require('../services/fr24Service');
    await fr24.fetchRouteAircraftBuckets('JFK', 'LHR');
    expect(mockGet).toHaveBeenCalledTimes(1);
    expect(mockGet.mock.calls[0][0]).toBe('/flight-summary/light');
    expect(mockGet.mock.calls[0][1].params.routes).toBe('JFK-LHR');
  });
});

describe('fr24Service.fetchRouteAircraftBuckets — error handling', () => {
  let mockGet;

  beforeEach(() => {
    process.env.FR24_API_KEY = 'sandbox-test-key';
    jest.resetModules();
    mockGet = jest.fn();
    jest.doMock('axios', () => ({ create: () => ({ get: mockGet }) }));
    jest.spyOn(global, 'setTimeout').mockImplementation((cb) => { cb(); return 0; });
  });

  afterEach(() => {
    jest.dontMock('axios');
    jest.restoreAllMocks();
  });

  it('401 → null + warn (does not throw)', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockGet.mockRejectedValueOnce({ response: { status: 401 } });
    const fr24 = require('../services/fr24Service');
    expect(await fr24.fetchRouteAircraftBuckets('JFK', 'LHR')).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('auth error'));
    warn.mockRestore();
  });

  it('429 with retry exhausted → null', async () => {
    mockGet
      .mockRejectedValueOnce({ response: { status: 429 } })
      .mockRejectedValueOnce({ response: { status: 429 } });
    const fr24 = require('../services/fr24Service');
    expect(await fr24.fetchRouteAircraftBuckets('JFK', 'LHR')).toBeNull();
    expect(mockGet).toHaveBeenCalledTimes(2);
  });

  it('generic network error → null (does not throw)', async () => {
    mockGet.mockRejectedValue(new Error('network exploded'));
    const fr24 = require('../services/fr24Service');
    await expect(fr24.fetchRouteAircraftBuckets('JFK', 'LHR')).resolves.toBeNull();
  });
});
