'use strict';
const table = require('../../data/faaModelToIcao.json');

/**
 * Resolve FAA MASTER.txt manufacturer + model strings to an ICAO type designator.
 * Lookup is case-insensitive and whitespace-tolerant.
 *
 * @param {string|null} manufacturer
 * @param {string|null} model
 * @returns {string|null} ICAO type code (e.g. 'B738') or null when not in table
 */
function resolveIcaoType(manufacturer, model) {
  if (!manufacturer || !model) return null;
  const key = `${String(manufacturer).trim().toUpperCase()}|${String(model).trim().toUpperCase()}`;
  return table[key] || null;
}

module.exports = { resolveIcaoType };
