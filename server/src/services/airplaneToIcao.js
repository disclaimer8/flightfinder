'use strict';

// Map a Google-Flights-style aircraft string like "Airbus A320neo" or
// "Boeing 787" to a 4-character ICAO type designator like "A20N" / "B789".
//
// Why this exists: the gilby125/google-flights-api sidecar returns a single
// `Airplane` field carrying the marketing name. Our enrichment pipeline keys
// off the ICAO code (livery lookup by airline+icaoType, CO₂ per-pax via the
// type-fuel table, amenities by airline+icaoType, fleet lookup by tail+type).
// Without this mapping every enriched FlightCard renders with empty Livery /
// On-time / CO₂ / Aircraft / Amenities — which is exactly what users saw in
// prod 2026-05-03.
//
// Strategy:
//   1. Strip parenthetical and known-noise tails ("(Sharklets)", "Passenger",
//      "Dreamliner") so "Airbus A321 (Sharklets)" matches "AIRBUS|A321".
//   2. Hit faaModelToIcao.json for an exact `MAKE|MODEL` match — that table
//      already lists every variant that's ICAO-distinct (B738/B739/B78X/etc.).
//   3. Fall back to a curated family-default table for cases where Google
//      returns just "Airbus A350" or "Boeing 787" with no variant — pick the
//      most common in-service variant (A359 / B789).
//   4. If both miss, return null. Enrichment downstream already handles null
//      gracefully (just renders teasers / "—").

const faaTable = require('../data/faaModelToIcao.json');

// Known make prefixes — order matters for longest-match (e.g. "Airbus" before
// "Air"). We normalise to UPPER and trim, then split off the rest as model.
const KNOWN_MAKES = [
  'AIRBUS',
  'BOEING',
  'EMBRAER',
  'BOMBARDIER',
  'CESSNA',
  'PIPER',
  'CIRRUS',
  'BEECH',
  'BEECHCRAFT',
  'ATR',
  'GULFSTREAM',
  'LEARJET',
  'ROBINSON',
  'BELL',
  'SIKORSKY',
  'PILATUS',
  'MOONEY',
  'DIAMOND',
  'SOCATA',
  'DAHER',
  'DEHAVILLAND',
  'DE HAVILLAND',
];

// Family-level fallback when Google returns just the base model. Picked as
// the dominant in-service variant per type — best-effort, not authoritative.
// When wrong, the worst case is a livery image of a sibling variant; CO₂
// per-pax differs by <5% across same-family variants.
const FAMILY_DEFAULTS = {
  'AIRBUS|A220':  'BCS3',
  'AIRBUS|A300':  'A306',
  'AIRBUS|A310':  'A310',
  'AIRBUS|A330':  'A332',
  'AIRBUS|A340':  'A343',
  'AIRBUS|A350':  'A359',
  'AIRBUS|A380':  'A388',
  'BOEING|717':   'B712',
  'BOEING|727':   'B722',
  'BOEING|737':   'B738',
  'BOEING|747':   'B744',
  'BOEING|757':   'B752',
  'BOEING|767':   'B763',
  'BOEING|777':   'B77W',
  'BOEING|787':   'B789',
  'EMBRAER|170':  'E170',
  'EMBRAER|190':  'E190',
  'EMBRAER|195':  'E195',
};

// Strip noise that the FAA table doesn't carry. "Boeing 737MAX 8 Passenger"
// → "Boeing 737MAX 8". "Airbus A321 (Sharklets)" → "Airbus A321".
function cleanModel(s) {
  return s
    .replace(/\([^)]*\)/g, '')                            // (Sharklets), (winglets)
    .replace(/\b(passenger|dreamliner|jet|aircraft)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Normalise model so "A320neo" / "A320 neo" / "A320-NEO" all collide.
function normaliseModel(s) {
  return s
    .toUpperCase()
    .replace(/\s+/g, '')           // collapse whitespace
    .replace(/[-_./]/g, '');       // strip separators
}

function findMake(upper) {
  for (const make of KNOWN_MAKES) {
    if (upper.startsWith(make)) return make;
  }
  return null;
}

function lookupTable(make, model) {
  // Try every key in the FAA table whose make matches; compare normalised
  // model so "A320NEO" key matches "A320-NEO" input.
  const wantedModel = normaliseModel(model);
  const prefix = `${make}|`;
  for (const key of Object.keys(faaTable)) {
    if (!key.startsWith(prefix)) continue;
    const tableModel = key.slice(prefix.length);
    if (normaliseModel(tableModel) === wantedModel) return faaTable[key];
  }
  return null;
}

function lookupFamilyDefault(make, model) {
  // Strip variant suffix from model and try family table. "737-800" → "737",
  // "787-9" → "787", "A350-1000" → "A350", "A320NEO" → "A320".
  const m = String(model).toUpperCase().match(/^([A-Z]?\d{3,4})/);
  if (!m) return null;
  const family = m[1];
  return FAMILY_DEFAULTS[`${make}|${family}`] || null;
}

function airplaneToIcao(input) {
  if (!input || typeof input !== 'string') return null;
  const cleaned = cleanModel(input);
  if (!cleaned) return null;

  const upper = cleaned.toUpperCase();
  const make = findMake(upper);
  if (!make) return null;

  const model = cleaned.slice(make.length).trim();
  if (!model) return null;

  return lookupTable(make, model) || lookupFamilyDefault(make, model);
}

module.exports = { airplaneToIcao };
