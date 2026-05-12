'use strict';
const model   = require('../models/accidentNarratives');
const sidecar = require('./sidecarAccidentsClient');

function getBySlug(slug) {
  const narrative = model.getBySlug(slug);
  if (!narrative) return null;

  const facts = sidecar.getAccidentById(narrative.accident_id);
  if (!facts) return null;

  const related = {
    byAircraft: sidecar.findRelatedByAircraft(facts.aircraft_model, facts.id),
    byOperator: sidecar.findRelatedByOperator(facts.operator, facts.id),
  };

  let factors = [];
  if (narrative.factors_json) {
    try { factors = JSON.parse(narrative.factors_json); } catch { /* ignore */ }
  }

  return { ...narrative, factors, facts, related };
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

module.exports = { getBySlug, getById, listIndexable, stats };
