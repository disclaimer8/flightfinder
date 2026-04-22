'use strict';

const aerodatabox = require('./aerodataboxService');
const adsblol     = require('./adsblolService');
const { predictDelay } = require('./delayPredictionService');

async function compute(trip) {
  const [live, inbound, prediction] = await Promise.all([
    safeLive(trip),
    safeInbound(trip),
    Promise.resolve(predictDelay({
      airline: trip.airline_iata,
      flightNumber: trip.flight_number,
      dep: trip.dep_iata, arr: trip.arr_iata,
    })),
  ]);

  return {
    trip: {
      id: trip.id,
      route: `${trip.dep_iata} → ${trip.arr_iata}`,
      flight: `${trip.airline_iata}${trip.flight_number}`,
      scheduledDep: trip.scheduled_dep,
      scheduledArr: trip.scheduled_arr,
    },
    live,         // { status, actualDep?, actualArr?, gate, terminal } or null
    inbound,      // { callsign, position, ... } or null
    prediction,   // from predictDelay()
  };
}

async function safeLive(trip) {
  if (!aerodatabox.isEnabled?.()) return null;
  try {
    const date = new Date(trip.scheduled_dep).toISOString().slice(0, 10);
    const f = await aerodatabox.getFlightByNumber(`${trip.airline_iata}${trip.flight_number}`, date);
    if (!f) return null;
    return {
      status: f.status || null,
      actualDep:      f.departure?.actualTimeUtc ? Date.parse(f.departure.actualTimeUtc) : null,
      actualArr:      f.arrival?.actualTimeUtc   ? Date.parse(f.arrival.actualTimeUtc)   : null,
      originGate:     f.departure?.gate || null,
      originTerminal: f.departure?.terminal || null,
      destGate:       f.arrival?.gate || null,
      destTerminal:   f.arrival?.terminal || null,
      baggage:        f.arrival?.baggageBelt || null,
    };
  } catch (err) {
    console.warn('[tripStatus] live fail:', err.message);
    return null;
  }
}

async function safeInbound(trip) {
  // adsb.lol callsign lookup — not implemented yet in the client wrapper.
  // Optional-chaining makes this a no-op until adsblolService.findByCallsign
  // lands in a followup. Returns null when unavailable so the UI can hide.
  if (!adsblol.isEnabled?.()) return null;
  try {
    const callsign = `${trip.airline_iata}${trip.flight_number}`.toUpperCase();
    const hit = await adsblol.findByCallsign?.(callsign);
    if (!hit) return null;
    return {
      callsign,
      altitude:    hit.altitude || null,
      position:    hit.lat && hit.lon ? { lat: hit.lat, lon: hit.lon } : null,
      heading:     hit.track || null,
      origin:      hit.origin || null,
      destination: hit.destination || null,
    };
  } catch (err) {
    console.warn('[tripStatus] inbound fail:', err.message);
    return null;
  }
}

module.exports = { compute };
