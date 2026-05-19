'use strict';

/**
 * Parse a Google Flights price string into a EUR number.
 * Accepts '€296', '€1,234', '€296.50'. Returns null for non-EUR or unparseable.
 */
function parsePriceEur(s) {
  if (!s || typeof s !== 'string') return null;
  const m = s.trim().match(/^€\s*([\d,]+(?:\.\d+)?)$/);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

/**
 * Extract the first marketing carrier name from a GF airline string.
 * Examples:
 *   'JetBlue'                                  → 'JetBlue'
 *   'Vueling, LEVEL'                           → 'Vueling'
 *   'AmericanFinnair, British Airways, Iberia' → 'American'
 *   'Virgin AtlanticAir France, Delta'         → 'Virgin Atlantic'
 *
 * @param {string} airline raw airline string from gf.flights.airline
 * @param {(name: string) => boolean} isKnown callback that returns true if a
 *   candidate prefix matches a real airline in the OpenFlights name index.
 * @returns {string|null} carrier name (NOT ICAO/IATA), or null
 */
function firstMarketingCarrier(airline, isKnown) {
  if (!airline || typeof airline !== 'string') return null;
  const trimmed = airline.trim();
  if (!trimmed) return null;

  const beforeComma = trimmed.split(',')[0].trim();
  if (!beforeComma) return null;

  // Find positions where a capital letter follows a lowercase letter — these
  // are potential split points between concatenated marketing carriers.
  const splits = [];
  for (let i = 1; i < beforeComma.length; i++) {
    if (/[A-Z]/.test(beforeComma[i]) && /[a-z]/.test(beforeComma[i - 1])) {
      splits.push(i);
    }
  }

  // Try each split shortest-first; first known prefix wins. Handles
  // 'AmericanFinnair' (American known) but leaves 'JetBlue' alone (Jet unknown).
  for (const pos of splits) {
    const candidate = beforeComma.slice(0, pos);
    if (isKnown(candidate)) return candidate;
  }

  return beforeComma;
}

module.exports = { parsePriceEur, firstMarketingCarrier };
