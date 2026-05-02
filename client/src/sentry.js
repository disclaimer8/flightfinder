import * as Sentry from '@sentry/react';

const dsn = import.meta.env.VITE_SENTRY_DSN;

if (dsn) {
  // Error reporting only — no performance tracing. We removed
  // browserTracingIntegration + tracesSampleRate/tracePropagationTargets
  // in batch 4. Bundle size didn't move (the @sentry SDK ships as one
  // ~460KB raw / 124KB brotli blob and `sideEffects: true` prevents
  // tree-shaking), but the runtime gain is real: no per-fetch span
  // creation, no propagation header injection on every API call. Default
  // integrations (GlobalHandlers, Breadcrumbs, LinkedErrors, Dedupe etc.)
  // remain and cover all error capture. Re-add tracing only if we start
  // using performance dashboards. To actually shrink the SDK chunk would
  // need a switch to a leaner reporter (e.g. @bugsnag/browser or a custom
  // POST-to-webhook handler) — separate iteration.
  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    release: import.meta.env.VITE_SENTRY_RELEASE,
    sendDefaultPii: true,
  });
}

export { Sentry };
