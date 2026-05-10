// Reset env before each test that touches isEnabled()
const ORIGINAL_KEY = process.env.FR24_API_KEY;

afterEach(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.FR24_API_KEY;
  else process.env.FR24_API_KEY = ORIGINAL_KEY;
  jest.resetModules();
});

describe('fr24Service module shell', () => {
  it('exports the public API surface', () => {
    delete process.env.FR24_API_KEY;
    const fr24 = require('../services/fr24Service');
    expect(typeof fr24.isEnabled).toBe('function');
    expect(typeof fr24.fetchVariantStats).toBe('function');
    expect(typeof fr24.fetchFamilyStats).toBe('function');
    expect(typeof fr24.fetchRouteStats).toBe('function');
  });

  it('isEnabled returns false when FR24_API_KEY is absent', () => {
    delete process.env.FR24_API_KEY;
    const fr24 = require('../services/fr24Service');
    expect(fr24.isEnabled()).toBe(false);
  });

  it('isEnabled returns true when FR24_API_KEY is set', () => {
    process.env.FR24_API_KEY = 'sandbox-test-key';
    const fr24 = require('../services/fr24Service');
    expect(fr24.isEnabled()).toBe(true);
  });

  it('all fetch methods return null without HTTP when disabled', async () => {
    delete process.env.FR24_API_KEY;
    const fr24 = require('../services/fr24Service');
    expect(await fr24.fetchVariantStats('B789')).toBeNull();
    expect(await fr24.fetchFamilyStats(['B789'])).toBeNull();
    expect(await fr24.fetchRouteStats('JFK', 'LHR')).toBeNull();
  });
});

describe('fr24Service.fetchVariantStats (no yearly)', () => {
  let mockGet;
  let setTimeoutSpy;

  beforeEach(() => {
    process.env.FR24_API_KEY = 'sandbox-test-key';
    jest.resetModules();
    mockGet = jest.fn();
    jest.doMock('axios', () => {
      return { create: () => ({ get: mockGet }) };
    });
    // Bypass the inter-request throttle in tests — we're not testing pacing here.
    setTimeoutSpy = jest.spyOn(global, 'setTimeout').mockImplementation((cb) => { cb(); return 0; });
  });

  afterEach(() => {
    setTimeoutSpy.mockRestore();
    jest.dontMock('axios');
  });

  it('returns DerivedStats with totalFlights, uniqueOperators, top5 lists', async () => {
    mockGet
      .mockResolvedValueOnce({ data: { data: [{ record_count: 1234 }] } })  // /count
      .mockResolvedValueOnce({                                                 // /light
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
      totalFlights: 1234,
      uniqueOperators: 3,
      windowDays: 365,
      yearlyBreakdown: null,
    });
    expect(stats.topOperators[0]).toEqual({ icao: 'ANA', count: 3 });
    expect(stats.topOperators).toHaveLength(3);
    expect(stats.topRoutes[0]).toEqual({ from: 'RJTT', to: 'KLAX', count: 2 });
    expect(typeof stats.fetchedAt).toBe('number');
  });

  it('caps top-5 lists at 5 entries even when more groups exist', async () => {
    const rows = [];
    for (const op of ['A','B','C','D','E','F','G']) rows.push({ operating_as: op, orig_icao: 'XX', dest_icao: 'YY' });
    mockGet
      .mockResolvedValueOnce({ data: { data: [{ record_count: 7 }] } })
      .mockResolvedValueOnce({ data: { data: rows } });
    const fr24 = require('../services/fr24Service');
    const stats = await fr24.fetchVariantStats('B789');
    expect(stats.topOperators).toHaveLength(5);
  });

  it('passes aircraft=ICAO and 365-day window in URL params', async () => {
    mockGet
      .mockResolvedValueOnce({ data: { data: [{ record_count: 0 }] } })
      .mockResolvedValueOnce({ data: { data: [] } });
    const fr24 = require('../services/fr24Service');
    await fr24.fetchVariantStats('B789');

    expect(mockGet).toHaveBeenCalledTimes(2);
    const countCall = mockGet.mock.calls[0];
    expect(countCall[0]).toBe('/flight-summary/count');
    expect(countCall[1].params.aircraft).toBe('B789');
    expect(countCall[1].params.flight_datetime_from).toMatch(/^\d{4}-\d{2}-\d{2}/);
    expect(countCall[1].params.flight_datetime_to).toMatch(/^\d{4}-\d{2}-\d{2}/);

    const lightCall = mockGet.mock.calls[1];
    expect(lightCall[0]).toBe('/flight-summary/light');
    expect(lightCall[1].params.aircraft).toBe('B789');
    expect(lightCall[1].params.limit).toBe(20000);
  });

  it('returns derived with zeros when API returns empty data array', async () => {
    mockGet
      .mockResolvedValueOnce({ data: { data: [{ record_count: 0 }] } })
      .mockResolvedValueOnce({ data: { data: [] } });
    const fr24 = require('../services/fr24Service');
    const stats = await fr24.fetchVariantStats('B789');
    expect(stats).toMatchObject({
      totalFlights: 0,
      uniqueOperators: 0,
      topOperators: [],
      topRoutes: [],
    });
  });
});

