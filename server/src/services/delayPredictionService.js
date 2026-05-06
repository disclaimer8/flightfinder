'use strict';

const obsModel = require('../models/observations');
const airlabsDelay = require('./airlabsDelayService');

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
const MIN_SAMPLE = 10;

function percentile(nums, p) {
  if (!nums.length) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

/**
 * 4-tier async delay prediction:
 *   1. exact-flight (≥10 local obs)   → source=local, scope=exact-flight
 *   2. route-airline (≥10 local obs)  → source=local, scope=route-airline
 *   3. airlabs-fallback               → source=airlabs, scope=airlabs-fallback
 *   4. insufficient                   → source=none, scope=insufficient
 *
 * @param {object} params
 * @param {string} params.airline
 * @param {string} params.flightNumber
 * @param {string} params.dep
 * @param {string} params.arr
 * @returns {Promise<object>}
 */
async function predictDelay({ airline, flightNumber, dep, arr }) {
  const since = Date.now() - NINETY_DAYS_MS;

  // Tier 1: exact flight
  let rows = obsModel.getByExactFlight(airline, flightNumber, since);
  let scope = 'exact-flight';

  // Tier 2: route + airline
  if (rows.length < MIN_SAMPLE) {
    rows = obsModel.getByRouteAirline(dep, arr, airline, since);
    scope = 'route-airline';
  }

  if (rows.length >= MIN_SAMPLE) {
    const delays    = rows.map((r) => r.delay_minutes);
    const median    = percentile(delays, 50);
    const p75       = percentile(delays, 75);
    const onTime    = delays.filter((d) => d < 15).length;
    const onTimePct = onTime / delays.length;
    const confidence = delays.length >= 30 ? 'high' : 'medium';
    return { median, p75, onTimePct, confidence, sample: delays.length, scope, source: 'local' };
  }

  // Tier 3: AirLabs fallback for cold routes
  try {
    const stats = await airlabsDelay.getDelayStats({ airline, flightNumber, dep, arr });
    if (stats && stats.median != null) {
      return {
        median:     stats.median,
        onTimePct:  stats.onTimePct,
        confidence: 'medium',
        sample:     stats.sample,
        scope:      'airlabs-fallback',
        source:     'airlabs',
      };
    }
  } catch (err) {
    console.warn('[delayPrediction] airlabs fallback failed:', err.message);
  }

  // Tier 4: insufficient
  return {
    confidence: 'low',
    message:    'Collecting data — predictions available soon',
    scope:      'insufficient',
    source:     'none',
  };
}

module.exports = { predictDelay };
