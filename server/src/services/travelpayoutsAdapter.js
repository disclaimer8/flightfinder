const tp = require('./travelpayoutsService');

/**
 * Wrap travelpayoutsService.getCheapest in the unified service contract used
 * by googleFlightsService / itaMatrixService:
 *
 *   search(params) → Promise<NormalizedFlight[] | null>
 *
 * Two impedance mismatches handled here:
 *   1. travelpayoutsService.getCheapest takes { origin, destination, currency }
 *      while the orchestrator speaks { departure, arrival, ... }.
 *   2. travelpayoutsService.getCheapest returns a single offer object (or null);
 *      the orchestrator's nonEmpty() check requires an array. We wrap the
 *      single offer as a 1-element NormalizedFlight[].
 *
 * Never throws — every failure mode (not configured, missing function, service
 * returns null/non-object, service throws) collapses to `null`.
 */
exports.search = async ({ departure, arrival, date, currency } = {}) => {
  if (typeof tp.isConfigured === 'function' && !tp.isConfigured()) return null;
  if (typeof tp.getCheapest !== 'function') return null;

  try {
    const offer = await tp.getCheapest({
      origin: departure,
      destination: arrival,
      date,
      currency: currency || 'usd',
    });
    if (!offer || typeof offer !== 'object') return null;
    return [normalize(offer, { departure, arrival, date })];
  } catch (err) {
    console.warn('[travelpayoutsAdapter] search failed:', err && err.message);
    return null;
  }
};

/**
 * Map the travelpayoutsService.getCheapest output (see that file's lines
 * 68-81 for canonical shape) onto the NormalizedFlight contract that the
 * googleFlightsService uses (see buildFlight() in googleFlightsService.js).
 *
 * Source fields (from tp service):
 *   price (string), currency (UPPER), airline (IATA), flightNumber (string|null),
 *   departureTime, returnTime, durationMinutes, stops, expiresAt, source.
 */
function normalize(offer, { departure, arrival, date }) {
  const airline = typeof offer.airline === 'string' ? offer.airline : null;
  const airlineIata = airline && /^[A-Z0-9]{2,3}$/.test(airline) ? airline : null;
  const priceAmount = offer.price != null ? Number(offer.price) : NaN;

  return {
    departure: { code: departure, terminal: null, city: null, country: null },
    arrival:   { code: arrival,   terminal: null, city: null, country: null },
    departureTime: offer.departureTime || `${date}T00:00:00Z`,
    arrivalTime:   offer.returnTime || offer.departureTime || `${date}T00:00:00Z`,
    duration: typeof offer.durationMinutes === 'number' ? offer.durationMinutes : 0,
    stops: typeof offer.stops === 'number' ? offer.stops : 0,
    stopAirports: [],
    aircraftCode: 'N/A',
    aircraftName: 'N/A',
    airline: airline || 'N/A',
    airlineIata,
    flightNumber: offer.flightNumber
      ? `${airline || ''}${offer.flightNumber}`
      : '',
    price: Number.isFinite(priceAmount)
      ? { amount: priceAmount, currency: offer.currency || 'USD' }
      : null,
    segments: [],
    source: 'travelpayouts',
  };
}
