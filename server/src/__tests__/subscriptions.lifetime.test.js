// Lifetime slot is a single scarce resource (500 cap). Under concurrent claims
// we must never over-allocate. SQLite serializes writes, but the logic must
// still check changes() to detect rejected claims.

const subsModel = require('../models/subscriptions');
const { db } = require('../models/db');

describe('lifetime counter atomicity', () => {
  beforeEach(() => {
    db.exec("UPDATE lifetime_counter SET taken = 0, cap = 5 WHERE id = 1");
  });

  afterAll(() => {
    db.exec("UPDATE lifetime_counter SET taken = 0, cap = 500 WHERE id = 1");
  });

  test('claiming until cap succeeds, then returns false', () => {
    const results = [];
    for (let i = 0; i < 7; i++) results.push(subsModel.tryClaimLifetimeSlot());
    expect(results).toEqual([true, true, true, true, true, false, false]);
    const { taken, cap } = subsModel.getLifetimeCounter();
    expect(taken).toBe(5);
    expect(cap).toBe(5);
  });

  test('release decrements but never below zero', () => {
    subsModel.tryClaimLifetimeSlot();
    subsModel.tryClaimLifetimeSlot();
    subsModel.releaseLifetimeSlot();
    subsModel.releaseLifetimeSlot();
    subsModel.releaseLifetimeSlot(); // underflow attempt
    expect(subsModel.getLifetimeCounter().taken).toBe(0);
  });
});
