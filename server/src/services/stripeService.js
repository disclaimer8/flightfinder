'use strict';

const Stripe = require('stripe');

// Lazy instantiation so tests can run without STRIPE_SECRET_KEY.
let client = null;
function getClient() {
  if (client) return client;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY not set');
  client = new Stripe(key, { apiVersion: '2025-02-24.acacia' });
  return client;
}

function isConfigured() {
  return Boolean(process.env.STRIPE_SECRET_KEY) && process.env.STRIPE_LIVE !== '0';
}

// Maps our tier names → Stripe price IDs from env. Lifetime is a one-time price.
function priceIdForTier(tier) {
  switch (tier) {
    case 'pro_monthly':  return process.env.STRIPE_PRICE_MONTHLY;
    case 'pro_annual':   return process.env.STRIPE_PRICE_ANNUAL;
    case 'pro_lifetime': return process.env.STRIPE_PRICE_LIFETIME;
    default: return null;
  }
}

// Creates (or reuses) a Stripe Customer for a given user and returns customerId.
async function ensureCustomer({ userId, email, existingCustomerId }) {
  if (existingCustomerId) return existingCustomerId;
  const customer = await getClient().customers.create({
    email,
    metadata: { user_id: String(userId) },
  });
  return customer.id;
}

// Creates a Checkout Session. For lifetime (one-time) vs recurring Stripe needs different modes.
async function createCheckoutSession({ tier, customerId, successUrl, cancelUrl, trial = true, metadata = {} }) {
  const price = priceIdForTier(tier);
  if (!price) throw new Error(`Unknown tier: ${tier}`);

  const base = {
    customer: customerId,
    success_url: successUrl,
    cancel_url:  cancelUrl,
    line_items: [{ price, quantity: 1 }],
    metadata: { ...metadata, tier },
    allow_promotion_codes: true,
    automatic_tax: { enabled: true },
  };

  if (tier === 'pro_lifetime') {
    return getClient().checkout.sessions.create({ ...base, mode: 'payment' });
  }

  const sub = {
    ...base,
    mode: 'subscription',
    subscription_data: { metadata: { ...metadata, tier } },
  };
  if (trial) sub.subscription_data.trial_period_days = 7;
  return getClient().checkout.sessions.create(sub);
}

async function createBillingPortalSession({ customerId, returnUrl }) {
  return getClient().billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
  });
}

// Verifies raw webhook body + signature header, returns parsed event.
function verifyWebhook(rawBody, signature) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new Error('STRIPE_WEBHOOK_SECRET not set');
  return getClient().webhooks.constructEvent(rawBody, signature, secret);
}

module.exports = {
  isConfigured,
  priceIdForTier,
  ensureCustomer,
  createCheckoutSession,
  createBillingPortalSession,
  verifyWebhook,
  // Exposed for test mocking:
  _getClient: getClient,
};
