'use strict';

const tokensModel = require('../models/pushTokens');

function subscribe(req, res) {
  const { endpoint, keys } = req.body || {};
  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    return res.status(400).json({ success: false, message: 'Missing endpoint or keys' });
  }
  tokensModel.upsert(req.user.id, { endpoint, keys });
  res.json({ success: true });
}

function unsubscribe(req, res) {
  const { endpoint } = req.body || {};
  if (!endpoint) return res.status(400).json({ success: false, message: 'Missing endpoint' });
  tokensModel.remove(endpoint);
  res.json({ success: true });
}

function publicKey(_req, res) {
  res.json({ success: true, publicKey: process.env.VAPID_PUBLIC_KEY || null });
}

module.exports = { subscribe, unsubscribe, publicKey };
