'use strict';

const path = require('path');

let _data = {};
try {
  _data = require('../data/wikidata-routes.json');
} catch {
  console.warn('[wikidata] wikidata-routes.json not found — scheduled routes unavailable');
}

/**
 * Get scheduled destination IATA codes for an origin airport.
 * Data comes from the weekly-refreshed wikidata-routes.json.
 *
 * @param {string} iata  3-letter IATA code
 * @returns {Set<string>}
 */
exports.getRoutes = (iata) => {
  if (!iata) return new Set();
  const dests = _data[iata.toUpperCase()];
  return new Set(Array.isArray(dests) ? dests : []);
};

/** Path to the JSON file — used by the refresh script */
exports.DATA_FILE = path.join(__dirname, '../data/wikidata-routes.json');
