const fs = require('fs');
const path = require('path');

const ITA_REQUEST_TEMPLATE_PATH = path.join(
  __dirname,
  '..',
  '__tests__',
  'fixtures',
  'ita-matrix-request.json'
);
// eslint-disable-next-line no-unused-vars -- reserved for live-search wire-up
const ITA_TIMEOUT_MS = parseInt(process.env.ITA_TIMEOUT_MS || '12000', 10);

let _template = null;
// eslint-disable-next-line no-unused-vars -- reserved for live-search wire-up
function _loadTemplate() {
  if (_template !== null) return _template;
  try {
    _template = JSON.parse(fs.readFileSync(ITA_REQUEST_TEMPLATE_PATH, 'utf8'));
  } catch {
    _template = false; // sentinel: missing
  }
  return _template;
}

/**
 * Pure JSON -> normalized array. Source of truth: ita-matrix-response.json (inner_json).
 *
 * Shape note: slice.flights is a string[] (e.g. ["UA9159","UA8841"]); per-flight
 * objects with origin/destination/aircraft/carrier do NOT exist at that level.
 * The slice itself carries origin/destination/departure/arrival/duration; intermediate
 * stop airports come from slice.stops. Per-flight times and aircraft are unavailable
 * in this capture, so segments inherit slice-level times only at the first/last hop.
 */
exports.parse = (raw) => {
  if (!raw) return [];
  const solutions = raw && raw.solutionList && raw.solutionList.solutions;
  if (!Array.isArray(solutions) || solutions.length === 0) return [];
  return solutions.map(buildFlight).filter(Boolean);
};

function buildFlight(solution) {
  const itinerary = solution && solution.itinerary;
  if (!itinerary) return null;
  const slices = itinerary.slices || [];
  if (slices.length === 0) return null;

  // ITA splits round-trip into multiple slices (outbound + return). Treat slice 0
  // as the canonical "this flight" for the simple flight card; total stops come
  // from the same slice.
  const slice = slices[0];
  const flightNumbers = Array.isArray(slice.flights) ? slice.flights : [];
  if (flightNumbers.length === 0) return null;

  const carrierIndex = buildCarrierIndex(itinerary);
  const dominantCarrier =
    (itinerary.ext && itinerary.ext.dominantCarrier) ||
    (Array.isArray(itinerary.carriers) && itinerary.carriers[0]) ||
    null;

  const firstFlight = flightNumbers[0];
  const firstLookup = lookupCarrier(carrierIndex, firstFlight);
  const firstIata = firstLookup.code;
  const firstCarrier = firstLookup.info || dominantCarrier;

  const stops = (slice.stops || []).map((s) => s && s.code).filter(Boolean);
  // Hop chain: origin -> stops -> destination
  const hopCodes = [
    slice.origin && slice.origin.code,
    ...stops,
    slice.destination && slice.destination.code,
  ];

  const priceObj = extractPrice(solution);

  return {
    departure: {
      code: slice.origin && slice.origin.code,
      terminal: null,
      city: (slice.origin && slice.origin.name) || null,
      country: null,
    },
    arrival: {
      code: slice.destination && slice.destination.code,
      terminal: null,
      city: (slice.destination && slice.destination.name) || null,
      country: null,
    },
    departureTime: slice.departure || null,
    arrivalTime: slice.arrival || null,
    duration: typeof slice.duration === 'number' ? slice.duration : 0,
    stops: Math.max(0, flightNumbers.length - 1),
    stopAirports: stops,
    aircraftCode: 'N/A',
    aircraftName: 'N/A',
    airline:
      (firstCarrier && (firstCarrier.shortName || firstCarrier.name)) ||
      firstIata ||
      'N/A',
    airlineIata: firstIata || (firstCarrier && firstCarrier.code) || null,
    flightNumber: firstFlight,
    price: priceObj ? priceObj.amount : null,
    currency: priceObj ? priceObj.currency : null,
    segments: flightNumbers.map((fn, idx) => {
      const { code: iata, info } = lookupCarrier(carrierIndex, fn);
      const carrier = info || dominantCarrier;
      return {
        departure: {
          code: hopCodes[idx] || null,
          time: idx === 0 ? slice.departure || null : null,
          city: null,
        },
        arrival: {
          code: hopCodes[idx + 1] || null,
          time: idx === flightNumbers.length - 1 ? slice.arrival || null : null,
          city: null,
        },
        airline: (carrier && (carrier.shortName || carrier.name)) || iata || null,
        airlineIata: iata || (carrier && carrier.code) || null,
        flightNumber: fn,
        aircraftCode: 'N/A',
        aircraftName: 'N/A',
        duration: 0,
      };
    }),
    source: 'ita',
  };
}

