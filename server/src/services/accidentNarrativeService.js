'use strict';
const model   = require('../models/accidentNarratives');
const sidecar = require('./sidecarAccidentsClient');
const { normalizeNtsbFactor } = require('../utils/normalizeNtsbFactor');
const { extractRegistration } = require('../utils/extractRegistration');

function getBySlug(slug) {
  const narrative = model.getBySlug(slug);
  if (!narrative) return null;

  const facts = sidecar.getAccidentById(narrative.accident_id);
  if (!facts) return null;

  const related = {
    byAircraft: sidecar.findRelatedByAircraft(facts.aircraft_model, facts.id),
    byOperator: sidecar.findRelatedByOperator(facts.operator, facts.id),
  };

  // factors: normalized {label, role} objects. Raw CICTT taxonomy strings
  // (5-layer "Personnel issues-Action/decision-...-Pilot - C") are
  // user-hostile; normalize collapses to "Pilot (cause)" style chips.
  let factors = [];
  if (narrative.factors_json) {
    try {
      const raw = JSON.parse(narrative.factors_json);
      if (Array.isArray(raw)) {
        factors = raw.map(normalizeNtsbFactor).filter(Boolean);
      }
    } catch { /* ignore */ }
  }

  // Hero gets a concrete tail-number when the narrative carries one (NTSB
  // narratives consistently open with "...airplane, N1234X, ..."). Sidecar's
  // structured registration field is sparse — narrative regex hits ~80% of
  // US records.
  const registration = extractRegistration(narrative.narrative_text);

  return { ...narrative, factors, facts: { ...facts, registration }, related };
}

function getById(id) {
  const narrative = model.getById(id);
  if (!narrative) return null;
  return getBySlug(narrative.slug);
}

function listIndexable(opts) {
  return model.listIndexable(opts);
}

function stats() {
  return model.statsByScore();
}

function slugsForIds(ids) {
  return model.getSlugsForIds(ids);
}

/**
 * Return up to `limit` indexable accidents with the same aircraft_model
 * (LIKE-match) as `aircraftModel`, excluding `excludeSlug`.
 *
 * Strategy: sidecar already has a LIKE query (`findRelatedByAircraft`) that
 * returns matching accident rows ordered by recency. We cross-reference the
 * resulting IDs with `model.getSlugsForIds` to find which have indexable
 * narratives, then enrich each with its slug + the sidecar fields we need.
 *
 * Returns array of { slug, date, aircraft_model, operator }.
 * Returns [] when aircraftModel is blank, sidecar is unavailable, or no
 * indexable matches exist.
 */
function listSimilarByAircraft(aircraftModel, excludeSlug, limit = 5) {
  if (!aircraftModel) return [];

  // Use sidecar to get candidate accidents matching the aircraft model.
  // findRelatedByAircraft does LIKE-matching on the first two words of the
  // model string and returns up to 5 rows (sidecar hard-caps at 5, so we
  // may ask for more by over-fetching and filtering — ask for limit*4 as a
  // proxy, but since the sidecar stmt is fixed-limit we use what it returns).
  const candidates = sidecar.findRelatedByAircraft(aircraftModel, -1);
  if (!candidates || candidates.length === 0) return [];

  // Determine which of these accident IDs have indexable narrative slugs.
  const ids = candidates.map(c => c.id);
  const slugMap = model.getSlugsForIds(ids); // { accidentId: slug }

  const results = [];
  for (const c of candidates) {
    const s = slugMap[c.id];
    if (!s) continue;
    if (s === excludeSlug) continue;
    results.push({
      slug: s,
      date: c.date || c.normalized_date || '',
      aircraft_model: c.aircraft_model || aircraftModel,
      operator: c.operator || null,
    });
    if (results.length >= limit) break;
  }
  return results;
}

module.exports = { getBySlug, getById, listIndexable, stats, slugsForIds, listSimilarByAircraft };
