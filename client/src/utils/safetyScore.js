// client/src/utils/safetyScore.js
//
// Composite safety score for sort=safety on /search. Higher = safer.
// Formula (spec section 11 Risks):
//   score = operator_score * 0.6 + aircraft_score * 0.4
// where each component is `1 - min(incidents / 10, 1)` (10+ incidents → 0).
//
// Inputs are read from flight.operatorIncidents5y and flight.aircraftIncidents5y.
// When either field is missing or non-numeric, that component scores 1.0 —
// meaning a flight without safety data is treated as "no known incidents"
// and gets the optimistic score. This matches the spec's intent that the
// formula degrades gracefully when the backend doesn't carry the fields yet.

const MAX_INCIDENTS = 10;
const OPERATOR_WEIGHT = 0.6;
const AIRCRAFT_WEIGHT = 0.4;

function componentScore(incidents) {
  const n = Number(incidents);
  if (!Number.isFinite(n) || n <= 0) return 1;
  return 1 - Math.min(n / MAX_INCIDENTS, 1);
}

export function computeSafetyScore(flight) {
  if (!flight) return 1;
  const op = componentScore(flight.operatorIncidents5y);
  const ac = componentScore(flight.aircraftIncidents5y);
  return op * OPERATOR_WEIGHT + ac * AIRCRAFT_WEIGHT;
}
