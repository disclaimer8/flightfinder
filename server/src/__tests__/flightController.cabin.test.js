const flightController = require('../controllers/flightController');
const orchestrator = require('../services/flightSearchOrchestrator');

jest.mock('../services/flightSearchOrchestrator', () => ({
  search: jest.fn(),
}));

describe('flightController.searchFlights — cabin/flex pass-through', () => {
  let res;
  beforeEach(() => {
    orchestrator.search.mockResolvedValue({ flights: [], source: 'mock' });
    res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
  });

  test('cabin from validatedQuery is forwarded to orchestrator', async () => {
    const req = {
      validatedQuery: {
        departure: 'LHR', arrival: 'JFK', date: '2099-01-01',
        passengers: 1, cabin: 'business', flexDates: false,
        directOnly: false,
      },
      query: {},
    };
    await flightController.searchFlights(req, res);
    expect(orchestrator.search).toHaveBeenCalledWith(
      expect.objectContaining({ cabin: 'business' })
    );
  });

  test('flexDates=true is forwarded', async () => {
    const req = {
      validatedQuery: {
        departure: 'LHR', arrival: 'JFK', date: '2099-01-01',
        passengers: 1, cabin: 'economy', flexDates: true,
        directOnly: false,
      },
      query: {},
    };
    await flightController.searchFlights(req, res);
    expect(orchestrator.search).toHaveBeenCalledWith(
      expect.objectContaining({ flexDates: true })
    );
  });

  test('cabin defaults to "economy" when validatedQuery.cabin is undefined', async () => {
    const req = {
      validatedQuery: {
        departure: 'LHR', arrival: 'JFK', date: '2099-01-01',
        passengers: 1, directOnly: false,
        // cabin and flexDates intentionally omitted (defensive default test)
      },
      query: {},
    };
    await flightController.searchFlights(req, res);
    expect(orchestrator.search).toHaveBeenCalledWith(
      expect.objectContaining({ cabin: 'economy', flexDates: false })
    );
  });
});
