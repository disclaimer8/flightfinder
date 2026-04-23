'use strict';

const airlabs = require('../services/airlabsService');
const obsModel = require('../models/observations');

const INITIAL_DELAY_MS = 3 * 60 * 1000;       // 3 min after boot
const CYCLE_INTERVAL_MS = 6 * 60 * 60 * 1000; // every 6 hours
const TOP_N = Number(process.env.INGEST_TOP_ROUTES || 30);
const WINDOW_DAYS = 30; // last 30 days of observed_routes for top-N

// AirLabs /schedules?dep_iata=XXX returns ALL of today's scheduled departures
// for one airport (~1500-2500 rows for big hubs). One call per origin per
// cycle vs AeroDataBox's two 12h-window calls. At top-30 origins × 4 cycles/day
// that's 120 calls/day — well inside the 25k/month developer plan.
async function runCycle() {
  const sinceMs = Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const top = obsModel.getTopRoutes(sinceMs, TOP_N);
  if (!top.length) {
    console.log('[delayIngest] no top routes yet — skipping cycle');
    return;
  }

  // Build the destination filter so we only persist flights to airports we
  // care about (top-N routes share endpoints).
  const byOrigin = new Map();
  for (const r of top) {
    if (!byOrigin.has(r.dep_iata)) byOrigin.set(r.dep_iata, new Set());
    byOrigin.get(r.dep_iata).add(r.arr_iata);
  }

  let persisted = 0;
  let skippedNotInDestSet = 0;
  for (const [origin, destSet] of byOrigin.entries()) {
    try {
      const schedule = await airlabs.getSchedules(origin);
      if (!Array.isArray(schedule) || !schedule.length) continue;

      const observedAt = Date.now();
      for (const f of schedule) {
        const arr = (f.arr_iata || '').toUpperCase();
        if (!arr || !destSet.has(arr)) { skippedNotInDestSet++; continue; }
        const airline = (f.airline_iata || '').toUpperCase();
        const flightNumber = String(f.flight_number || '').replace(/\D/g, '');
        if (!airline || !flightNumber) continue;

        // Prefer ts (epoch seconds) when present — already UTC. Fall back to
        // the *_utc string fields. Multiply by 1000 → ms epoch.
        const scheduledDep = f.dep_time_ts  ? f.dep_time_ts  * 1000 : (f.dep_time_utc ? Date.parse(f.dep_time_utc) : null);
        const actualDep    = f.dep_actual_ts ? f.dep_actual_ts * 1000 : (f.dep_actual_utc ? Date.parse(f.dep_actual_utc) : null);
        const scheduledArr = f.arr_time_ts  ? f.arr_time_ts  * 1000 : (f.arr_time_utc ? Date.parse(f.arr_time_utc) : null);
        const actualArr    = f.arr_actual_ts ? f.arr_actual_ts * 1000 : (f.arr_actual_utc ? Date.parse(f.arr_actual_utc) : null);
        if (!scheduledDep || !scheduledArr) continue;

        // Prefer arr_delayed (what the user feels). delay > 0 = late.
        const delayMinutes = (f.arr_delayed != null) ? Number(f.arr_delayed)
          : (actualArr && scheduledArr) ? Math.round((actualArr - scheduledArr) / 60000)
          : null;

        const status = mapStatus(f.status, actualArr);

        obsModel.upsertObservation({
          dep_iata: origin.toUpperCase(),
          arr_iata: arr,
          airline_iata: airline,
          flight_number: flightNumber,
          aircraft_icao: f.aircraft_icao || null,
          scheduled_dep: scheduledDep,
          actual_dep:    actualDep,
          scheduled_arr: scheduledArr,
          actual_arr:    actualArr,
          delay_minutes: delayMinutes,
          status,
          observed_at:   observedAt,
        });
        persisted++;
      }
    } catch (err) {
      console.warn(`[delayIngest] origin=${origin} failed: ${err.message}`);
    }
  }
  console.log(`[delayIngest] cycle done origins=${byOrigin.size} persisted=${persisted} skipped_dest=${skippedNotInDestSet}`);
}

// AirLabs status taxonomy: scheduled / en-route / landed / cancelled / unknown.
// Our schema uses: scheduled / completed / canceled — map accordingly.
function mapStatus(airlabsStatus, actualArr) {
  if (airlabsStatus === 'cancelled') return 'canceled';
  if (airlabsStatus === 'landed' || actualArr) return 'completed';
  return 'scheduled';
}

exports.startDelayIngestionWorker = () => {
  if (process.env.INGEST_ENABLED !== '1') {
    console.log('[delayIngest] disabled (INGEST_ENABLED != 1)');
    return () => {};
  }
  if (!airlabs.getSchedules || !process.env.AIRLABS_API_KEY) {
    console.log('[delayIngest] AirLabs not configured — skipping');
    return () => {};
  }

  let intervalTimer = null;
  const initialTimer = setTimeout(() => {
    runCycle().catch(err => console.warn('[delayIngest] initial cycle failed:', err.message));
    intervalTimer = setInterval(() => {
      runCycle().catch(err => console.warn('[delayIngest] cycle failed:', err.message));
    }, CYCLE_INTERVAL_MS);
  }, INITIAL_DELAY_MS);

  console.log(`[delayIngest] scheduled (AirLabs source): first pull in ${INITIAL_DELAY_MS/1000}s, then every ${CYCLE_INTERVAL_MS/3600000}h, topN=${TOP_N}`);
  return function stop() {
    clearTimeout(initialTimer);
    if (intervalTimer) clearInterval(intervalTimer);
  };
};

exports._runCycleForTest = runCycle;
