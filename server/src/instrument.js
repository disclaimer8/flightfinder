// Sentry MUST be initialised before any other module is required so that
// OpenTelemetry-based auto-instrumentation (HTTP, Express, etc.) can patch
// modules at load time. Keep this file import-side-effect-only.

const dotenvPath = require('path').join(__dirname, '../.env');
require('dotenv').config({ path: dotenvPath });

// Raise the default EventEmitter listener ceiling. adsb.lol + aerodatabox +
// wikimedia + stripe all use axios or native fetch with keep-alive sockets;
// each concurrent request adds an `error` listener to the TLSSocket for its
// own timeout handling. With maxSockets pooled at 8 and up to 20 concurrent
// requests per cycle, 10 is too low and the warning floods logs. 30 covers
// realistic bursts without hiding a real leak (a real leak would climb above
// 30 monotonically rather than plateau).
require('events').EventEmitter.defaultMaxListeners = 30;

const dsn = process.env.SENTRY_DSN;
if (dsn) {
  const Sentry = require('@sentry/node');
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || 'development',
    release: process.env.SENTRY_RELEASE,
    sendDefaultPii: true,
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
  });
}
