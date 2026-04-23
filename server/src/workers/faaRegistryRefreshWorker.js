'use strict';

const faaRegistryService = require('../services/faaRegistryService');

const INITIAL_DELAY_MS  = 2 * 60 * 1000;       // 2 min after boot
const CYCLE_INTERVAL_MS = 24 * 60 * 60 * 1000; // daily

async function runCycle() {
  try {
    const result = await faaRegistryService.bootstrap();
    if (result.skipped) {
      console.log('[faaRegistry-refresh] cycle complete — skipped (already fresh or disabled)');
    } else {
      console.log(`[faaRegistry-refresh] cycle complete — upserted ${result.upserted} rows`);
    }
  } catch (err) {
    console.warn('[faaRegistry-refresh] cycle failed:', err.message);
  }
}

/**
 * Start the FAA Registry daily refresh worker.
 * Gated by FAA_REGISTRY_REFRESH=1. Returns a stop() function.
 *
 * @returns {function} stop — clears timers
 */
exports.startFaaRegistryRefreshWorker = () => {
  if (process.env.FAA_REGISTRY_REFRESH !== '1') {
    console.log('[faaRegistry-refresh] disabled (FAA_REGISTRY_REFRESH != 1)');
    return () => {};
  }
  let intervalTimer = null;
  const initialTimer = setTimeout(() => {
    runCycle();
    intervalTimer = setInterval(runCycle, CYCLE_INTERVAL_MS);
  }, INITIAL_DELAY_MS);
  console.log(`[faaRegistry-refresh] scheduled: first pull in ${INITIAL_DELAY_MS / 1000}s, then every 24h`);
  return function stop() {
    clearTimeout(initialTimer);
    if (intervalTimer) clearInterval(intervalTimer);
  };
};

exports._runCycleForTest = runCycle;
