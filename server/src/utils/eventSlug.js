'use strict';

const slugify = (s) => String(s || '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-|-$/g, '')
  .slice(0, 40);

/**
 * Build a keyword-rich, ID-suffixed slug for a safety event.
 * Format: YYYY-MM-DD-{operator}-{aircraft}-{airport}-{id}
 *
 * @param {object} ev — raw row from safety_events table (snake_case columns)
 * @returns {string} slug
 */
function buildEventSlug(ev) {
  const date = new Date(ev.occurred_at).toISOString().slice(0, 10);
  const op   = slugify(ev.operator_name || ev.operator_icao) || 'unknown-op';
  const ac   = slugify(ev.aircraft_icao_type) || 'unknown-ac';
  const ap   = slugify(ev.dep_iata || ev.location_country) || 'unknown';
  return `${date}-${op}-${ac}-${ap}-${ev.id}`;
}

/**
 * Parse the event ID from a slug (handles both legacy numeric URLs
 * and slug-based URLs ending with `-{id}`).
 */
function parseEventIdFromSlug(slug) {
  if (!slug) return null;
  const s = String(slug);
  const m = /-(\d+)$/.exec(s);
  if (m) return Number(m[1]);
  return /^\d+$/.test(s) ? Number(s) : null;
}

module.exports = { buildEventSlug, parseEventIdFromSlug };
