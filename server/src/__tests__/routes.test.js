'use strict';

jest.mock('axios');
const axios = require('axios');

// axios.create() must return the mocked axios instance so that
// airlabsClient.get === axios.get in tests
axios.create.mockReturnValue(axios);

// Set env key so getRoutes() (which reads process.env dynamically) can proceed in tests
beforeAll(() => {
  process.env.AIRLABS_API_KEY = 'test-key';
});

const airlabsService = require('../services/airlabsService');

afterEach(() => {
  airlabsService._clearRoutesCache();
  jest.clearAllMocks();
});

describe('airlabsService.getRoutes', () => {
  it('returns deduplicated arr_iata set from paginated response', async () => {
    // Page 1: 2 routes to JFK (two airlines), 1 to CDG
    axios.get
      .mockResolvedValueOnce({ data: { response: [
        { arr_iata: 'JFK', dep_iata: 'LHR' },
        { arr_iata: 'JFK', dep_iata: 'LHR' },
        { arr_iata: 'CDG', dep_iata: 'LHR' },
      ]}})
      // Page 2: empty → stop
      .mockResolvedValueOnce({ data: { response: [] }});

    const result = await airlabsService.getRoutes('LHR');
    expect(result).toBeInstanceOf(Set);
    expect(result.size).toBe(2);
    expect(result.has('JFK')).toBe(true);
    expect(result.has('CDG')).toBe(true);
  });

  it('returns empty Set when API key missing', async () => {
    const savedKey = process.env.AIRLABS_API_KEY;
    delete process.env.AIRLABS_API_KEY;
    try {
      airlabsService._clearRoutesCache();

      const result = await airlabsService.getRoutes('LHR');
      expect(result).toBeInstanceOf(Set);
      expect(result.size).toBe(0);
      expect(axios.get).not.toHaveBeenCalled();
    } finally {
      process.env.AIRLABS_API_KEY = savedKey;
    }
  });

  it('returns empty Set on network error', async () => {
    axios.get.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const result = await airlabsService.getRoutes('LHR');
    expect(result).toBeInstanceOf(Set);
    expect(result.size).toBe(0);
  });

  it('serves cache on second call without extra HTTP requests', async () => {
    axios.get
      .mockResolvedValueOnce({ data: { response: [{ arr_iata: 'JFK', dep_iata: 'LHR' }] }})
      .mockResolvedValueOnce({ data: { response: [] }});

    await airlabsService.getRoutes('LHR');
    await airlabsService.getRoutes('LHR'); // second call
    // axios.get called twice: page 1 + empty page 2 (then cache hit)
    expect(axios.get).toHaveBeenCalledTimes(2);
  });
});

// ── routesService tests ───────────────────────────────────────────────────────

describe('routesService.getRoutes', () => {
  let routesService;
  let openSkyService;
  let airlabsSvc;
  let db;

  beforeEach(() => {
    jest.resetModules();
    jest.mock('../services/openSkyService');
    jest.mock('../services/airlabsService');
    jest.mock('../models/db', () => ({
      observedDestinationsFromDep: jest.fn(() => []),
      observedAircraftByRoute: jest.fn(() => []),
      upsertObservedRoute: jest.fn(),
    }));
    routesService  = require('../services/routesService');
    openSkyService = require('../services/openSkyService');
    airlabsSvc     = require('../services/airlabsService');
    db             = require('../models/db');

    // Default: no live flights, no historical observations
    airlabsSvc.getLiveFlights = jest.fn().mockResolvedValue([]);
    airlabsSvc.getSchedules   = jest.fn().mockResolvedValue([]);
  });

  it('marks destinations live when present in live airborne snapshot', async () => {
    openSkyService.getDepartures.mockResolvedValue([]);
    airlabsSvc.getLiveFlights.mockResolvedValue([
      { dep_iata: 'LHR', arr_iata: 'JFK', aircraft_icao: 'B77W', airline_iata: 'BA' },
    ]);
    airlabsSvc.getSchedules.mockResolvedValue([
      { arr_iata: 'JFK' }, { arr_iata: 'CDG' },
    ]);

    const result = await routesService.getRoutes('LHR');

    expect(result.confidences['JFK']).toBe('live');
    expect(result.confidences['CDG']).toBe('scheduled');
    expect(result.aircraft['JFK']).toContain('B77W');
    expect(result.destinations).toContain('JFK');
    expect(result.destinations).toContain('CDG');
  });

  it('marks destinations live when OpenSky recently saw them', async () => {
    openSkyService.getDepartures.mockResolvedValue([
      { destIata: 'JFK', lastSeen: new Date() },
    ]);
    airlabsSvc.getSchedules.mockResolvedValue([{ arr_iata: 'JFK' }]);

    const result = await routesService.getRoutes('LHR');

    expect(result.confidences['JFK']).toBe('live');
  });

  it('marks all destinations scheduled when no live data', async () => {
    openSkyService.getDepartures.mockResolvedValue([]);
    airlabsSvc.getSchedules.mockResolvedValue([
      { arr_iata: 'CDG' }, { arr_iata: 'AMS' },
    ]);

    const result = await routesService.getRoutes('LHR');

    expect(result.confidences['CDG']).toBe('scheduled');
    expect(result.confidences['AMS']).toBe('scheduled');
  });

  it('returns empty destinations when all sources empty', async () => {
    openSkyService.getDepartures.mockResolvedValue([]);

    const result = await routesService.getRoutes('LHR');

    expect(result.destinations).toHaveLength(0);
    expect(result.origin).toBe('LHR');
  });

  it('does not include self-loops in destinations', async () => {
    openSkyService.getDepartures.mockResolvedValue([
      { destIata: 'LHR', lastSeen: new Date() },
    ]);
    airlabsSvc.getSchedules.mockResolvedValue([{ arr_iata: 'LHR' }, { arr_iata: 'JFK' }]);

    const result = await routesService.getRoutes('LHR');

    expect(result.destinations).not.toContain('LHR');
    expect(result.destinations).toContain('JFK');
  });

  it('enriches aircraft from observed_routes history when no live data', async () => {
    openSkyService.getDepartures.mockResolvedValue([]);
    airlabsSvc.getSchedules.mockResolvedValue([{ arr_iata: 'JFK' }]);
    db.observedAircraftByRoute.mockReturnValue([
      { aircraft_icao: 'B789', seen_at: Date.now() - 3600_000 },
      { aircraft_icao: 'A388', seen_at: Date.now() - 7200_000 },
    ]);

    const result = await routesService.getRoutes('LHR');

    expect(result.confidences['JFK']).toBe('scheduled');
    expect(result.aircraft['JFK']).toEqual(expect.arrayContaining(['B789', 'A388']));
  });

  it('marks a destination observed when only in history, not today schedule/live', async () => {
    openSkyService.getDepartures.mockResolvedValue([]);
    db.observedDestinationsFromDep.mockReturnValue(['TLV']);
    db.observedAircraftByRoute.mockReturnValue([
      { aircraft_icao: 'B789', seen_at: Date.now() - 2 * 24 * 3600_000 },
    ]);

    const result = await routesService.getRoutes('LHR');

    expect(result.destinations).toContain('TLV');
    expect(result.confidences['TLV']).toBe('observed');
    expect(result.aircraft['TLV']).toContain('B789');
  });
});
