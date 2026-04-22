'use strict';

const webpush = require('web-push');
const tokensModel = require('../models/pushTokens');

let configured = false;
function ensureConfigured() {
  if (configured) return;
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) throw new Error('VAPID keys not set');
  webpush.setVapidDetails(
    VAPID_SUBJECT || 'mailto:admin@himaxym.com',
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY,
  );
  configured = true;
}

function isConfigured() {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

async function sendToUser(userId, payload) {
  if (!isConfigured()) return { sent: 0, failed: 0, skipped: true };
  ensureConfigured();
  const tokens = tokensModel.listByUser(userId);
  let sent = 0, failed = 0;
  for (const t of tokens) {
    try {
      await webpush.sendNotification(
        { endpoint: t.endpoint, keys: { p256dh: t.p256dh, auth: t.auth } },
        JSON.stringify(payload),
      );
      sent++;
    } catch (err) {
      failed++;
      if (err.statusCode === 410 || err.statusCode === 404) {
        // Endpoint expired — browser revoked the subscription. Remove it.
        tokensModel.remove(t.endpoint);
      } else {
        console.warn('[push] send failed:', err.message);
      }
    }
  }
  return { sent, failed };
}

module.exports = { sendToUser, isConfigured };
