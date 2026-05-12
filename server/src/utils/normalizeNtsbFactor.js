'use strict';

// NTSB CICTT taxonomy strings come as:
//   "{Category}-{Subcategory}-{Section}-{Subsection}-{Modifier}[ - C|F]"
// where C marks a cause-of-record and F a contributing-factor-of-record.
//
// Raw form (real samples):
//   "Personnel issues-Action/decision-Info processing/decision-
//    Identification/recognition-Pilot of other aircraft - C"
//   "Environmental issues-Conditions/weather/phenomena-Wind-Crosswind-
//    Not specified - F"
//
// User-facing strategy: pluck the last meaningful taxonomy segment; if it's
// a generic verb/state token ("Failure", "Not attained/maintained", …),
// prepend the previous segment so the result keeps subject context.

const PLACEHOLDER_SEGMENTS = new Set([
  'Not specified',
  '(general)',
  'general',
  'Unknown/Not determined',
  'Unknown',
  'Not determined',
]);

// Last-position tokens that are too generic alone — prepend their previous
// segment for context (e.g. "Recip engine power section — Failure").
const NEEDS_CONTEXT = new Set([
  'Failure',
  'Not attained/maintained',
  'Not determined',
  'Other',
  'Improper',
]);

function normalizeNtsbFactor(raw) {
  if (raw == null) return null;
  const str = String(raw).trim();
  if (!str) return null;

  // Pull off the trailing " - C" / " - F" role marker before splitting on
  // hyphens (otherwise the marker itself becomes a segment).
  const roleMatch = str.match(/^(.*?)\s+-\s+([CF])\s*$/);
  const body = roleMatch ? roleMatch[1].trim() : str;
  const role = roleMatch && roleMatch[2] === 'C' ? 'cause'
             : roleMatch && roleMatch[2] === 'F' ? 'factor'
             : null;

  const segments = body.split('-').map(s => s.trim())
    .filter(s => s && !PLACEHOLDER_SEGMENTS.has(s));
  if (segments.length === 0) return null;

  const last = segments[segments.length - 1];
  const prev = segments.length > 1 ? segments[segments.length - 2] : null;

  const label = (prev && NEEDS_CONTEXT.has(last))
    ? `${prev} — ${last}`
    : last;

  return { label, role };
}

module.exports = { normalizeNtsbFactor };
