const validate = require('../middleware/validate');

function runMiddleware(query) {
  const req = { query };
  let result = { passed: false, error: null };
  const res = {
    status() { return this; },
    json(body) { result.error = body; return this; },
  };
  validate.searchQuery(req, res, () => { result.passed = true; });
  return { ...result, req };
}

describe('validate.searchQuery — cabin', () => {
  const base = { departure: 'LHR', arrival: 'JFK', date: '2099-01-01' };

  test('cabin defaults to "economy" when absent', () => {
    const { passed, req } = runMiddleware({ ...base });
    expect(passed).toBe(true);
    expect(req.validatedQuery.cabin).toBe('economy');
  });

  test.each(['economy', 'premium-economy', 'business', 'first'])('cabin "%s" passes', (cabin) => {
    const { passed, req } = runMiddleware({ ...base, cabin });
    expect(passed).toBe(true);
    expect(req.validatedQuery.cabin).toBe(cabin);
  });

  test('cabin "luxury" rejected', () => {
    const { passed, error } = runMiddleware({ ...base, cabin: 'luxury' });
    expect(passed).toBe(false);
    expect(error.error).toMatch(/cabin/);
  });
});

describe('validate.searchQuery — flex_dates', () => {
  const base = { departure: 'LHR', arrival: 'JFK', date: '2099-01-01' };

  test('flex_dates defaults to false when absent', () => {
    const { passed, req } = runMiddleware({ ...base });
    expect(passed).toBe(true);
    expect(req.validatedQuery.flexDates).toBe(false);
  });

  test('flex_dates="1" → true', () => {
    const { passed, req } = runMiddleware({ ...base, flex_dates: '1' });
    expect(passed).toBe(true);
    expect(req.validatedQuery.flexDates).toBe(true);
  });

  test('flex_dates="true" → true', () => {
    const { passed, req } = runMiddleware({ ...base, flex_dates: 'true' });
    expect(passed).toBe(true);
    expect(req.validatedQuery.flexDates).toBe(true);
  });

  test('flex_dates="0" → false', () => {
    const { passed, req } = runMiddleware({ ...base, flex_dates: '0' });
    expect(passed).toBe(true);
    expect(req.validatedQuery.flexDates).toBe(false);
  });

  test('flex_dates without date is rejected (server fan-out needs an anchor date)', () => {
    const { passed, error } = runMiddleware({ departure: 'LHR', arrival: 'JFK', flex_dates: '1' });
    expect(passed).toBe(false);
    expect(error.error).toMatch(/flex_dates/);
  });
});
