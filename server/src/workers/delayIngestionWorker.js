'use strict';

const aerodatabox = require('../services/aerodataboxService');
const obsModel    = require('../models/observations');
const { db } = require('../models/db');

const INITIAL_DELAY_MS = 3 * 60 * 1000;   // 3 min after boot
const CYCLE_INTERVAL_MS = 6 * 60 * 60 * 1000; // every 6 hours
const TOP_N = Number(process.env.INGEST_TOP_ROUTES || 30);
const WINDOW_DAYS = 30; // look at last 30 days of observed_routes for top-N

// We pull DEPARTURES for the origin airport, then filter to the destination in code.
// This uses 1 AeroDataBox call per origin airport per cycle — small, bounded budget.
async function runCycle() {
  const sinceMs = Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const top = obsModel.getTopRoutes(sinceMs, TOP_N);
  if (!top.length) {
    console.log('[delayIngest] no top routes yet — skipping cycle');
    return;
  }

  // Group by origin airport to minimise calls.
  const byOrigin = new Map();
  for (const r of top) {
    if (!byOrigin.has(r.dep_iata)) byOrigin.set(r.dep_iata, new Set());
    byOrigin.get(r.dep_iata).add(r.arr_iata);
  }

  const now = new Date();
  // AeroDataBox caps each airport-window call at 12h, so split last-24h into
  // two back-to-back 12h buckets per origin. Costs 2 calls × 2 units = 4 units
  // per origin per cycle (up from the broken single 24h call that cost 0 and
  // returned nothing).
  const mkWindow = (endMs) => ({
    from: new Date(endMs - 12 * 3600000).toISOString().slice(0, 16),
    to:   new Date(endMs).toISOString().slice(0, 16),
  });
  const windows = [mkWindow(now.getTime() - 12 * 3600000), mkWindow(now.getTime())];

  let persisted = 0;
  for (const [origin, destSet] of byOrigin.entries()) {
    try {
      const departures = [];
      for (const w of windows) {
        const batch = await aerodatabox.getAirportDepartures(origin, w.from, w.to);
        if (Array.isArray(batch)) departures.push(...batch);
      }
      for (const dep of departures) {
        const arr = dep.arrival?.airport?.iata;
        if (!arr || !destSet.has(arr)) continue;
        const airline = dep.airline?.iata;
        const flightNumber = dep.number?.replace(/[^0-9]/g, '');
        if (!airline || !flightNumber) continue;

        const scheduledDep = dep.departure?.scheduledTimeUtc ? Date.parse(dep.departure.scheduledTimeUtc) : null;
        const actualDep    = dep.departure?.actualTimeUtc    ? Date.parse(dep.departure.actualTimeUtc)    : null;
        const scheduledArr = dep.arrival?.scheduledTimeUtc   ? Date.parse(dep.arrival.scheduledTimeUtc)   : null;
        const actualArr    = dep.arrival?.actualTimeUtc      ? Date.parse(dep.arrival.actualTimeUtc)      : null;
        if (!scheduledDep || !scheduledArr) continue;

        const delayMinutes = (actualArr && scheduledArr) ? Math.round((actualArr - scheduledArr) / 60000) : null;

        obsModel.upsertObservation({
          dep_iata: origin, arr_iata: arr,
          airline_iata: airline, flight_number: flightNumber,
          aircraft_icao: dep.aircraft?.model || null,
          scheduled_dep: scheduledDep, actual_dep: actualDep,
          scheduled_arr: scheduledArr, actual_arr: actualArr,
          delay_minutes: delayMinutes,
          status: dep.status?.toLowerCase().includes('cancel') ? 'canceled'
                : (actualArr ? 'completed' : 'scheduled'),
          observed_at: Date.now(),
        });
        persisted++;
      }
    } catch (err) {
      console.warn(`[delayIngest] origin=${origin} failed: ${err.message}`);
    }
  }
  console.log(`[delayIngest] cycle done origins=${byOrigin.size} persisted=${persisted}`);
}

exports.startDelayIngestionWorker = () => {
  if (process.env.INGEST_ENABLED !== '1') {
    console.log('[delayIngest] disabled (INGEST_ENABLED != 1)');
    return () => {};
  }
  if (!aerodatabox.isEnabled()) {
    console.log('[delayIngest] aerodatabox not configured — skipping');
    return () => {};
  }

  let intervalTimer = null;
  const initialTimer = setTimeout(() => {
    runCycle().catch(err => console.warn('[delayIngest] initial cycle failed:', err.message));
    intervalTimer = setInterval(() => {
      runCycle().catch(err => console.warn('[delayIngest] cycle failed:', err.message));
    }, CYCLE_INTERVAL_MS);
  }, INITIAL_DELAY_MS);

  console.log(`[delayIngest] scheduled: first pull in ${INITIAL_DELAY_MS/1000}s, then every ${CYCLE_INTERVAL_MS/3600000}h, topN=${TOP_N}`);
  return function stop() {
    clearTimeout(initialTimer);
    if (intervalTimer) clearInterval(intervalTimer);
  };
};

exports._runCycleForTest = runCycle;
