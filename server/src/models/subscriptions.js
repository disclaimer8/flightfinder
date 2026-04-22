'use strict';

const { db } = require('./db');

// Prepared statements — one-time prepare, reused per call.
const stmts = {
  upsertSubscription: db.prepare(`
    INSERT INTO subscriptions
      (user_id, stripe_sub_id, stripe_session_id, tier, status, period_end, trial_end, created_at, updated_at)
    VALUES
      (@user_id, @stripe_sub_id, @stripe_session_id, @tier, @status, @period_end, @trial_end, @now, @now)
    ON CONFLICT(stripe_sub_id) DO UPDATE SET
      status      = excluded.status,
      period_end  = excluded.period_end,
      trial_end   = excluded.trial_end,
      tier        = excluded.tier,
      updated_at  = excluded.updated_at
  `),
  getSubscriptionByStripeId: db.prepare('SELECT * FROM subscriptions WHERE stripe_sub_id = ?'),
  getSubscriptionsForUser:   db.prepare('SELECT * FROM subscriptions WHERE user_id = ? ORDER BY created_at DESC'),
  updateUserTier: db.prepare(`
    UPDATE users
       SET subscription_tier = ?, sub_valid_until = ?, stripe_customer_id = COALESCE(?, stripe_customer_id)
     WHERE id = ?
  `),
  setUserTierFree: db.prepare(`
    UPDATE users
       SET subscription_tier = 'free', sub_valid_until = NULL
     WHERE id = ?
  `),
  getUserByStripeCustomer: db.prepare('SELECT * FROM users WHERE stripe_customer_id = ?'),
  // Atomic lifetime counter: returns changes()===1 on success, 0 when cap reached.
  claimLifetimeSlot:   db.prepare('UPDATE lifetime_counter SET taken = taken + 1 WHERE id = 1 AND taken < cap'),
  releaseLifetimeSlot: db.prepare('UPDATE lifetime_counter SET taken = MAX(taken - 1, 0) WHERE id = 1'),
  getLifetimeCounter:  db.prepare('SELECT taken, cap FROM lifetime_counter WHERE id = 1'),
  // Webhook dedup
  insertWebhookEvent:  db.prepare('INSERT OR IGNORE INTO webhook_events (id, received_at) VALUES (?, ?)'),
};

module.exports = {
  upsertSubscription(row) {
    stmts.upsertSubscription.run(row);
  },
  getSubscriptionByStripeId(id) {
    return stmts.getSubscriptionByStripeId.get(id);
  },
  getSubscriptionsForUser(userId) {
    return stmts.getSubscriptionsForUser.all(userId);
  },
  updateUserTier(userId, tier, validUntil, stripeCustomerId) {
    stmts.updateUserTier.run(tier, validUntil || null, stripeCustomerId || null, userId);
  },
  setUserTierFree(userId) {
    stmts.setUserTierFree.run(userId);
  },
  getUserByStripeCustomer(customerId) {
    return stmts.getUserByStripeCustomer.get(customerId);
  },
  // Returns true if slot claimed, false if cap reached.
  tryClaimLifetimeSlot() {
    const info = stmts.claimLifetimeSlot.run();
    return info.changes === 1;
  },
  releaseLifetimeSlot() {
    stmts.releaseLifetimeSlot.run();
  },
  getLifetimeCounter() {
    return stmts.getLifetimeCounter.get();
  },
  // Returns true if event is new (first time seen), false if already processed.
  markWebhookEventProcessed(eventId, now = Date.now()) {
    const info = stmts.insertWebhookEvent.run(eventId, now);
    return info.changes === 1;
  },
};
