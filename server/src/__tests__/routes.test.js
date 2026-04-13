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

  beforeEach(() => {
    jest.resetModules();
    jest.mock('../services/openSkyService');
    jest.mock('../services/airlabsService');
    routesService  = require('../services/routesService');
    openSkyService = require('../services/openSkyService');
    airlabsSvc     = require('../services/airlabsService');
  });

  it('marks destinations live when OpenSky has them', async () => {
    openSkyService.getDepartures.mockResolvedValue([
      { destIata: 'JFK', lastSeen: new Date() },
    ]);
    airlabsSvc.getRoutes.mockResolvedValue(new Set(['JFK', 'CDG']));

    const result = await routesService.getRoutes('LHR');

    expect(result.confidences['JFK']).toBe('live');
    expect(result.confidences['CDG']).toBe('scheduled');
    expect(result.destinations).toContain('JFK');
    expect(result.destinations).toContain('CDG');
  });

  it('marks all destinations scheduled when OpenSky returns empty', async () => {
    openSkyService.getDepartures.mockResolvedValue([]);
    airlabsSvc.getRoutes.mockResolvedValue(new Set(['CDG', 'AMS']));

    const result = await routesService.getRoutes('LHR');

    expect(result.confidences['CDG']).toBe('scheduled');
    expect(result.confidences['AMS']).toBe('scheduled');
  });

  it('returns empty destinations when both sources empty', async () => {
    openSkyService.getDepartures.mockResolvedValue([]);
    airlabsSvc.getRoutes.mockResolvedValue(new Set());

    const result = await routesService.getRoutes('LHR');

    expect(result.destinations).toHaveLength(0);
    expect(result.origin).toBe('LHR');
  });

  it('does not include self-loops in destinations', async () => {
    openSkyService.getDepartures.mockResolvedValue([
      { destIata: 'LHR', lastSeen: new Date() },
    ]);
    airlabsSvc.getRoutes.mockResolvedValue(new Set(['LHR', 'JFK']));

    const result = await routesService.getRoutes('LHR');

    expect(result.destinations).not.toContain('LHR');
    expect(result.destinations).toContain('JFK');
  });
});
