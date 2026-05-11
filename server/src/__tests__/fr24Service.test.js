// Reset env before each test that touches isEnabled()
const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  jest.resetModules();
  delete process.env.FR24_API_KEY;
});

afterAll(() => { process.env = ORIGINAL_ENV; });

describe('fr24Service module shell', () => {
  it('exports the public API surface', () => {
    const fr24 = require('../services/fr24Service');
    expect(typeof fr24.isEnabled).toBe('function');
    expect(typeof fr24.fetchVariantStats).toBe('function');
    expect(typeof fr24.fetchFamilyStats).toBe('function');
    expect(typeof fr24.fetchRouteStats).toBe('function');
  });

  it('isEnabled returns false when FR24_API_KEY is absent', () => {
    const fr24 = require('../services/fr24Service');
    expect(fr24.isEnabled()).toBe(false);
  });

  it('isEnabled returns true when FR24_API_KEY is set', () => {
    process.env.FR24_API_KEY = 'sandbox-test-key';
    const fr24 = require('../services/fr24Service');
    expect(fr24.isEnabled()).toBe(true);
  });

  it('all fetch methods return null without HTTP when disabled', async () => {
    const fr24 = require('../services/fr24Service');
    expect(await fr24.fetchVariantStats('B789')).toBeNull();
    expect(await fr24.fetchFamilyStats(['B789'])).toBeNull();
    expect(await fr24.fetchRouteStats('JFK', 'LHR')).toBeNull();
  });
});

