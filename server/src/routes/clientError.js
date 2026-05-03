// /api/client-error — thin endpoint that receives error reports from
// the in-house client reporter (replaces the @sentry/react browser SDK)
// and forwards them to the existing @sentry/node instance.
//
// Why a server hop instead of the browser POSTing directly to Sentry:
//   1. Bundle size — the browser SDK is ~120KB brotli; the in-house
//      reporter is <1KB. Net win is the whole point of this swap.
//   2. CSP — connect-src no longer needs `*.ingest.de.sentry.io`.
//      Reduces fingerprint surface.
//   3. We can rate-limit and validate payloads at the edge, so a
//      compromised client can't drown us in noise.
//
// Trade-offs:
//   - Lose breadcrumbs / performance traces / dedupe-by-fingerprint
//     that the SDK does client-side. We never used those features.
//   - Source-map symbolication still works because Sentry node accepts
//     captureException(new Error(payload)) and resolves stacks against
//     the uploaded release artifacts. Release id is forwarded from
//     import.meta.env.VITE_SENTRY_RELEASE.

const express   = require('express');
const rateLimit = require('express-rate-limit');

const router = express.Router();

// Conservative limit — a healthy client emits 0–5 reports per session.
// 20/min/IP catches a runaway loop without blocking legitimate spikes
// (e.g. a buggy deploy hitting many users within a minute).
const errorLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

const MAX_BODY_BYTES = 16 * 1024; // matches express.json() global cap
const ALLOWED_KINDS = new Set(['error', 'unhandledrejection']);

router.post('/', errorLimiter, (req, res) => {
  const body = req.body || {};

  // Defensive — content-length is also enforced by express.json(),
  // but check the parsed shape too. Reject silently with 204 so we
  // don't leak validation rules to a malicious client.
  if (typeof body !== 'object' || Array.isArray(body)) {
    return res.status(204).end();
  }
  const message = String(body.message || '').slice(0, 2_000);
  if (!message) return res.status(204).end();

  const kind = ALLOWED_KINDS.has(body.kind) ? body.kind : 'error';

  let Sentry;
  try { Sentry = require('@sentry/node'); } catch { /* not installed in tests */ }

  if (Sentry && typeof Sentry.captureException === 'function') {
    const err = new Error(message);
    if (body.stack) err.stack = String(body.stack).slice(0, 8_000);

    Sentry.withScope(scope => {
      scope.setTag('source', 'browser');
      scope.setTag('kind', kind);
      if (body.release) scope.setTag('release', String(body.release).slice(0, 64));
      scope.setExtra('url',       String(body.url || '').slice(0, 500));
      scope.setExtra('userAgent', String(body.userAgent || '').slice(0, 500));
      scope.setExtra('filename',  body.filename || null);
      scope.setExtra('lineno',    body.lineno   || null);
      scope.setExtra('colno',     body.colno    || null);
      scope.setExtra('clientTs',  body.ts || null);
      Sentry.captureException(err);
    });
  } else {
    // Sentry disabled (no DSN) — log to stdout so the report isn't lost
    // entirely. PM2 captures stdout to /var/log so postmortem is possible.
    console.warn('[client-error]', kind, message);
  }

  // Always 204: this endpoint is best-effort. Returning a body would
  // tempt clients to retry on failure and amplify their own bug.
  res.status(204).end();
});

// Dummy export to make the body cap explicit if someone reads this file
// looking for "what limits the request size" — express.json() at the app
// level enforces 16KB; here is the symbolic reference.
router.MAX_BODY_BYTES = MAX_BODY_BYTES;

module.exports = router;
