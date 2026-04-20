'use strict';

const adsblolService = require('../services/adsblolService');

// Popular wide-body / enthusiast types. adsb.lol /v2/type returns ALL live aircraft
// of each type worldwide — one call per type, globally distributed routes resolved.
const AIRCRAFT_TYPES = ['A388', 'A359', 'A35K', 'B77W', 'B789', 'B78X', 'B748', 'B772'];

const INITIAL_DELAY_MS = 2 * 60 * 1000;  // 2 min after boot — keep startup clean
const CYCLE_INTERVAL_MS = 20 * 60 * 1000; // every 20 min
const PER_TYPE_DELAY_MS = 3 * 1000;       // polite 3s spacing between types

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runCycle() {
  let resolvedTotal = 0;
  let persistedTotal = 0;
  for (const type of AIRCRAFT_TYPES) {
    try {
      const r = await adsblolService.pullAndPersistType(type);
      resolvedTotal += r.resolved;
      persistedTotal += r.persisted;
    } catch (err) {
      // One type failing must never halt the whole cycle.
      console.warn(`[adsblol] pullAndPersistType(${type}) threw: ${err.message}`);
    }
    await sleep(PER_TYPE_DELAY_MS);
  }
  console.log(`[adsblol] cycle done types=${AIRCRAFT_TYPES.length} resolved=${resolvedTotal} persisted=${persistedTotal}`);
}

/**
 * Start the background poller. Returns a stop() function that clears pending timers.
 * When adsb.lol is disabled via env, returns a silent-safe no-op stop fn.
 */
exports.startAdsbLolWorker = () => {
  if (!adsblolService.isEnabled()) {
    console.log('[adsblol] disabled');
    return () => {};
  }

  let intervalTimer = null;
  const initialTimer = setTimeout(() => {
    runCycle().catch(err => console.warn('[adsblol] initial cycle failed:', err.message));
    intervalTimer = setInterval(() => {
      runCycle().catch(err => console.warn('[adsblol] cycle failed:', err.message));
    }, CYCLE_INTERVAL_MS);
  }, INITIAL_DELAY_MS);

  console.log(`[adsblol] worker scheduled: first pull in ${INITIAL_DELAY_MS / 1000}s, then every ${CYCLE_INTERVAL_MS / 60000}min`);

  return function stop() {
    clearTimeout(initialTimer);
    if (intervalTimer) clearInterval(intervalTimer);
  };
};