/**
 * Build a Map<UPPER carrier code, carrierInfo> from itinerary.carriers[].
 * The carriers array is the AUTHORITATIVE source for IATA codes used in this
 * itinerary's flight numbers; flight-number prefix regex is only a last resort.
 */
function buildCarrierIndex(itinerary) {
  const list = (itinerary && itinerary.carriers) || [];
  const byCode = new Map();
  for (const c of list) {
    if (c && c.code) byCode.set(String(c.code).toUpperCase(), c);
  }
  return byCode;
}

/**
 * Resolve a flight number to { code, info } where `code` is the IATA airline code.
 *
 * Strategy:
 *   1. Try 2-char alphanumeric prefix (the IATA convention). Accept it even if
 *      not present in carriers[] (still IATA-shaped, may be a partner not listed).
 *   2. Try 3-char prefix BUT only accept it if confirmed by carriers[] (some
 *      rare airlines do have 3-char IATA codes; otherwise the prefix is ICAO,
 *      which we MUST NOT label as IATA).
 *   3. Otherwise return { code: null, info: null }. Downstream callers handle
 *      null gracefully — better than misidentifying ICAO as IATA.
 */
function lookupCarrier(carrierIndex, flightNo) {
  const s = String(flightNo || '').toUpperCase().trim();
  const twoChar = s.match(/^([A-Z0-9]{2})\d/);
  if (twoChar) {
    const hit = carrierIndex.get(twoChar[1]);
    if (hit) return { code: twoChar[1], info: hit };
    return { code: twoChar[1], info: null };
  }
  const threeChar = s.match(/^([A-Z0-9]{3})\d/);
  if (threeChar) {
    const hit = carrierIndex.get(threeChar[1]);
    if (hit) return { code: threeChar[1], info: hit };
    // 3-char prefix not in carriers[]: probably ICAO — refuse to call it IATA.
    return { code: null, info: null };
  }
  return { code: null, info: null };
}

/**
 * displayTotal is "EUR589.94" — parse to { amount: 589.94, currency: 'EUR' }.
 * Per research doc, NEVER use ext.price (it's rounded up).
 */
function extractPrice(solution) {
  const raw = solution && solution.displayTotal;
  if (typeof raw !== 'string') return null;
  const m = raw.match(/^([A-Z]{3})\s*([\d.]+)$/);
  if (!m) return null;
  const amount = parseFloat(m[2]);
  if (!Number.isFinite(amount)) return null;
  return { amount, currency: m[1] };
}

/**
 * Live ITA Matrix search — DEFERRED.
 *
 * Status: parser is fully implemented and tested against captured fixtures.
 * Live HTTP wire-up is deferred because:
 *   1. The endpoint is content-alkalimatrix-pa.googleapis.com/batch (Google
 *      gapi-batch multipart envelope), not the URL-encoded XHR the original
 *      design assumed. Body construction is non-trivial.
 *   2. The captured request includes a `bgProgramResponse` WAA anti-bot
 *      token of unknown server-side requirement (TTL, replay constraints).
 *      Live wire-up may require a headless-browser warmup to mint a fresh
 *      token per session.
 *
 * Until live wire-up lands, this returns null and the orchestrator advances
 * to travelpayouts. ITA contributes zero in production traffic today.
 *
 * Tracking: see docs/superpowers/specs/2026-04-27-google-flights-direct-and-ita-fallback-design.md
 *           "Deferred work" section. Open a follow-up plan when Google
 *           failure rate observed in production justifies the wire-up cost.
 *
 * Returns NormalizedFlight[] | null. NEVER throws.
 */
exports.search = async (_params) => {
  return null;
};
