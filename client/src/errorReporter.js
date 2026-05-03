// Thin client-side error reporter — replaces @sentry/react which weighed
// in at ~450KB raw / 124KB brotli (`sideEffects: true` blocks tree-shake).
// We capture unhandled errors + promise rejections, POST a small JSON
// payload to /api/client-error, and stop after MAX_REPORTS_PER_SESSION
// to avoid runaway floods. The server endpoint forwards to Sentry node
// (already running) so the dashboards keep filling up — only the client
// SDK is gone.
//
// What we lose vs. the SDK: breadcrumbs, source-map symbolication on the
// client, performance tracing, automatic dedupe. We never used tracing,
// breadcrumbs are nice-to-have, and source maps stay symbolicated by
// Sentry node when the release matches. Acceptable trade for ~120KB
// brotli on the critical path.

const ENDPOINT  = '/api/client-error';
const MAX_REPORTS_PER_SESSION = 5;
const MAX_MESSAGE_LEN = 2_000;
const MAX_STACK_LEN   = 8_000;

let sent = 0;
const seen = new Set();

function trim(s, max) {
  if (typeof s !== 'string') return '';
  return s.length > max ? s.slice(0, max) : s;
}

function dedupeKey(payload) {
  return `${payload.message}::${(payload.stack || '').split('\n').slice(0, 3).join('|')}`;
}

function report(payload) {
  if (sent >= MAX_REPORTS_PER_SESSION) return;
  const key = dedupeKey(payload);
  if (seen.has(key)) return;
  seen.add(key);
  sent += 1;

  const body = JSON.stringify({
    ...payload,
    url: window.location?.href,
    userAgent: navigator?.userAgent,
    release: import.meta.env.VITE_SENTRY_RELEASE || null,
    ts: new Date().toISOString(),
  });

  // sendBeacon survives page-unload; falls back to keepalive fetch which
  // also survives unload in modern browsers. No retry — best-effort.
  try {
    if (navigator.sendBeacon) {
      const blob = new Blob([body], { type: 'application/json' });
      if (navigator.sendBeacon(ENDPOINT, blob)) return;
    }
    fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => { /* swallow — this IS the error path */ });
  } catch {
    /* ignore — reporter must never throw */
  }
}

export function initErrorReporter() {
  // Skip in dev — we don't want local stack traces piling up in prod
  // Sentry, and dev tools already surface errors.
  if (import.meta.env.MODE !== 'production') return;

  window.addEventListener('error', (ev) => {
    if (!ev) return;
    const err = ev.error;
    report({
      kind: 'error',
      message: trim(ev.message || (err && err.message) || 'unknown', MAX_MESSAGE_LEN),
      stack:   trim((err && err.stack) || '', MAX_STACK_LEN),
      filename: ev.filename || null,
      lineno:   ev.lineno   || null,
      colno:    ev.colno    || null,
    });
  });

  window.addEventListener('unhandledrejection', (ev) => {
    const reason = ev?.reason;
    const isErr = reason instanceof Error;
    report({
      kind: 'unhandledrejection',
      message: trim(isErr ? reason.message : String(reason || 'rejected'), MAX_MESSAGE_LEN),
      stack:   trim(isErr ? reason.stack || '' : '', MAX_STACK_LEN),
    });
  });
}
