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

module.exports = { getBySlug, getById, listIndexable, stats, slugsForIds };
