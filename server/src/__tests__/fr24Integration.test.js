// server/src/__tests__/fr24Integration.test.js
//
// Opt-in integration test against the real FR24 API.
// Skipped automatically when FR24_API_KEY is not set so CI without the key
// doesn't break.
//
// Sandbox returns canary mock data (record_count: 1234, one SAS row regardless
// of filters). We assert response SHAPE, not specific values.

const HAS_KEY = Boolean(process.env.FR24_API_KEY);
const describeIfKey = HAS_KEY ? describe : describe.skip;

describeIfKey('fr24Service real API integration', () => {
  let fr24;

  beforeAll(() => {
    jest.resetModules();
    fr24 = require('../services/fr24Service');
  });

  it('fetchVariantStats returns DerivedStats shape for B789', async () => {
    const stats = await fr24.fetchVariantStats('B789');
    expect(stats).not.toBeNull();
    expect(typeof stats.totalFlights).toBe('number');
    expect(typeof stats.uniqueOperators).toBe('number');
    expect(Array.isArray(stats.topOperators)).toBe(true);
    expect(Array.isArray(stats.topRoutes)).toBe(true);
    expect(stats.yearlyBreakdown).toBeNull();
    expect(stats.windowDays).toBe(365);
    expect(typeof stats.fetchedAt).toBe('number');
  }, 30000);

  it('fetchVariantStats with withYearly returns 5-entry breakdown', async () => {
    const stats = await fr24.fetchVariantStats('B789', { withYearly: true });
    expect(stats.yearlyBreakdown).toHaveLength(5);
    for (const y of stats.yearlyBreakdown) {
      expect(typeof y.year).toBe('number');
      expect(typeof y.count).toBe('number');
    }
  }, 60000);

  it('fetchRouteStats returns DerivedStats shape (no topRoutes) for JFK-LHR', async () => {
    const stats = await fr24.fetchRouteStats('JFK', 'LHR');
    expect(stats).not.toBeNull();
    expect(typeof stats.totalFlights).toBe('number');
    expect(typeof stats.uniqueOperators).toBe('number');
    expect(Array.isArray(stats.topOperators)).toBe(true);
    expect(stats.topRoutes).toBeUndefined();
  }, 30000);
});
