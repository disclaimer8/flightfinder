jest.mock('../services/travelpayoutsService');
const tp = require('../services/travelpayoutsService');
const adapter = require('../services/travelpayoutsAdapter');

const PARAMS = { departure: 'LIS', arrival: 'JFK', date: '2026-06-01', currency: 'EUR' };

// Mirror the real shape returned by travelpayoutsService.getCheapest
// (see server/src/services/travelpayoutsService.js lines 68-81).
const TP_OFFER = {
  price: '350',
  currency: 'EUR',
  airline: 'TP',
  flightNumber: '123',
  departureTime: '2026-06-01T10:00:00Z',
  returnTime: null,
  durationMinutes: 480,
  stops: 0,
  expiresAt: null,
  source: 'travelpayouts',
};

describe('travelpayoutsAdapter.search', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns null when service is not configured', async () => {
    tp.isConfigured.mockReturnValue(false);
    expect(await adapter.search(PARAMS)).toBeNull();
    expect(tp.getCheapest).not.toHaveBeenCalled();
  });

  test('translates params and wraps single object as NormalizedFlight[]', async () => {
    tp.isConfigured.mockReturnValue(true);
    tp.getCheapest.mockResolvedValue(TP_OFFER);
    const result = await adapter.search(PARAMS);
    expect(tp.getCheapest).toHaveBeenCalledWith({
      origin: 'LIS',
      destination: 'JFK',
      date: '2026-06-01',
      currency: 'EUR',
    });
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(1);
    const f = result[0];
    expect(f.source).toBe('travelpayouts');
    expect(f.departure.code).toBe('LIS');
    expect(f.arrival.code).toBe('JFK');
    expect(f.price).toBe(350);
    expect(f.currency).toBe('EUR');
    expect(f.airline).toBe('TP');
    expect(f.airlineIata).toBe('TP');
    expect(f.flightNumber).toBe('TP123');
    expect(f.duration).toBe(480);
    expect(f.stops).toBe(0);
  });

  test('returns null when service returns null', async () => {
    tp.isConfigured.mockReturnValue(true);
    tp.getCheapest.mockResolvedValue(null);
    expect(await adapter.search(PARAMS)).toBeNull();
  });

  test('returns null on thrown error', async () => {
    tp.isConfigured.mockReturnValue(true);
    tp.getCheapest.mockRejectedValue(new Error('boom'));
    expect(await adapter.search(PARAMS)).toBeNull();
  });

  test('defaults currency to usd when not provided', async () => {
    tp.isConfigured.mockReturnValue(true);
    tp.getCheapest.mockResolvedValue(TP_OFFER);
    await adapter.search({ departure: 'LIS', arrival: 'JFK', date: '2026-06-01' });
    expect(tp.getCheapest).toHaveBeenCalledWith(
      expect.objectContaining({ currency: 'usd' })
    );
  });
});