// All fetch methods make a SINGLE call to /flight-summary/light. The previous
// /flight-summary/count call was removed: that endpoint is not in any documented
// FR24 subscription tier and returned 403 in production. totalFlights is now
// derived from light rows (capped at 20000 per query).
describe('fr24Service.fetchVariantStats', () => {
  let mockGet;
  let setTimeoutSpy;

  beforeEach(() => {
    process.env.FR24_API_KEY = 'sandbox-test-key';
    jest.resetModules();
    mockGet = jest.fn();
    jest.doMock('axios', () => ({ create: () => ({ get: mockGet }) }));
    setTimeoutSpy = jest.spyOn(global, 'setTimeout').mockImplementation((cb) => { cb(); return 0; });
  });

  afterEach(() => {
    setTimeoutSpy.mockRestore();
    jest.dontMock('axios');
  });

  it('returns DerivedStats with totalFlights from rows.length, uniqueOperators, top5 lists', async () => {
    mockGet.mockResolvedValueOnce({
      data: { data: [
        { operating_as: 'ANA', orig_icao: 'RJTT', dest_icao: 'KLAX' },
        { operating_as: 'ANA', orig_icao: 'RJTT', dest_icao: 'KLAX' },
        { operating_as: 'ANA', orig_icao: 'RJAA', dest_icao: 'KSFO' },
        { operating_as: 'UAL', orig_icao: 'KSFO', dest_icao: 'EGLL' },
        { operating_as: 'BAW', orig_icao: 'EGLL', dest_icao: 'KSFO' },
      ] },
    });
    const fr24 = require('../services/fr24Service');
    const stats = await fr24.fetchVariantStats('B789');

    expect(stats).toMatchObject({
      totalFlights: 5,
      truncated: false,
      uniqueOperators: 3,
      windowDays: 30,
      yearlyBreakdown: null,
    });
    expect(stats.topOperators[0]).toEqual({ icao: 'ANA', count: 3 });
    expect(stats.topRoutes[0]).toEqual({ from: 'RJTT', to: 'KLAX', count: 2 });
    expect(typeof stats.fetchedAt).toBe('number');
  });

  it('reads alternate field names (origin_icao/destination_icao/operated_as)', async () => {
    mockGet.mockResolvedValueOnce({
      data: { data: [
        // /light docs say these field names; production has been seen using the /full names
        // (orig_icao / dest_icao / operating_as). Accept either.
        { operated_as: 'ANA', origin_icao: 'RJTT', destination_icao: 'KLAX' },
        { operated_as: 'ANA', origin_icao: 'RJTT', destination_icao: 'KLAX' },
      ] },
    });
    const fr24 = require('../services/fr24Service');
    const stats = await fr24.fetchVariantStats('B789');
    expect(stats.uniqueOperators).toBe(1);
    expect(stats.topOperators[0]).toEqual({ icao: 'ANA', count: 2 });
    expect(stats.topRoutes[0]).toEqual({ from: 'RJTT', to: 'KLAX', count: 2 });
  });

  it('caps top-5 lists at 5 entries even when more groups exist', async () => {
    const rows = [];
    for (const op of ['A','B','C','D','E','F','G']) rows.push({ operating_as: op, orig_icao: 'XX', dest_icao: 'YY' });
    mockGet.mockResolvedValueOnce({ data: { data: rows } });
    const fr24 = require('../services/fr24Service');
    const stats = await fr24.fetchVariantStats('B789');
    expect(stats.topOperators).toHaveLength(5);
  });

  it('passes aircraft=ICAO, 30-day window, and limit=20000 in URL params', async () => {
    mockGet.mockResolvedValueOnce({ data: { data: [] } });
    const fr24 = require('../services/fr24Service');
    await fr24.fetchVariantStats('B789');

    expect(mockGet).toHaveBeenCalledTimes(1);
    const call = mockGet.mock.calls[0];
    expect(call[0]).toBe('/flight-summary/light');
    expect(call[1].params.aircraft).toBe('B789');
    expect(call[1].params.limit).toBe(20000);
    expect(call[1].params.flight_datetime_from).toMatch(/^\d{4}-\d{2}-\d{2}/);
    expect(call[1].params.flight_datetime_to).toMatch(/^\d{4}-\d{2}-\d{2}/);
    // Verify the window is roughly 30 days
    const from = new Date(call[1].params.flight_datetime_from.replace(' ', 'T') + 'Z');
    const to = new Date(call[1].params.flight_datetime_to.replace(' ', 'T') + 'Z');
    const days = (to - from) / (24 * 3600 * 1000);
    expect(days).toBeGreaterThan(29);
    expect(days).toBeLessThanOrEqual(30);
  });

  it('returns derived with zeros when API returns empty data array', async () => {
    mockGet.mockResolvedValueOnce({ data: { data: [] } });
    const fr24 = require('../services/fr24Service');
    const stats = await fr24.fetchVariantStats('B789');
    expect(stats).toMatchObject({
      totalFlights: 0,
      uniqueOperators: 0,
      topOperators: [],
      topRoutes: [],
    });
  });

  it('sets truncated:true when rows hit the 20000 cap', async () => {
    const rows = Array.from({ length: 20000 }, () => ({ operating_as: 'X', orig_icao: 'AA', dest_icao: 'BB' }));
    mockGet.mockResolvedValueOnce({ data: { data: rows } });
    const fr24 = require('../services/fr24Service');
    const stats = await fr24.fetchVariantStats('B789');
    expect(stats.truncated).toBe(true);
    expect(stats.totalFlights).toBe(20000);
  });
});

describe('fr24Service.fetchFamilyStats', () => {
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

  it('joins ICAO list as comma-separated aircraft param', async () => {
    mockGet.mockResolvedValueOnce({ data: { data: [] } });
    const fr24 = require('../services/fr24Service');
    await fr24.fetchFamilyStats(['B737', 'B738', 'B739']);
    expect(mockGet.mock.calls[0][1].params.aircraft).toBe('B737,B738,B739');
  });

  it('caps ICAO list at 15 and warns when truncated', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const list = Array.from({ length: 17 }, (_, i) => `X${i.toString().padStart(3, '0')}`);
    mockGet.mockResolvedValueOnce({ data: { data: [] } });
    const fr24 = require('../services/fr24Service');
    await fr24.fetchFamilyStats(list);
    const sent = mockGet.mock.calls[0][1].params.aircraft.split(',');
    expect(sent).toHaveLength(15);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('truncated to 15'));
    warn.mockRestore();
  });

  it('returns null for empty or non-array input', async () => {
    const fr24 = require('../services/fr24Service');
    expect(await fr24.fetchFamilyStats([])).toBeNull();
    expect(await fr24.fetchFamilyStats(null)).toBeNull();
    expect(await fr24.fetchFamilyStats('B789')).toBeNull();
  });

  it('returns DerivedStats shape on success', async () => {
    mockGet.mockResolvedValueOnce({
      data: { data: [
        { operating_as: 'BAW', orig_icao: 'EGLL', dest_icao: 'KJFK' },
      ] },
    });
    const fr24 = require('../services/fr24Service');
    const stats = await fr24.fetchFamilyStats(['B737', 'B738']);
    expect(stats.totalFlights).toBe(1);
    expect(stats.uniqueOperators).toBe(1);
    expect(stats.windowDays).toBe(30);
    expect(stats.yearlyBreakdown).toBeNull();
  });
});

