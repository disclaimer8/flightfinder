'use strict';

const tripsModel = require('../models/trips');
const tripStatus = require('../services/tripStatusService');
const push       = require('../services/pushService');

const INITIAL_DELAY_MS    = 5 * 60 * 1000;
const CYCLE_INTERVAL_MS   = 15 * 60 * 1000;   // every 15 min
const LOOKAHEAD_MS        = 24 * 60 * 60 * 1000; // scan next 24h only
const REALERT_COOLDOWN_MS = 60 * 60 * 1000;   // don't re-alert same trip inside 1h

function alertThresholdMin() {
  const n = Number(process.env.ALERT_THRESHOLD_MIN);
  return Number.isFinite(n) && n > 0 ? n : 30;
}

// In-memory dedup: tripId -> lastAlertedAtMs. Lost on restart (fine for v1 —
// cooldown just resets and worst case one extra alert after a deploy).
const alertedAt = new Map();

async function runCycle() {
  const now = Date.now();
  const trips = tripsModel.listUpcomingWithAlerts(now, now + LOOKAHEAD_MS);
  if (!trips.length) return;
  const threshold = alertThresholdMin();
  let notified = 0;
  for (const t of trips) {
    try {
      const status = await tripStatus.compute(t);
      const pred   = status.prediction;
      if (!pred || pred.confidence === 'low') continue;
      if ((pred.median ?? 0) < threshold) continue;
      const last = alertedAt.get(t.id) || 0;
      if (now - last < REALERT_COOLDOWN_MS) continue;
      await push.sendToUser(t.user_id, {
        title: `Possible delay on ${t.airline_iata}${t.flight_number}`,
        body:  `Predicted median delay ~${pred.median} min based on ${pred.sample} observations.`,
        url:   `/trips/${t.id}`,
      });
      alertedAt.set(t.id, now);
      notified++;
    } catch (err) {
      console.warn(`[tripAlert] trip ${t.id} failed:`, err.message);
    }
  }
  if (notified) console.log(`[tripAlert] cycle notified=${notified}`);
}

exports.startTripAlertWorker = () => {
  if (process.env.TRIPS_ENABLED === '0' || !push.isConfigured()) {
    console.log('[tripAlert] disabled (TRIPS_ENABLED=0 or VAPID not set)');
    return () => {};
  }
  let intervalTimer = null;
  const initialTimer = setTimeout(() => {
    runCycle().catch((err) => console.warn('[tripAlert] initial failed:', err.message));
    intervalTimer = setInterval(() => {
      runCycle().catch((err) => console.warn('[tripAlert] failed:', err.message));
    }, CYCLE_INTERVAL_MS);
  }, INITIAL_DELAY_MS);
  console.log(`[tripAlert] scheduled: first run in ${INITIAL_DELAY_MS/1000}s, then every ${CYCLE_INTERVAL_MS/60000}min`);
  return function stop() {
    clearTimeout(initialTimer);
    if (intervalTimer) clearInterval(intervalTimer);
  };
};

exports._runCycleForTest = runCycle;
