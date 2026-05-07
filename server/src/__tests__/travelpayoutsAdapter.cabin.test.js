jest.mock('../services/travelpayoutsService', () => ({
  isConfigured: () => true,
  getCheapest: jest.fn(),
}));

const tp = require('../services/travelpayoutsService');
const adapter = require('../services/travelpayoutsAdapter');

describe('travelpayoutsAdapter forwards cabin to service', () => {
  beforeEach(() => {
    tp.getCheapest.mockReset();
    tp.getCheapest.mockResolvedValue(null);
  });

  test('cabin from orchestrator forwarded to getCheapest', async () => {
    await adapter.search({
      departure: 'LHR', arrival: 'JFK', date: '2099-01-15',
      cabin: 'business',
    });
    expect(tp.getCheapest).toHaveBeenCalledWith(
      expect.objectContaining({ cabin: 'business' })
    );
  });

  test('cabin defaults to "economy" when adapter receives no cabin', async () => {
    await adapter.search({ departure: 'LHR', arrival: 'JFK', date: '2099-01-15' });
    expect(tp.getCheapest).toHaveBeenCalledWith(
      expect.objectContaining({ cabin: 'economy' })
    );
  });
});