describe('fr24Service.fetchRouteStats', () => {
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

  it('passes routes=ORIG-DEST in URL params', async () => {
    mockGet.mockResolvedValueOnce({ data: { data: [] } });
    const fr24 = require('../services/fr24Service');
    await fr24.fetchRouteStats('JFK', 'LHR');
    expect(mockGet.mock.calls[0][1].params.routes).toBe('JFK-LHR');
  });

  it('returns DerivedStats without topRoutes field (the page IS the route)', async () => {
    mockGet.mockResolvedValueOnce({
      data: { data: [
        { operating_as: 'BAW', orig_icao: 'KJFK', dest_icao: 'EGLL' },
        { operating_as: 'AAL', orig_icao: 'KJFK', dest_icao: 'EGLL' },
      ] },
    });
    const fr24 = require('../services/fr24Service');
    const stats = await fr24.fetchRouteStats('JFK', 'LHR');
    expect(stats.totalFlights).toBe(2);
    expect(stats.uniqueOperators).toBe(2);
    expect(stats.topOperators).toHaveLength(2);
    expect(stats.topRoutes).toBeUndefined();
  });

  it('returns null for missing orig or dest', async () => {
    const fr24 = require('../services/fr24Service');
    expect(await fr24.fetchRouteStats('', 'LHR')).toBeNull();
    expect(await fr24.fetchRouteStats('JFK', '')).toBeNull();
    expect(await fr24.fetchRouteStats(null, 'LHR')).toBeNull();
  });
});

describe('fr24Service error handling', () => {
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

  it('401 → null + warn', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockGet.mockRejectedValueOnce({ response: { status: 401 } });
    const fr24 = require('../services/fr24Service');
    expect(await fr24.fetchVariantStats('B789')).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('auth error'));
    warn.mockRestore();
  });

  it('429 → retry once with backoff → null on second 429', async () => {
    mockGet
      .mockRejectedValueOnce({ response: { status: 429 } })
      .mockRejectedValueOnce({ response: { status: 429 } });
    const fr24 = require('../services/fr24Service');
    const result = await fr24.fetchVariantStats('B789');
    expect(result).toBeNull();
    expect(mockGet).toHaveBeenCalledTimes(2);
  });

  it('5xx → retry once → null', async () => {
    mockGet
      .mockRejectedValueOnce({ response: { status: 503 } })
      .mockRejectedValueOnce({ response: { status: 503 } });
    const fr24 = require('../services/fr24Service');
    expect(await fr24.fetchVariantStats('B789')).toBeNull();
    expect(mockGet).toHaveBeenCalledTimes(2);
  });

  it('timeout → null', async () => {
    mockGet.mockRejectedValue({ code: 'ECONNABORTED' });
    const fr24 = require('../services/fr24Service');
    expect(await fr24.fetchVariantStats('B789')).toBeNull();
  });

  it('malformed response (no data field) → zeros', async () => {
    mockGet.mockResolvedValueOnce({ data: { message: 'oops' } });
    const fr24 = require('../services/fr24Service');
    const stats = await fr24.fetchVariantStats('B789');
    expect(stats.totalFlights).toBe(0);
    expect(stats.uniqueOperators).toBe(0);
  });

  it('per-call failure does not throw — caller always gets null or DerivedStats', async () => {
    mockGet.mockRejectedValue(new Error('network exploded'));
    const fr24 = require('../services/fr24Service');
    await expect(fr24.fetchVariantStats('B789')).resolves.toBeNull();
    await expect(fr24.fetchFamilyStats(['B789'])).resolves.toBeNull();
    await expect(fr24.fetchRouteStats('JFK', 'LHR')).resolves.toBeNull();
  });
});
