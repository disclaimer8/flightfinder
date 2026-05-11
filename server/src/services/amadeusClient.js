const Amadeus = require('amadeus');

let client = null;
let attemptedInit = false;

function getClient() {
  if (client) return client;
  if (attemptedInit && !client) return null;
  attemptedInit = true;

  const id = process.env.AMADEUS_CLIENT_ID;
  const secret = process.env.AMADEUS_CLIENT_SECRET;
  if (!id || !secret) {
    console.warn('[amadeus] AMADEUS_CLIENT_ID/SECRET not configured — Amadeus integration disabled');
    return null;
  }
  try {
    client = new Amadeus({
      clientId: id,
      clientSecret: secret,
      hostname: process.env.AMADEUS_ENV === 'production' ? 'production' : 'test',
    });
    return client;
  } catch (err) {
    console.warn('[amadeus] init failed:', err.message);
    return null;
  }
}

function isEnabled() {
  return getClient() !== null;
}

function _resetForTests() {
  client = null;
  attemptedInit = false;
}

module.exports = { getClient, isEnabled, _resetForTests };
