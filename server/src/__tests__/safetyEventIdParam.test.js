const { safetyEventIdParam } = require('../middleware/validate');

function run(idParam) {
  const req = { params: { id: idParam } };
  let statusCode = 200;
  let body = null;
  const res = {
    status: (s) => { statusCode = s; return res; },
    json: (b) => { body = b; return res; },
  };
  let nextCalled = false;
  safetyEventIdParam(req, res, () => { nextCalled = true; });
  return { req, statusCode, body, nextCalled };
}

describe('safetyEventIdParam', () => {
  test('plain integer → safety_events source', () => {
    const r = run('84');
    expect(r.nextCalled).toBe(true);
    expect(r.req.validatedParams).toEqual({ id: 84, source: 'safety_events' });
  });
  test('ac_<int> → aircrash source', () => {
    const r = run('ac_40765');
    expect(r.nextCalled).toBe(true);
    expect(r.req.validatedParams).toEqual({ id: 40765, source: 'aircrash' });
  });
  test('rejects ac_ without digits', () => {
    const r = run('ac_');
    expect(r.nextCalled).toBe(false);
    expect(r.statusCode).toBe(400);
  });
  test('rejects garbage', () => {
    const r = run('foo');
    expect(run('foo').nextCalled).toBe(false);
    expect(run('foo').statusCode).toBe(400);
    expect(run('').statusCode).toBe(400);
    expect(run('1.5').statusCode).toBe(400);
    expect(run('-1').statusCode).toBe(400);
  });
  test('rejects ac_ with leading zeros only when overflowing length cap', () => {
    // 12 digits max per SAFETY_ID_RE — same cap applied to ac_<digits>.
    expect(run('ac_1234567890123').statusCode).toBe(400);
    expect(run('ac_123456789012').nextCalled).toBe(true);
  });
});
