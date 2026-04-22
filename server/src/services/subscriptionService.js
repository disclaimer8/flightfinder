'use strict';

const subsModel   = require('../models/subscriptions');
const stripeSvc   = require('./stripeService');

// Maps Stripe Subscription object → our row shape.
function rowFromStripeSub({ userId, sub, tier, sessionId }) {
  return {
    user_id:           userId,
    stripe_sub_id:     sub.id,
    stripe_session_id: sessionId || null,
    tier,
    status:            sub.status,
    period_end:        sub.current_period_end ? sub.current_period_end * 1000 : null,
    trial_end:         sub.trial_end ? sub.trial_end * 1000 : null,
    now:               Date.now(),
  };
}

// Handles checkout.session.completed — creates subscription row + updates user tier.
async function handleCheckoutCompleted(session) {
  const userIdStr = session.metadata?.user_id
    || (session.customer ? (await lookupUserIdFromCustomer(session.customer)) : null);
  if (!userIdStr) throw new Error('No user_id on checkout session metadata or customer');
  const userId = Number(userIdStr);
  const tier   = session.metadata?.tier;
  if (!tier) throw new Error('No tier on checkout session metadata');

  if (tier === 'pro_lifetime') {
    // Lifetime: one-time payment, no Stripe Subscription object.
    subsModel.upsertSubscription({
      user_id: userId,
      stripe_sub_id: `lifetime_${session.id}`, // synthetic to satisfy UNIQUE
      stripe_session_id: session.id,
      tier: 'pro_lifetime',
      status: 'active',
      period_end: null,
      trial_end: null,
      now: Date.now(),
    });
    subsModel.updateUserTier(userId, 'pro_lifetime', null, session.customer);
    return;
  }

  // Recurring: fetch the Stripe Subscription for period info.
  const stripe = stripeSvc._getClient();
  const sub    = await stripe.subscriptions.retrieve(session.subscription);
  subsModel.upsertSubscription(rowFromStripeSub({ userId, sub, tier, sessionId: session.id }));
  subsModel.updateUserTier(
    userId,
    tier,
    sub.current_period_end ? sub.current_period_end * 1000 : null,
    session.customer,
  );
}

async function handleSubscriptionUpdated(sub) {
  const row = subsModel.getSubscriptionByStripeId(sub.id);
  if (!row) return; // unknown sub (shouldn't happen — created in checkout.completed)
  subsModel.upsertSubscription(rowFromStripeSub({
    userId: row.user_id, sub, tier: row.tier, sessionId: row.stripe_session_id,
  }));
  const validUntil = sub.current_period_end ? sub.current_period_end * 1000 : null;
  if (sub.status === 'active' || sub.status === 'trialing') {
    subsModel.updateUserTier(row.user_id, row.tier, validUntil);
  } else if (sub.status === 'canceled' || sub.status === 'unpaid') {
    if (!hasSurvivingPaidSubscription(row.user_id, row.id)) {
      subsModel.setUserTierFree(row.user_id);
    }
  }
}

async function handleSubscriptionDeleted(sub) {
  const row = subsModel.getSubscriptionByStripeId(sub.id);
  if (!row) return;
  subsModel.upsertSubscription(rowFromStripeSub({
    userId: row.user_id, sub, tier: row.tier, sessionId: row.stripe_session_id,
  }));
  if (hasSurvivingPaidSubscription(row.user_id, row.id)) return;
  subsModel.setUserTierFree(row.user_id);
}

// Don't downgrade a user to free if they still hold another paid plan. Protects
// the upgrade path monthly→lifetime where Stripe cancels the recurring sub as
// a side-effect after the lifetime payment succeeds.
function hasSurvivingPaidSubscription(userId, ignoreRowId) {
  const rows = subsModel.getSubscriptionsForUser(userId);
  return rows.some((r) => {
    if (r.id === ignoreRowId) return false;
    if (r.tier === 'pro_lifetime' && r.status === 'active') return true;
    if (r.status === 'active' || r.status === 'trialing') return true;
    return false;
  });
}

async function handleInvoicePaymentFailed(invoice) {
  if (!invoice.subscription) return;
  const row = subsModel.getSubscriptionByStripeId(invoice.subscription);
  if (!row) return;
  subsModel.upsertSubscription({
    ...row,
    status: 'past_due',
    now: Date.now(),
  });
}

async function handleChargeRefunded(charge) {
  // If refund is for a lifetime session, release a slot.
  const sessionId = charge.metadata?.checkout_session_id;
  if (!sessionId) return;
  // NB: Stripe does not pass our session.id on charge; to map reliably use the
  // Payment Intent on the session at checkout time. Simpler approach: scan
  // subscriptions where stripe_session_id = charge.payment_intent linkage.
  // For v1 we rely on the checkout.session.expired event handling (Task below)
  // for the primary release path; refunded lifetime is a manual ops event
  // logged for admin attention.
  console.log(`[subs] charge.refunded — manual slot-release review: charge=${charge.id}`);
}

async function handleCheckoutExpired(session) {
  // Only lifetime needs slot release — recurring has no reservation.
  if (session.metadata?.tier === 'pro_lifetime') {
    subsModel.releaseLifetimeSlot();
  }
}

async function lookupUserIdFromCustomer(customerId) {
  const user = subsModel.getUserByStripeCustomer(customerId);
  return user ? String(user.id) : null;
}

// Called by checkout controller before creating a lifetime session.
function tryReserveLifetimeSlot() {
  return subsModel.tryClaimLifetimeSlot();
}

// Called if lifetime checkout fails AFTER we reserved (network etc).
function releaseReservedLifetimeSlot() {
  subsModel.releaseLifetimeSlot();
}

function getLifetimeCounter() {
  return subsModel.getLifetimeCounter();
}

module.exports = {
  handleCheckoutCompleted,
  handleSubscriptionUpdated,
  handleSubscriptionDeleted,
  handleInvoicePaymentFailed,
  handleChargeRefunded,
  handleCheckoutExpired,
  tryReserveLifetimeSlot,
  releaseReservedLifetimeSlot,
  getLifetimeCounter,
};
