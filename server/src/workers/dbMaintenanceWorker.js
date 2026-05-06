'use strict';

// SQLite maintenance worker — runs WAL checkpoint + incremental_vacuum
// hourly to keep the DB file size and WAL bounded after bulk DELETE+INSERT
// refresh cycles (FAA registry, OurAirports, aircraft_db).
//
// Why both:
//   - wal_checkpoint(TRUNCATE) flushes the WAL pages to the main DB file
//     and shrinks the WAL file back to zero. Without periodic truncation
//     the WAL grows unbounded — observed 579MB on prod before activation.
//   - incremental_vacuum reclaims free pages from the main DB file when
//     auto_vacuum=INCREMENTAL is set. Without this, refresh cycles
//     accumulate empty pages and the file size never shrinks (observed
//     645MB allocated for 70MB live data on prod).
//
// Both operations are safe to run while the DB serves reads/writes —
// better-sqlite3 holds the lock for milliseconds, application
// requests pause for the lock window, no risk of corruption.

const CYCLE_INTERVAL_MS = 60 * 60 * 1000;     // hourly
const INITIAL_DELAY_MS  = 5 * 60 * 1000;      // 5 min after boot

let _runCycleImpl = null;

function runCycle() {
  if (_runCycleImpl) return _runCycleImpl();
  try {
    const { db } = require('../models/db');
    const beforeWal = db.prepare("SELECT * FROM pragma_wal_checkpoint('TRUNCATE')").get() || {};
    const freed = db.pragma('incremental_vacuum');
    console.log(
      `[db-maintenance] checkpoint busy=${beforeWal.busy} log=${beforeWal.log} checkpointed=${beforeWal.checkpointed} | incremental_vacuum freed=${JSON.stringify(freed)}`
    );
  } catch (err) {
    console.warn('[db-maintenance] cycle failed:', err.message);
  }
}

/**
 * Start the SQLite maintenance worker.
 * Always-on (no env gate) — checkpoint+vacuum are essential hygiene,
 * not an optional feature.
 *
 * @returns {function} stop — clears timers
 */
exports.startDbMaintenanceWorker = () => {
  let intervalTimer = null;
  const initialTimer = setTimeout(() => {
    runCycle();
    intervalTimer = setInterval(runCycle, CYCLE_INTERVAL_MS);
  }, INITIAL_DELAY_MS);
  console.log(`[db-maintenance] scheduled: first run in ${INITIAL_DELAY_MS / 1000}s, then hourly`);
  return function stop() {
    clearTimeout(initialTimer);
    if (intervalTimer) clearInterval(intervalTimer);
  };
};

exports._runCycleForTest = runCycle;
exports._setRunCycleImplForTest = (fn) => { _runCycleImpl = fn; };
