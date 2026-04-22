'use strict';

const express = require('express');
const subsModel   = require('../models/subscriptions');
const stripeSvc   = require('../services/stripeService');
const subsService = require('../services/subscriptionService');

const { db } = require('../models/db');
const getUserById = db.prepare('SELECT id, email, stripe_customer_id, subscription_tier FROM users WHERE id = ?');

async function createCheckout(req, res) {
  if (!stripeSvc.isConfigured()) {
    return res.status(503).json({ success: false, message: 'Subscriptions temporarily unavailable' });
  }
  const { tier } = req.body;
  if (!['pro_monthly', 'pro_annual', 'pro_lifetime'].includes(tier)) {
    return res.status(400).json({ success: false, message: 'Invalid tier' });
  }

  const user = getUserById.get(req.user.id);
  if (!user) return res.status(404).json({ success: false, message: 'User not found' });

  let claimedLifetime = false;
  try {
    if (tier === 'pro_lifetime') {
      claimedLifetime = subsService.tryReserveLifetimeSlot();
      if (!claimedLifetime) {
        return res.status(409).json({ success: false, code: 'LIFETIME_SOLD_OUT', message: 'Lifetime slots are gone' });
      }
    }

    const customerId = await stripeSvc.ensureCustomer({
      userId: user.id, email: user.email, existingCustomerId: user.stripe_customer_id,
    });
    if (customerId !== user.stripe_customer_id) {
      subsModel.updateUserTier(user.id, user.subscription_tier, null, customerId);
    }

    const origin = process.env.PUBLIC_WEB_ORIGIN || 'https://himaxym.com';
    const session = await stripeSvc.createCheckoutSession({
      tier, customerId,
      successUrl: `${origin}/?subscribe=success&session={CHECKOUT_SESSION_ID}`,
      cancelUrl:  `${origin}/?subscribe=cancel`,
      metadata: { user_id: String(user.id) },
    });
    // Session metadata already has { tier, user_id } — no separate update needed.

    return res.json({ success: true, url: session.url });
  } catch (err) {
    if (claimedLifetime) subsService.releaseReservedLifetimeSlot();
    console.error('[subs] createCheckout failed:', err);
    return res.status(500).json({ success: false, message: 'Checkout failed' });
  }
}

async function createPortal(req, res) {
  if (!stripeSvc.isConfigured()) {
    return res.status(503).json({ success: false, message: 'Subscriptions temporarily unavailable' });
  }
  const user = getUserById.get(req.user.id);
  if (!user?.stripe_customer_id) return res.status(404).json({ success: false, message: 'No customer record' });

  const origin = process.env.PUBLIC_WEB_ORIGIN || 'https://himaxym.com';
  try {
    const session = await stripeSvc.createBillingPortalSession({
      customerId: user.stripe_customer_id,
      returnUrl: `${origin}/?portal=return`,
    });
    return res.json({ success: true, url: session.url });
  } catch (err) {
    console.error('[subs] createPortal failed:', err);
    return res.status(500).json({ success: false, message: 'Portal unavailable' });
  }
}

// RAW body — mounted BEFORE json middleware. See server/src/index.js changes.
async function handleWebhook(req, res) {
  if (!stripeSvc.isConfigured()) return res.status(503).end();

  let event;
  try {
    event = stripeSvc.verifyWebhook(req.body, req.headers['stripe-signature']);
  } catch (err) {
    console.warn('[subs] webhook signature invalid:', err.message);
    return res.status(400).json({ success: false, message: 'Invalid signature' });
  }

  // Idempotency via event.id PK
  const isNew = subsModel.markWebhookEventProcessed(event.id);
  if (!isNew) return res.json({ received: true, deduped: true });

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await subsService.handleCheckoutCompleted(event.data.object);
        break;
      case 'checkout.session.expired':
        await subsService.handleCheckoutExpired(event.data.object);
        break;
      case 'customer.subscription.updated':
        await subsService.handleSubscriptionUpdated(event.data.object);
        break;
      case 'customer.subscription.deleted':
        await subsService.handleSubscriptionDeleted(event.data.object);
        break;
      case 'invoice.payment_failed':
        await subsService.handleInvoicePaymentFailed(event.data.object);
        break;
      case 'charge.refunded':
        await subsService.handleChargeRefunded(event.data.object);
        break;
      default:
        // Ignored event — we logged the ID for idempotency so Stripe stops retrying
        break;
    }
    return res.json({ received: true });
  } catch (err) {
    subsModel.deleteWebhookEvent(event.id); // roll back dedup so Stripe retry re-processes
    console.error('[subs] webhook handler failed:', err);
    return res.status(500).json({ success: false, message: 'Handler error' });
  }
}

function getLifetimeStatus(_req, res) {
  const counter = subsService.getLifetimeCounter();
  res.json({ success: true, taken: counter.taken, cap: counter.cap, available: counter.cap - counter.taken });
}

module.exports = { createCheckout, createPortal, handleWebhook, getLifetimeStatus };
