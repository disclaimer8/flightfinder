jest.mock('../services/googleFlightsService');
jest.mock('../services/itaMatrixService');
jest.mock('../services/travelpayoutsAdapter');
jest.mock('../services/cacheService');

const google = require('../services/googleFlightsService');
const ita = require('../services/itaMatrixService');
const tpAdapter = require('../services/travelpayoutsAdapter');
const cache = require('../services/cacheService');
const orch = require('../services/flightSearchOrchestrator');

const PARAMS = { departure: 'LIS', arrival: 'JFK', date: '2026-06-01', passengers: 1 };
const STUB_FLIGHT = [{
  departure: { code: 'LIS' },
  arrival: { code: 'JFK' },
  duration: 480,
  stops: 0,
  source: 'X',
  segments: [{}],
}];

describe('flightSearchOrchestrator.search', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    cache.get.mockReturnValue(undefined);
    cache.set.mockImplementation(() => {});
  });

  test('returns cache when warm', async () => {
    cache.get.mockReturnValueOnce(STUB_FLIGHT);
    const r = await orch.search(PARAMS);
    expect(r.flights).toEqual(STUB_FLIGHT);
    expect(r.source).toBe('cache');
    expect(google.search).not.toHaveBeenCalled();
  });

  test('uses google when cache cold', async () => {
    google.search.mockResolvedValue(STUB_FLIGHT);
    const r = await orch.search(PARAMS);
    expect(r.source).toBe('google');
    expect(r.flights).toEqual(STUB_FLIGHT);
    expect(ita.search).not.toHaveBeenCalled();
    expect(cache.set).toHaveBeenCalled();
  });

  test('caches both fresh and stale on success', async () => {
    google.search.mockResolvedValue(STUB_FLIGHT);
    await orch.search(PARAMS);
    expect(cache.set).toHaveBeenCalledWith(
      expect.stringMatching(/^flights:/),
      STUB_FLIGHT,
      600
    );
    expect(cache.set).toHaveBeenCalledWith(
      expect.stringMatching(/^stale:flights:/),
      STUB_FLIGHT,
      86400
    );
  });

  test('falls through to ITA when google returns null', async () => {
    google.search.mockResolvedValue(null);
    ita.search.mockResolvedValue(STUB_FLIGHT);
    const r = await orch.search(PARAMS);
    expect(r.source).toBe('ita');
    expect(google.search).toHaveBeenCalled();
    expect(ita.search).toHaveBeenCalled();
    expect(tpAdapter.search).not.toHaveBeenCalled();
  });

  test('falls through to ITA when google returns []', async () => {
    google.search.mockResolvedValue([]);
    ita.search.mockResolvedValue(STUB_FLIGHT);
    const r = await orch.search(PARAMS);
    expect(r.source).toBe('ita');
  });

  test('falls through to travelpayouts when google and ita both fail', async () => {
    google.search.mockResolvedValue(null);
    ita.search.mockResolvedValue(null);
    tpAdapter.search.mockResolvedValue(STUB_FLIGHT);
    const r = await orch.search(PARAMS);
    expect(r.source).toBe('travelpayouts');
    expect(tpAdapter.search).toHaveBeenCalledWith(PARAMS);
  });

  test('returns source none when adapter signals not-configured (null)', async () => {
    google.search.mockResolvedValue(null);
    ita.search.mockResolvedValue(null);
    tpAdapter.search.mockResolvedValue(null);
    const r = await orch.search(PARAMS);
    expect(r.flights).toEqual([]);
    expect(r.source).toBe('none');
  });

  test('returns empty when all sources fail', async () => {
    google.search.mockResolvedValue(null);
    ita.search.mockResolvedValue(null);
    tpAdapter.search.mockResolvedValue(null);
    const r = await orch.search(PARAMS);
    expect(r.flights).toEqual([]);
    expect(r.source).toBe('none');
  });

  test('serves stale cache rather than empty when all sources fail', async () => {
    cache.get.mockImplementation((k) => (k.startsWith('stale:') ? STUB_FLIGHT : undefined));
    google.search.mockResolvedValue(null);
    ita.search.mockResolvedValue(null);
    tpAdapter.search.mockResolvedValue(null);
    const r = await orch.search(PARAMS);
    expect(r.source).toBe('stale-cache');
    expect(r.flights).toEqual(STUB_FLIGHT);
  });

  test('squashes thrown errors from a source into null and advances', async () => {
    google.search.mockRejectedValue(new Error('boom'));
    ita.search.mockResolvedValue(STUB_FLIGHT);
    const r = await orch.search(PARAMS);
    expect(r.source).toBe('ita');
  });
});