describe('fr24Service.fetchFamilyStats', () => {
  let mockGet;

  beforeEach(() => {
    process.env.FR24_API_KEY = 'sandbox-test-key';
    jest.resetModules();
    // HOIST mockGet BEFORE doMock factory (plan's nested form was broken — see Task 3)
    mockGet = jest.fn();
    jest.doMock('axios', () => ({ create: () => ({ get: mockGet }) }));
    // Bypass production throttle (~7.5s gap would exceed Jest timeout)
    jest.spyOn(global, 'setTimeout').mockImplementation((cb) => { cb(); return 0; });
  });

  afterEach(() => {
    jest.dontMock('axios');
    jest.restoreAllMocks();
  });

  it('joins ICAO list as comma-separated aircraft param', async () => {
    mockGet
      .mockResolvedValueOnce({ data: { data: [{ record_count: 999 }] } })
      .mockResolvedValueOnce({ data: { data: [] } });
    const fr24 = require('../services/fr24Service');
    await fr24.fetchFamilyStats(['B737', 'B738', 'B739']);
    expect(mockGet.mock.calls[0][1].params.aircraft).toBe('B737,B738,B739');
  });

  it('caps ICAO list at 15 and warns when truncated', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const list = Array.from({ length: 17 }, (_, i) => `X${i.toString().padStart(3, '0')}`);
    mockGet
      .mockResolvedValueOnce({ data: { data: [{ record_count: 1 }] } })
      .mockResolvedValueOnce({ data: { data: [] } });
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
    mockGet
      .mockResolvedValueOnce({ data: { data: [{ record_count: 5000 }] } })
      .mockResolvedValueOnce({ data: { data: [
        { operating_as: 'BAW', orig_icao: 'EGLL', dest_icao: 'KJFK' },
      ] } });
    const fr24 = require('../services/fr24Service');
    const stats = await fr24.fetchFamilyStats(['B737', 'B738']);
    expect(stats.totalFlights).toBe(5000);
    expect(stats.uniqueOperators).toBe(1);
    expect(stats.windowDays).toBe(365);
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
    mockGet
      .mockResolvedValueOnce({ data: { data: [{ record_count: 847 }] } })
      .mockResolvedValueOnce({ data: { data: [] } });
    const fr24 = require('../services/fr24Service');
    await fr24.fetchRouteStats('JFK', 'LHR');
    expect(mockGet.mock.calls[0][1].params.routes).toBe('JFK-LHR');
  });

  it('returns DerivedStats without topRoutes field (the page IS the route)', async () => {
    mockGet
      .mockResolvedValueOnce({ data: { data: [{ record_count: 100 }] } })
      .mockResolvedValueOnce({ data: { data: [
        { operating_as: 'BAW', orig_icao: 'KJFK', dest_icao: 'EGLL' },
        { operating_as: 'AAL', orig_icao: 'KJFK', dest_icao: 'EGLL' },
      ] } });
    const fr24 = require('../services/fr24Service');
    const stats = await fr24.fetchRouteStats('JFK', 'LHR');
    expect(stats.totalFlights).toBe(100);
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

describe('fr24Service withYearly option', () => {
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

  it('issues 5 additional /count queries when withYearly=true', async () => {
    // count + light + 5 yearly counts = 7 calls
    for (let i = 0; i < 7; i++) {
      mockGet.mockResolvedValueOnce({ data: { data: i === 1 ? [] : [{ record_count: 1000 + i }] } });
    }
    const fr24 = require('../services/fr24Service');
    await fr24.fetchVariantStats('B789', { withYearly: true });
    expect(mockGet).toHaveBeenCalledTimes(7);
    // Indexes 2-6 are the yearly counts
    for (let i = 2; i < 7; i++) {
      expect(mockGet.mock.calls[i][0]).toBe('/flight-summary/count');
    }
    // Verify the variant's ICAO filter propagates to yearly queries (not just the main count/light)
    expect(mockGet.mock.calls[2][1].params.aircraft).toBe('B789');
  });

  it('yearlyBreakdown sorted newest year first', async () => {
    mockGet
      .mockResolvedValueOnce({ data: { data: [{ record_count: 47200 }] } })  // main count
      .mockResolvedValueOnce({ data: { data: [] } })                            // light
      .mockResolvedValueOnce({ data: { data: [{ record_count: 47200 }] } })   // year 0 (current)
      .mockResolvedValueOnce({ data: { data: [{ record_count: 38400 }] } })
      .mockResolvedValueOnce({ data: { data: [{ record_count: 31200 }] } })
      .mockResolvedValueOnce({ data: { data: [{ record_count: 22100 }] } })
      .mockResolvedValueOnce({ data: { data: [{ record_count: 18300 }] } });
    const fr24 = require('../services/fr24Service');
    const stats = await fr24.fetchVariantStats('B789', { withYearly: true });
    expect(stats.yearlyBreakdown).toHaveLength(5);
    expect(stats.yearlyBreakdown[0].count).toBe(47200);
    expect(stats.yearlyBreakdown[4].count).toBe(18300);
    // Years should descend
    for (let i = 0; i < 4; i++) {
      expect(stats.yearlyBreakdown[i].year).toBeGreaterThan(stats.yearlyBreakdown[i + 1].year);
    }
  });

  it('withYearly=false (default) does not issue yearly queries', async () => {
    mockGet
      .mockResolvedValueOnce({ data: { data: [{ record_count: 1 }] } })
      .mockResolvedValueOnce({ data: { data: [] } });
    const fr24 = require('../services/fr24Service');
    const stats = await fr24.fetchVariantStats('B789');
    expect(mockGet).toHaveBeenCalledTimes(2);
    expect(stats.yearlyBreakdown).toBeNull();
  });

  it('fetchFamilyStats supports withYearly: true', async () => {
    for (let i = 0; i < 7; i++) {
      mockGet.mockResolvedValueOnce({ data: { data: i === 1 ? [] : [{ record_count: 100 }] } });
    }
    const fr24 = require('../services/fr24Service');
    const stats = await fr24.fetchFamilyStats(['B737', 'B738'], { withYearly: true });
    expect(mockGet).toHaveBeenCalledTimes(7);
    expect(stats.yearlyBreakdown).toHaveLength(5);
    // Verify the family's joined ICAO list propagates to yearly queries
    expect(mockGet.mock.calls[2][1].params.aircraft).toBe('B737,B738');
  });

  it('one yearly /count failure yields {year, count: 0} but other years succeed', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});  // suppress expected warn
    mockGet
      .mockResolvedValueOnce({ data: { data: [{ record_count: 1 }] } })  // main count
      .mockResolvedValueOnce({ data: { data: [] } })                       // light
      .mockResolvedValueOnce({ data: { data: [{ record_count: 100 }] } }) // year 0 (current)
      .mockRejectedValueOnce(new Error('FR24 timeout'))                    // year 1 fails
      .mockResolvedValueOnce({ data: { data: [{ record_count: 80 }] } })  // year 2
      .mockResolvedValueOnce({ data: { data: [{ record_count: 70 }] } })  // year 3
      .mockResolvedValueOnce({ data: { data: [{ record_count: 60 }] } }); // year 4
    const fr24 = require('../services/fr24Service');
    const stats = await fr24.fetchVariantStats('B789', { withYearly: true });
    expect(stats.yearlyBreakdown).toHaveLength(5);
    expect(stats.yearlyBreakdown[0].count).toBe(100);  // succeeded
    expect(stats.yearlyBreakdown[1].count).toBe(0);    // failed → fallback
    expect(stats.yearlyBreakdown[2].count).toBe(80);   // others intact
    expect(stats.yearlyBreakdown[3].count).toBe(70);
    expect(stats.yearlyBreakdown[4].count).toBe(60);
  });
});
