// Sentry MUST be initialised before any other module is required so that
// OpenTelemetry-based auto-instrumentation (HTTP, Express, etc.) can patch
// modules at load time. Keep this file import-side-effect-only.

const dotenvPath = require('path').join(__dirname, '../.env');
require('dotenv').config({ path: dotenvPath });

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
