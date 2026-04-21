'use strict';

const adsblolService = require('../services/adsblolService');

// ICAO types polled every cycle. adsb.lol /v2/type returns ALL live aircraft
// of each type worldwide — one call per type, globally distributed routes resolved.
//
// The list MUST cover the families our /api/aircraft/routes endpoint exposes,
// or those families will show zero coverage no matter how many planes are in
// the sky. The original short list was all wide-bodies, which is why Boeing 737
// (the most-produced airliner worldwide) and A320 narrow-bodies were absent.
//
// Coverage map (family → polled ICAO types):
//   Boeing 737          → B737, B738, B739, B38M, B39M
//   Boeing 747          → B748
//   Boeing 757          → B752, B753
//   Boeing 767          → B763, B764
//   Boeing 777          → B772, B77W, B773, B778, B779
//   Boeing 787          → B788, B789, B78X
//   Airbus A220         → BCS1, BCS3
//   Airbus A319/A320/A321 (ceo+neo) → A319, A320, A321, A19N, A20N, A21N
//   Airbus A330         → A332, A333, A338, A339
//   Airbus A340         → A342, A343, A345, A346
//   Airbus A350         → A359, A35K
//   Airbus A380         → A388
//   Embraer E-Jets      → E170, E75L, E190, E195, E290, E295
//   CRJ / Dash 8 / ATR  → CRJ7, CRJ9, DH8D, AT72, AT76
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
