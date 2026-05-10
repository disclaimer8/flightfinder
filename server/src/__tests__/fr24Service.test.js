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
