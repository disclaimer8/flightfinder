'use strict';

// The worker's per-type spacing is 3s; with 2 types in the test that's ~6s.
// Default jest timeout (5s) would flake, so bump it once at the top.
jest.setTimeout(15000);

// Worker uses real timers; we mock the service it depends on to make tests deterministic.
jest.mock('../services/adsblolService', () => ({
  isEnabled: () => true,
  pullAndPersistType: jest.fn(),
}));

const adsblolWorker = require('../workers/adsblolWorker');
const adsblolService = require('../services/adsblolService');

describe('adsblolWorker module surface', () => {
  it('exports getLastCycle with zero/null initial state', () => {
    const c = adsblolWorker.getLastCycle();
    expect(c).toEqual({
      ran_at: null, duration_ms: 0, types: 0, fetched: 0, resolved: 0, persisted: 0,
    });
  });

  it('INITIAL_DELAY_MS is 5_000 (boot-trigger seed)', () => {
    expect(adsblolWorker.INITIAL_DELAY_MS).toBe(5000);
  });
});

describe('adsblolWorker.runCycleForTest', () => {
  beforeEach(() => {
    adsblolService.pullAndPersistType.mockReset();
  });

  it('aggregates per-type counts into getLastCycle()', async () => {
    adsblolService.pullAndPersistType
      .mockImplementation(async (type) => ({
        fetched: type === 'B738' ? 100 : 50,
        resolved: type === 'B738' ? 20 : 5,
        persisted: type === 'B738' ? 18 : 4,
      }));
    await adsblolWorker._runCycleForTest(['B738', 'A320']);
    const c = adsblolWorker.getLastCycle();
    expect(c.types).toBe(2);
    expect(c.fetched).toBe(150);
    expect(c.resolved).toBe(25);
    expect(c.persisted).toBe(22);
    expect(c.ran_at).toBeGreaterThan(0);
    expect(c.duration_ms).toBeGreaterThanOrEqual(0);
  });
});

describe('adsblolWorker.getLastCycle cross-worker visibility', () => {
  it('reads lastCycle from shared SQLite worker_state', async () => {
    // Simulate a different worker writing first
    const { setWorkerState } = require('../models/db');
    setWorkerState('adsblol.lastCycle', {
      ran_at: 1779000000000, duration_ms: 100, types: 48,
      fetched: 1000, resolved: 200, persisted: 180,
    });
    expect(adsblolWorker.getLastCycle()).toEqual({
      ran_at: 1779000000000, duration_ms: 100, types: 48,
      fetched: 1000, resolved: 200, persisted: 180,
    });
  });
});
