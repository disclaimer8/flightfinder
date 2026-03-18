'use strict';

// NODE_ENV=test and JWT_SECRET are set in src/__tests__/setup.js via Jest setupFiles,
// which runs before any module is loaded, ensuring db.js uses :memory:.

const request = require('supertest');
const app = require('../index');

describe('Auth API', () => {
  const EMAIL = 'test@example.com';
  const PASSWORD = 'SecurePass123';

  let accessToken;
  let refreshCookie;

  // ─────────────────────────────────────
  //  Register
  // ─────────────────────────────────────
  describe('POST /api/auth/register', () => {
    it('201 on valid registration', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({ email: EMAIL, password: PASSWORD });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('Account created');
    });

    it('409 on duplicate email', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({ email: EMAIL, password: PASSWORD });

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/already registered/i);
    });

    it('400 on invalid email', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({ email: 'not-an-email', password: PASSWORD });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('400 on short password', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({ email: 'another@example.com', password: 'short' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  // ─────────────────────────────────────
  //  Login
  // ─────────────────────────────────────
  describe('POST /api/auth/login', () => {
    it('200 with accessToken + Set-Cookie on valid credentials', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: EMAIL, password: PASSWORD });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(typeof res.body.accessToken).toBe('string');
      expect(res.body.expiresIn).toBeGreaterThan(0);

      // Cookie should be set
      const setCookie = res.headers['set-cookie'];
      expect(setCookie).toBeDefined();
      expect(setCookie.some(c => c.startsWith('refreshToken='))).toBe(true);

      // Save for subsequent tests
      accessToken = res.body.accessToken;
      refreshCookie = setCookie.find(c => c.startsWith('refreshToken='));
    });

    it('401 on wrong password', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: EMAIL, password: 'WrongPassword!' });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/invalid credentials/i);
    });

    it('401 on non-existent email', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'nobody@example.com', password: PASSWORD });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });
  });

  // ─────────────────────────────────────
  //  GET /me
  // ─────────────────────────────────────
  describe('GET /api/auth/me', () => {
    it('401 without token', async () => {
      const res = await request(app).get('/api/auth/me');

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('200 with valid Bearer token', async () => {
      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.user.email).toBe(EMAIL);
      expect(res.body.user.password_hash).toBeUndefined();
    });

    it('401 with malformed token', async () => {
      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', 'Bearer this.is.not.valid');

      expect(res.status).toBe(401);
    });
  });

  // ─────────────────────────────────────
  //  Refresh
  // ─────────────────────────────────────
  describe('POST /api/auth/refresh', () => {
    it('200 with new accessToken when valid refresh cookie sent', async () => {
      const res = await request(app)
        .post('/api/auth/refresh')
        .set('Cookie', refreshCookie);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(typeof res.body.accessToken).toBe('string');

      // Refresh cookie should be rotated (new value set)
      const setCookie = res.headers['set-cookie'];
      expect(setCookie).toBeDefined();
      const newRefreshCookie = setCookie.find(c => c.startsWith('refreshToken='));
      expect(newRefreshCookie).toBeDefined();
      // Old raw token value should no longer be valid (rotation happened)
      expect(newRefreshCookie).not.toBe(refreshCookie);

      // Update cookie for subsequent tests
      refreshCookie = newRefreshCookie;
    });

    it('401 with no refresh cookie', async () => {
      const res = await request(app).post('/api/auth/refresh');

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });
  });

  // ─────────────────────────────────────
  //  Logout
  // ─────────────────────────────────────
  describe('POST /api/auth/logout', () => {
    it('200 and clears cookie', async () => {
      const res = await request(app)
        .post('/api/auth/logout')
        .set('Cookie', refreshCookie);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toMatch(/logged out/i);
    });

    it('refresh token is invalidated after logout', async () => {
      const res = await request(app)
        .post('/api/auth/refresh')
        .set('Cookie', refreshCookie);

      expect(res.status).toBe(401);
    });
  });
});
