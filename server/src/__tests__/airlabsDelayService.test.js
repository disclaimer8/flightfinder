'use strict';

describe('airlabsDelayService', () => {
  const ORIG_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ORIG_ENV };
  });

  afterEach(() => {
    process.env = ORIG_ENV;
  });

  test('returns null when API key missing', async () => {
    delete process.env.AIRLABS_API_KEY;
    const svc = require('../services/airlabsDelayService');
    const result = await svc.getDelayStats({ dep: 'LHR', arr: 'JFK', airline: 'BA', flightNumber: '175' });
    expect(result).toBeNull();
  });

  test('returns null for dep shorter than 3 chars', async () => {
    process.env.AIRLABS_API_KEY = 'test-key';
    const svc = require('../services/airlabsDelayService');
    const result = await svc.getDelayStats({ dep: 'LH', arr: 'JFK', airline: 'BA' });
    expect(result).toBeNull();
  });

  test('returns null for empty arr', async () => {
    process.env.AIRLABS_API_KEY = 'test-key';
    const svc = require('../services/airlabsDelayService');
    const result = await svc.getDelayStats({ dep: 'LHR', arr: '', airline: 'BA' });
    expect(result).toBeNull();
  });

  test('returns null for missing dep', async () => {
    process.env.AIRLABS_API_KEY = 'test-key';
    const svc = require('../services/airlabsDelayService');
    const result = await svc.getDelayStats({ dep: undefined, arr: 'JFK', airline: 'BA' });
    expect(result).toBeNull();
  });

  test('returns null for arr longer than 3 chars', async () => {
    process.env.AIRLABS_API_KEY = 'test-key';
    const svc = require('../services/airlabsDelayService');
    const result = await svc.getDelayStats({ dep: 'LHR', arr: 'JFKX', airline: 'BA' });
    expect(result).toBeNull();
  });
});
