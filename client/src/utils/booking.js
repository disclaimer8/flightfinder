// Shared Travelpayouts affiliate URL builder + click-event emitter used by
// FlightCard (main search) and AircraftFlightCard (by-aircraft flow).
//
// The tp.media/r redirect is MANDATORY for click attribution — a raw
// aviasales.com?marker= link does not register in the Travelpayouts
// dashboard. Do not bypass.

const TP_MARKER  = '709966';
const TP_TRS     = '509158';
const TP_PROGRAM = '4114';

function toDDMM(iso) {
  const d = new Date(iso);
  return (
    String(d.getUTCDate()).padStart(2, '0') +
    String(d.getUTCMonth() + 1).padStart(2, '0')
  );
}

/**
 * Build the Aviasales booking URL wrapped in the tp.media/r redirect.
 *
 * Accepts two shapes so both call sites can use it unchanged:
 *   - FlightCard shape: { departure: {code}, arrival: {code}, departureTime,
 *                         isRoundTrip, returnItinerary: {departureTime} }
 *   - AircraftFlightCard shape: { origin, destination, departureTime }
 *
 * Returns null when any required field is missing — callers should fall
 * back to a non-clickable card with a muted "Booking unavailable" label.
 */
export function buildBookingUrl(flight, passengers) {
  const dep = flight.departure?.code || flight.origin;
  const arr = flight.arrival?.code   || flight.destination;
  if (!dep || !arr || !flight.departureTime) return null;

  const pax = passengers || 1;
  const departDDMM = toDDMM(flight.departureTime);

  let aviasalesUrl;
  if (flight.isRoundTrip && flight.returnItinerary?.departureTime) {
    const returnDDMM = toDDMM(flight.returnItinerary.departureTime);
    aviasalesUrl = `https://www.aviasales.com/search/${dep}${departDDMM}${arr}${returnDDMM}${pax}`;
  } else {
    aviasalesUrl = `https://www.aviasales.com/search/${dep}${departDDMM}${arr}${pax}`;
  }

  return `https://tp.media/r?marker=${TP_MARKER}&trs=${TP_TRS}&p=${TP_PROGRAM}&u=${encodeURIComponent(aviasalesUrl)}`;
}

/**
 * Fire a custom DOM event + bump a per-source localStorage counter so we
 * can eyeball CTR before we wire a proper analytics pipeline. No GA/GTM.
 *
 * source: 'main-search' | 'by-aircraft-card' | 'by-aircraft-panel'
 * detail: arbitrary metadata (origin, destination, aircraftCode, etc.)
 */
export function emitAffiliateClick(source, detail = {}) {
  try {
    window.dispatchEvent(
      new CustomEvent('ff-affiliate-click', { detail: { source, ...detail } })
    );
    const key = `ff.affClicks.${source}`;
    const n = parseInt(localStorage.getItem(key) || '0', 10) || 0;
    localStorage.setItem(key, String(n + 1));
  } catch {
    // no-op — analytics must never throw
  }
  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.debug('[ff-affiliate-click]', source, detail);
  }
}
