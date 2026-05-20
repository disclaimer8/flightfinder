'use strict';

const adsblolService = require('../services/adsblolService');

// ICAO types polled every cycle. See the long-form comment at the bottom of
// this file for which family each code covers.
const AIRCRAFT_TYPES = [
  // Boeing narrow-body
  'B737', 'B738', 'B739', 'B38M', 'B39M',
  // Boeing wide-body
  'B748', 'B752', 'B753', 'B763', 'B764',
  'B772', 'B77W', 'B773', 'B778', 'B779',
  'B788', 'B789', 'B78X',
  // Airbus narrow-body (ceo + neo)
  'BCS1', 'BCS3',
  'A319', 'A320', 'A321',
  'A19N', 'A20N', 'A21N',
  // Airbus wide-body
  'A332', 'A333', 'A338', 'A339',
  'A342', 'A343', 'A345', 'A346',
  'A359', 'A35K',
  'A388',
  // Regional
  'E170', 'E75L', 'E190', 'E195', 'E290', 'E295',
  'CRJ7', 'CRJ9',
  'DH8D',
  'AT72', 'AT76',
];

// Boot-trigger seed (5s) instead of the old 120s — gets the map populated
// promptly after pm2 reloads. Lower bound is "just past app.listen() bind".
const INITIAL_DELAY_MS  = 5 * 1000;
const CYCLE_INTERVAL_MS = 20 * 60 * 1000;
const PER_TYPE_DELAY_MS = 3 * 1000;

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

const INITIAL_LAST_CYCLE = Object.freeze({
  ran_at: null, duration_ms: 0, types: 0, fetched: 0, resolved: 0, persisted: 0,
});

exports.getLastCycle = () => {
  try {
    const { getWorkerState } = require('../models/db');
    const v = getWorkerState('adsblol.lastCycle');
    return v || { ...INITIAL_LAST_CYCLE };
  } catch {
    return { ...INITIAL_LAST_CYCLE };
  }
};
exports.AIRCRAFT_TYPES = AIRCRAFT_TYPES;
exports.INITIAL_DELAY_MS = INITIAL_DELAY_MS;
exports.CYCLE_INTERVAL_MS = CYCLE_INTERVAL_MS;

async function runCycle(types = AIRCRAFT_TYPES) {
  const t0 = Date.now();
  let fetched = 0, resolved = 0, persisted = 0;
  for (const type of types) {
    try {
      const r = await adsblolService.pullAndPersistType(type);
      fetched   += r.fetched   || 0;
      resolved  += r.resolved  || 0;
      persisted += r.persisted || 0;
    } catch (err) {
      console.warn(`[adsblol] pullAndPersistType(${type}) threw: ${err.message}`);
    }
    await sleep(PER_TYPE_DELAY_MS);
  }
  const metrics = {
    ran_at: Date.now(),
    duration_ms: Date.now() - t0,
    types: types.length,
    fetched, resolved, persisted,
  };
  try {
    const { setWorkerState } = require('../models/db');
    setWorkerState('adsblol.lastCycle', metrics);
  } catch (e) {
    console.warn('[adsblol] failed to persist lastCycle:', e.message);
  }
  console.log(`[adsblol] cycle done types=${types.length} fetched=${fetched} resolved=${resolved} persisted=${persisted}`);
}

// Test seam — call with a short types list to keep unit tests fast.
exports._runCycleForTest = (types) => runCycle(types);

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
