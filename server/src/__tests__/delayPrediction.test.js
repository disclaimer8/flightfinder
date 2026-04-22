// server/src/__tests__/delayPrediction.test.js
const { db } = require('../models/db');
const obsModel = require('../models/observations');
const { predictDelay } = require('../services/delayPredictionService');

function seedObs({ airline, flight, dep, arr, delay, daysAgo }) {
  const now = Date.now();
  obsModel.upsertObservation({
    dep_iata: dep, arr_iata: arr, airline_iata: airline, flight_number: flight,
    aircraft_icao: 'B738',
    scheduled_dep: now - daysAgo * 86400000,
    actual_dep:    now - daysAgo * 86400000 + delay * 60000,
    scheduled_arr: now - daysAgo * 86400000 + 3600000,
    actual_arr:    now - daysAgo * 86400000 + 3600000 + delay * 60000,
    delay_minutes: delay,
    status: 'completed',
    observed_at:   now - daysAgo * 86400000,
  });
}

beforeEach(() => { db.exec('DELETE FROM flight_observations'); });

describe('predictDelay', () => {
  test('returns "low confidence / collecting data" when <10 observations', () => {
    for (let i = 0; i < 5; i++) seedObs({ airline: 'BA', flight: '001', dep: 'LHR', arr: 'JFK', delay: 10, daysAgo: i+1 });
    const out = predictDelay({ airline: 'BA', flightNumber: '001', dep: 'LHR', arr: 'JFK' });
    expect(out.confidence).toBe('low');
    expect(out.message).toMatch(/collecting data/i);
  });

  test('tier 1 exact-flight, 12 obs → medium confidence, scope=exact-flight', () => {
    for (let i = 0; i < 12; i++) seedObs({ airline: 'BA', flight: '001', dep: 'LHR', arr: 'JFK', delay: 5 + i, daysAgo: i+1 });
    const out = predictDelay({ airline: 'BA', flightNumber: '001', dep: 'LHR', arr: 'JFK' });
    expect(out.scope).toBe('exact-flight');
    expect(out.confidence).toBe('medium');
    expect(out.sample).toBe(12);
    expect(out.median).toBeGreaterThan(0);
  });

  test('tier 2 route-airline when no exact-flight match', () => {
    for (let i = 0; i < 15; i++) seedObs({ airline: 'AA', flight: String(200 + i), dep: 'LHR', arr: 'JFK', delay: 3, daysAgo: i+1 });
    const out = predictDelay({ airline: 'AA', flightNumber: '9999', dep: 'LHR', arr: 'JFK' });
    expect(out.scope).toBe('route-airline');
    expect(out.sample).toBe(15);
  });

  test('≥30 samples → high confidence', () => {
    for (let i = 0; i < 35; i++) seedObs({ airline: 'LH', flight: '404', dep: 'FRA', arr: 'MUC', delay: i % 10, daysAgo: i+1 });
    const out = predictDelay({ airline: 'LH', flightNumber: '404', dep: 'FRA', arr: 'MUC' });
    expect(out.confidence).toBe('high');
    expect(out.onTimePct).toBeGreaterThan(0.4);
  });
});
