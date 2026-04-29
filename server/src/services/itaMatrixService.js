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
function loadTemplate() {
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

  const firstFlight = flightNumbers[0];
  const firstIata = extractIata(firstFlight);
  const dominantCarrier =
    (itinerary.ext && itinerary.ext.dominantCarrier) ||
    (Array.isArray(itinerary.carriers) && itinerary.carriers[0]) ||
    null;
  const carrierForFlight = (iata) =>
    Array.isArray(itinerary.carriers)
      ? itinerary.carriers.find((c) => c && c.code === iata) || null
      : null;
  const firstCarrier = carrierForFlight(firstIata) || dominantCarrier;

  const stops = (slice.stops || []).map((s) => s && s.code).filter(Boolean);
  // Hop chain: origin -> stops -> destination
  const hopCodes = [
    slice.origin && slice.origin.code,
    ...stops,
    slice.destination && slice.destination.code,
  ];

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
    airline: (firstCarrier && firstCarrier.shortName) || firstIata || 'N/A',
    airlineIata: firstIata || (firstCarrier && firstCarrier.code) || null,
    flightNumber: firstFlight,
    price: extractPrice(solution),
    segments: flightNumbers.map((fn, idx) => {
      const iata = extractIata(fn);
      const carrier = carrierForFlight(iata) || dominantCarrier;
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
        airline: (carrier && carrier.shortName) || iata,
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

function extractIata(flightNo) {
  // Matrix flight numbers are "<IATA-airline-code><number>", e.g. "UA9159", "Y41234", "9X345".
  // IATA airline codes are 2 chars (alphanumeric, must contain >=1 letter); rare 3-char
  // ICAO codes also appear. Anchor digits-to-end so the prefix is deterministic.
  const s = String(flightNo || '');
  let m = s.match(/^([A-Z][A-Z0-9]|[A-Z0-9][A-Z])(\d+)$/);
  if (m) return m[1];
  m = s.match(/^([A-Z0-9]{3})(\d+)$/);
  return m ? m[1] : null;
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
 * Live search via the captured request envelope. The body is a multipart/mixed
 * envelope wrapping a JSON RPC. We mutate JUST the search params inside the
 * inner JSON, re-serialize, and POST.
 *
 * Returns NormalizedFlight[] | null. NEVER throws.
 *
 * NOT YET WIRED: the captured body carries a WAA `bgProgramResponse` token of
 * unknown server-side requirement; substituting params into a multipart body
 * without breaking boundary delimiters (or rebuilding the multipart envelope
 * from a parsed shape) is non-trivial. Returning null here means the
 * orchestrator advances past ITA to travelpayouts, which is acceptable for
 * the initial deployment: ITA is the 2nd-tier fallback and most production
 * traffic should be served by the primary Google sidecar. Live-ITA wire-up
 * is a follow-up task once we observe how often the primary fails.
 */
exports.search = async (_params) => {
  const t = loadTemplate();
  if (!t) {
    console.warn('[itaMatrixService] request template missing — cannot live-search');
    return null;
  }
  console.warn('[itaMatrixService] live search not yet wired (returns null)');
  return null;
};
