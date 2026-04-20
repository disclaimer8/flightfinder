'use strict';

// Unit tests for csrfOriginCheck middleware.
// The middleware short-circuits when NODE_ENV=test so the main auth.test.js
// suite can exercise /refresh + /logout without mocking browser headers.
// Here we temporarily flip NODE_ENV to exercise the real branches.

const csrfOriginCheck = require('../middleware/csrf');

function makeReq({ method = 'POST', origin, referer } = {}) {
  const headers = {};
  if (origin)  headers.origin  = origin;
  if (referer) headers.referer = referer;
  return {
    method,
    get(name) { return headers[name.toLowerCase()]; },
  };
}

function makeRes() {
  const res = {
    statusCode: 200,
    body: null,
    status(c) { this.statusCode = c; return this; },
    json(b)  { this.body = b; return this; },
  };
  return res;
}

describe('csrfOriginCheck middleware', () => {
  const savedEnv      = process.env.NODE_ENV;
  const savedOrigins  = process.env.ALLOWED_ORIGINS;

  beforeEach(() => {
    process.env.NODE_ENV        = 'production';
    process.env.ALLOWED_ORIGINS = 'https://himaxym.com,https://www.himaxym.com';
  });

  afterAll(() => {
    process.env.NODE_ENV        = savedEnv;
    if (savedOrigins === undefined) delete process.env.ALLOWED_ORIGINS;
    else process.env.ALLOWED_ORIGINS = savedOrigins;
  });

  it('lets safe methods pass without checking Origin', () => {
    const next = jest.fn();
    const res  = makeRes();
    csrfOriginCheck(makeReq({ method: 'GET', origin: 'https://evil.example' }), res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(200);
  });

  it('rejects POST from a disallowed origin with 403', () => {
    const next = jest.fn();
    const res  = makeRes();
    csrfOriginCheck(makeReq({ origin: 'https://evil.example' }), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.body).toMatchObject({ success: false });
  });

  it('accepts POST from an allowed origin', () => {
    const next = jest.fn();
    const res  = makeRes();
    csrfOriginCheck(makeReq({ origin: 'https://himaxym.com' }), res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(200);
  });

  it('falls back to Referer when Origin is missing', () => {
    const next = jest.fn();
    const res  = makeRes();
    csrfOriginCheck(makeReq({ referer: 'https://himaxym.com/app/settings' }), res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('rejects POST when Referer is from a disallowed origin', () => {
    const next = jest.fn();
    const res  = makeRes();
    csrfOriginCheck(makeReq({ referer: 'https://evil.example/steal' }), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });

  it('lets non-browser clients (no Origin, no Referer) through', () => {
    // CSRF attacks require a victim browser; curl/native-shell requests have no
    // attacker-forgeable path here because sessions live in httpOnly cookies
    // that these clients don't possess to begin with.
    const next = jest.fn();
    const res  = makeRes();
    csrfOriginCheck(makeReq({}), res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('is a no-op in NODE_ENV=test (unit test suite relies on this)', () => {
    process.env.NODE_ENV = 'test';
    const next = jest.fn();
    const res  = makeRes();
    csrfOriginCheck(makeReq({ origin: 'https://evil.example' }), res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(200);
  });
});
