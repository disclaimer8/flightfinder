'use strict';

const obsModel = require('../models/observations');

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
const MIN_SAMPLE = 10;

function percentile(nums, p) {
  if (!nums.length) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

function predictDelay({ airline, flightNumber, dep, arr }) {
  const since = Date.now() - NINETY_DAYS_MS;

  // tier 1: same flight
  let rows = obsModel.getByExactFlight(airline, flightNumber, since);
  let scope = 'exact-flight';

  // tier 2: same route + airline
  if (rows.length < MIN_SAMPLE) {
    rows = obsModel.getByRouteAirline(dep, arr, airline, since);
    scope = 'route-airline';
  }

  if (rows.length < MIN_SAMPLE) {
    return { confidence: 'low', message: 'Collecting data — predictions available soon', scope: 'insufficient' };
  }

  const delays = rows.map(r => r.delay_minutes);
  const median   = percentile(delays, 50);
  const p75      = percentile(delays, 75);
  const onTime   = delays.filter(d => d < 15).length;
  const onTimePct = onTime / delays.length;
  const confidence = delays.length >= 30 ? 'high' : 'medium';

  return { median, p75, onTimePct, confidence, sample: delays.length, scope };
}

module.exports = { predictDelay };
