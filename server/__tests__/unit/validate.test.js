'use strict';

const validate = require('../../src/middleware/validate');

// ─── helpers ──────────────────────────────────────────────────────────────────

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json   = jest.fn().mockReturnValue(res);
  return res;
}

function run(middleware, req) {
  const res  = mockRes();
  const next = jest.fn();
  middleware(req, res, next);
  return { res, next };
}

// ─── validate.searchQuery ─────────────────────────────────────────────────────

describe('validate.searchQuery', () => {
  const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];

  test('passes with valid required params', () => {
    const { next, res } = run(validate.searchQuery, {
      query: { departure: 'LIS', arrival: 'JFK', date: tomorrow, passengers: '1' },
    });
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  test('rejects missing departure', () => {
    const { res, next } = run(validate.searchQuery, { query: { arrival: 'JFK' } });
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('rejects missing arrival', () => {
    const { res, next } = run(validate.searchQuery, { query: { departure: 'LIS' } });
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('rejects same departure and arrival', () => {
    const { res, next } = run(validate.searchQuery, {
      query: { departure: 'LIS', arrival: 'LIS', date: tomorrow },
    });
    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
  });

  test('rejects invalid IATA code (numbers)', () => {
    const { res, next } = run(validate.searchQuery, {
      query: { departure: '123', arrival: 'JFK', date: tomorrow },
    });
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('rejects past date', () => {
    const { res, next } = run(validate.searchQuery, {
      query: { departure: 'LIS', arrival: 'JFK', date: '2020-01-01' },
    });
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('rejects date in wrong format', () => {
    const { res, next } = run(validate.searchQuery, {
      query: { departure: 'LIS', arrival: 'JFK', date: '15-03-2026' },
    });
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('rejects passengers > 9', () => {
    const { res, next } = run(validate.searchQuery, {
      query: { departure: 'LIS', arrival: 'JFK', date: tomorrow, passengers: '10' },
    });
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('rejects passengers = 0', () => {
    const { res, next } = run(validate.searchQuery, {
      query: { departure: 'LIS', arrival: 'JFK', date: tomorrow, passengers: '0' },
    });
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('rejects invalid aircraftType', () => {
    const { res, next } = run(validate.searchQuery, {
      query: { departure: 'LIS', arrival: 'JFK', date: tomorrow, aircraftType: 'helicopter' },
    });
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('accepts valid aircraftType', () => {
    const { next } = run(validate.searchQuery, {
      query: { departure: 'LIS', arrival: 'JFK', date: tomorrow, aircraftType: 'wide-body' },
    });
    expect(next).toHaveBeenCalled();
  });

  test('sets req.validatedQuery with normalised values', () => {
    const req = { query: { departure: 'lis', arrival: 'jfk', date: tomorrow, passengers: '2' } };
    const { next } = run(validate.searchQuery, req);
    expect(next).toHaveBeenCalled();
    expect(req.validatedQuery.departure).toBe('LIS');
    expect(req.validatedQuery.arrival).toBe('JFK');
    expect(req.validatedQuery.passengers).toBe(2);
  });

  test('rejects returnDate before departure date', () => {
    const { res, next } = run(validate.searchQuery, {
      query: { departure: 'LIS', arrival: 'JFK', date: tomorrow,
               returnDate: '2020-01-01' },
    });
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

// ─── validate.exploreQuery ────────────────────────────────────────────────────

describe('validate.exploreQuery', () => {
  const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];

  test('passes with departure + aircraftType', () => {
    const { next } = run(validate.exploreQuery, {
      query: { departure: 'LIS', date: tomorrow, aircraftType: 'jet' },
    });
    expect(next).toHaveBeenCalled();
  });

  test('rejects missing departure', () => {
    const { res, next } = run(validate.exploreQuery, {
      query: { aircraftType: 'jet' },
    });
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('rejects missing both aircraftType and aircraftModel', () => {
    const { res, next } = run(validate.exploreQuery, {
      query: { departure: 'LIS', date: tomorrow },
    });
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

// ─── validate.bookBody ────────────────────────────────────────────────────────

describe('validate.bookBody', () => {
  const validPassenger = {
    firstName: 'John',
    lastName:  'Smith',
    email:     'john@example.com',
    dateOfBirth: '1990-01-15',
    title:  'mr',
    gender: 'M',
  };

  test('passes with valid body', () => {
    const { next } = run(validate.bookBody, {
      body: {
        offerId: 'off_abc123',
        passengerIds: ['pas_1'],
        passengerInfo: [validPassenger],
        currency: 'EUR',
        totalAmount: '299.00',
      },
    });
    expect(next).toHaveBeenCalled();
  });

  test('rejects missing offerId', () => {
    const { res, next } = run(validate.bookBody, {
      body: { passengerInfo: [validPassenger], totalAmount: '299' },
    });
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('rejects empty passengerInfo', () => {
    const { res, next } = run(validate.bookBody, {
      body: { offerId: 'off_1', passengerInfo: [], totalAmount: '299' },
    });
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('rejects passenger under 18', () => {
    const { res, next } = run(validate.bookBody, {
      body: {
        offerId: 'off_1',
        passengerInfo: [{ ...validPassenger, dateOfBirth: '2015-01-01' }],
        totalAmount: '299',
      },
    });
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('rejects invalid email', () => {
    const { res, next } = run(validate.bookBody, {
      body: {
        offerId: 'off_1',
        passengerInfo: [{ ...validPassenger, email: 'not-an-email' }],
        totalAmount: '299',
      },
    });
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('rejects invalid gender', () => {
    const { res, next } = run(validate.bookBody, {
      body: {
        offerId: 'off_1',
        passengerInfo: [{ ...validPassenger, gender: 'X' }],
        totalAmount: '299',
      },
    });
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('rejects invalid currency', () => {
    const { res, next } = run(validate.bookBody, {
      body: {
        offerId: 'off_1',
        passengerInfo: [validPassenger],
        totalAmount: '299',
        currency: 'RUB',
      },
    });
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('rejects negative totalAmount', () => {
    const { res, next } = run(validate.bookBody, {
      body: { offerId: 'off_1', passengerInfo: [validPassenger], totalAmount: '-50' },
    });
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('rejects over 9 passengers', () => {
    const { res, next } = run(validate.bookBody, {
      body: {
        offerId: 'off_1',
        passengerInfo: Array(10).fill(validPassenger),
        totalAmount: '299',
      },
    });
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

// ─── sanitiseKey ─────────────────────────────────────────────────────────────

describe('sanitiseKey', () => {
  test('strips special characters', () => {
    expect(validate.sanitiseKey('../etc/passwd')).toBe('ETCPASSWD');
  });

  test('uppercases result', () => {
    expect(validate.sanitiseKey('abc')).toBe('ABC');
  });

  test('handles empty input', () => {
    expect(validate.sanitiseKey('')).toBe('');
    expect(validate.sanitiseKey(null)).toBe('');
    expect(validate.sanitiseKey(undefined)).toBe('');
  });

  test('truncates to 10 chars', () => {
    expect(validate.sanitiseKey('ABCDEFGHIJKLMNOP').length).toBeLessThanOrEqual(10);
  });
});
