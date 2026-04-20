'use strict';

// CSRF protection for cookie-authenticated, state-changing endpoints.
//
// Our auth model:
//   - Access tokens are sent via `Authorization: Bearer` (not CSRF-vulnerable).
//   - A single httpOnly `refreshToken` cookie is scoped to `/api/auth/refresh`
//     and carries `sameSite: 'strict'`, which blocks cross-site submission at
//     the browser level.
//   - This middleware is the defense-in-depth second layer: it validates the
//     `Origin` (fallback `Referer`) header on every state-changing request
//     that reads the cookie, and rejects anything not from an allowed origin.
//
// State-changing requests coming from a browser ALWAYS have an `Origin` header.
// Requests with no Origin/Referer are allowed through (non-browser clients
// such as the Capacitor native shell or server-to-server curl) because they
// are not reachable by a CSRF attack — CSRF requires a victim's browser to
// forge the request from a third-party page.
//
// In NODE_ENV=test this check is skipped so supertest can exercise
// cookie-based endpoints without mocking browser headers.

const _splitEnv = (s) =>
  (s || '')
    .split(',')
    .map(o => o.trim())
    .filter(Boolean);

function loadAllowedOrigins() {
  const fromEnv = _splitEnv(process.env.ALLOWED_ORIGINS);
  if (fromEnv.length) return new Set(fromEnv);
  // Dev fallback mirrors the CORS config in index.js.
  if (process.env.NODE_ENV !== 'production') {
    return new Set(['http://localhost:3000', 'http://localhost:5173']);
  }
  return new Set();
}

module.exports = function csrfOriginCheck(req, res, next) {
  if (process.env.NODE_ENV === 'test') return next();
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    return next();
  }

  const header = req.get('origin') || req.get('referer');
  if (!header) return next(); // non-browser client — CSRF not applicable

  let originHost;
  try { originHost = new URL(header).origin; } catch { originHost = null; }

  const allowed = loadAllowedOrigins();
  if (!originHost || !allowed.has(originHost)) {
    return res.status(403).json({ success: false, message: 'CSRF origin check failed' });
  }
  next();
};
