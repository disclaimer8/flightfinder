const axios = require('axios');

const SIDECAR_URL = process.env.GOOGLE_SIDECAR_URL || 'http://127.0.0.1:5002';
const TIMEOUT_MS  = parseInt(process.env.GOOGLE_SIDECAR_TIMEOUT_MS || '10000', 10);

exports.parse = (raw) => {
  if (!raw || !Array.isArray(raw.offers)) return [];
  return raw.offers.map(buildFlight).filter(Boolean);
};

function buildFlight(offer) {
  const legs = offer.Flight || offer.flights || [];
  if (!legs.length) return null;
  const first = legs[0];
  const last  = legs[legs.length - 1];
  const firstIata = extractIata(first.FlightNumber);

  return {
    departure: { code: first.DepAirportCode, terminal: null, city: null, country: null },
    arrival:   { code: last.ArrAirportCode,  terminal: null, city: null, country: null },
    departureTime: first.DepTime,
    arrivalTime:   last.ArrTime,
    duration: minutesFromDuration(offer.FlightDuration),
    stops: legs.length - 1,
    stopAirports: legs.slice(0, -1).map(l => l.ArrAirportCode),
    aircraftCode: first.Airplane || 'N/A',
    aircraftName: first.Airplane || 'N/A',
    airline: first.AirlineName || firstIata,
    airlineIata: firstIata,
    flightNumber: normalizeFlightNumber(first.FlightNumber),
    price: offer.Price != null ? Number(offer.Price) : null,
    currency: 'EUR',
    segments: legs.map(l => {
      const iata = extractIata(l.FlightNumber);
      return {
        departure: { code: l.DepAirportCode, time: l.DepTime, city: null },
        arrival:   { code: l.ArrAirportCode, time: l.ArrTime, city: null },
        airline: l.AirlineName,
        airlineIata: iata,
        flightNumber: normalizeFlightNumber(l.FlightNumber),
        aircraftCode: l.Airplane || 'N/A',
        aircraftName: l.Airplane || 'N/A',
        duration: minutesFromDuration(l.Duration),
      };
    }),
    source: 'google',
  };
}

function minutesFromDuration(v) {
  if (v == null) return 0;
  if (typeof v === 'number') return Math.round(v / 60e9);
  const m = String(v).match(/(\d+)h\s*(\d+)?/);
  if (m) return parseInt(m[1], 10) * 60 + parseInt(m[2] || '0', 10);
  return 0;
}

function extractIata(flightNo) {
  const m = String(flightNo || '').match(/^([A-Z0-9]{2,3})\s*\d/);
  return m ? m[1] : null;
}

function normalizeFlightNumber(flightNo) {
  return String(flightNo || '').replace(/\s+/g, '');
}

exports.search = async ({ departure, arrival, date, returnDate, passengers }) => {
  try {
    const params = { from: departure, to: arrival, date, adults: passengers || 1 };
    if (returnDate) params.return = returnDate;
    const res = await axios.get(`${SIDECAR_URL}/search`, {
      params,
      timeout: TIMEOUT_MS,
      validateStatus: s => s === 200,
    });
    return exports.parse(res.data);
  } catch (err) {
    console.warn('[googleFlightsService] search failed:', err.code || err.message);
    return null;
  }
};
