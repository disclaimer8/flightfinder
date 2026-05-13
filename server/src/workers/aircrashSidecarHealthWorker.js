// Periodically probes the aircrash-sidecar (Go) HTTP API on 127.0.0.1:5003 and
// forwards 5xx responses to Sentry. nginx proxies /api/safety/global/ DIRECTLY
// to the sidecar, bypassing Node — so the existing @sentry/node Express
// integration never sees those failures. Without this probe, a broken sidecar
// (e.g. missing canonical-display tables after a fresh accidents.db upload —
// see reference_aircrash-db-upload-recipe) is silent.
//
// Health surfaces probed match what nginx exposes to the public:
//   GET /stats/aircrafts?commercial=1
//   GET /stats/operators?commercial=1

const axios = require('axios');

let Sentry = null;
try { Sentry = require('@sentry/node'); } catch { /* optional dep in tests */ }

const SIDECAR_URL = process.env.AIRCRASH_SIDECAR_URL || 'http://127.0.0.1:5003';
const HEALTH_PROBES = ['/stats/aircrafts?commercial=1', '/stats/operators?commercial=1'];
const PROBE_TIMEOUT_MS = 5000;
const INITIAL_DELAY_MS = 30 * 1000;          // let app + sidecar finish booting
const CYCLE_INTERVAL_MS = 5 * 60 * 1000;     // 5 min — sidecar is local, cheap

function captureSidecarFailure(probe, status, body) {
  console.warn(`[aircrash-sidecar-health] ${probe} -> ${status}: ${String(body).slice(0, 200)}`);
  if (!Sentry || typeof Sentry.captureMessage !== 'function') return;
  try {
    Sentry.captureMessage('aircrash-sidecar 5xx', {
      level: 'error',
      tags: { component: 'aircrash-sidecar', probe, status: String(status) },
      contexts: {
        sidecar: { url: `${SIDECAR_URL}${probe}`, status, body: String(body).slice(0, 500) },
      },
      // Stable fingerprint so 1 ongoing outage = 1 Sentry issue, not N events.
      fingerprint: ['aircrash-sidecar', probe, String(status)],
    });
  } catch { /* never let monitoring crash the worker */ }
}

async function probeOnce(probe) {
  try {
    const res = await axios.get(`${SIDECAR_URL}${probe}`, {
      timeout: PROBE_TIMEOUT_MS,
      validateStatus: () => true,        // we want all statuses, not throws
    });
    if (res.status >= 500) {
      captureSidecarFailure(probe, res.status, res.data);
    }
  } catch (err) {
    // Network errors (sidecar restarting, ECONNREFUSED, ETIMEDOUT) are
    // transient — log but do not Sentry-spam. If the sidecar is genuinely
    // down for a sustained period, the public /safety/global page returns
    // 502 via nginx, and an external uptime check (Sentry Monitors / UptimeRobot)
    // is the right tool — not this in-process probe.
    console.warn(`[aircrash-sidecar-health] ${probe} fetch error: ${err.code || err.message}`);
  }
}

async function runCycle() {
  for (const probe of HEALTH_PROBES) {
    await probeOnce(probe);
  }
}

/**
 * Start the periodic health probe. Returns a stop() function that clears
 * pending timers. Disabled when AIRCRASH_HEALTH_DISABLED=1 or in NODE_ENV=test.
 */
exports.startAircrashSidecarHealthWorker = function startAircrashSidecarHealthWorker() {
  if (process.env.NODE_ENV === 'test' || process.env.AIRCRASH_HEALTH_DISABLED === '1') {
    return () => {};
  }

  let intervalTimer = null;
  const initialTimer = setTimeout(() => {
    runCycle().catch((err) => console.warn('[aircrash-sidecar-health] initial cycle failed:', err.message));
    intervalTimer = setInterval(() => {
      runCycle().catch((err) => console.warn('[aircrash-sidecar-health] cycle failed:', err.message));
    }, CYCLE_INTERVAL_MS);
  }, INITIAL_DELAY_MS);

  console.log(`[aircrash-sidecar-health] worker scheduled: first probe in ${INITIAL_DELAY_MS / 1000}s, then every ${CYCLE_INTERVAL_MS / 60000}min`);

  return function stop() {
    clearTimeout(initialTimer);
    if (intervalTimer) clearInterval(intervalTimer);
  };
};

// Exposed for tests
exports._internal = { probeOnce, runCycle, captureSidecarFailure, HEALTH_PROBES };
