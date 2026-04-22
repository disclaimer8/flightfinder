'use strict';

/*
 * DataSource contract — every ingestion module (AeroDataBox, OpenWeather,
 * Wikimedia, Mictronics, OpenSky) implements this shape. The enrichment
 * service and workers depend ONLY on this contract, not on a specific vendor.
 *
 *   {
 *     name:        string;              // short id, e.g. "aerodatabox"
 *     isEnabled(): boolean;              // true iff the source has env config
 *     // fetch<T>() returns vendor-specific data; sources document their own shape.
 *     // toObservation?(raw): row        // optional, only sources that write observations
 *   }
 *
 * Adding a new data source means: new file in services/, implement the contract,
 * register it wherever the enrichment service aggregates (Plan 3). No changes
 * required to workers or DB.
 */

function defineDataSource({ name, isEnabled, fetch, toObservation }) {
  if (!name || typeof isEnabled !== 'function' || typeof fetch !== 'function') {
    throw new Error(`[dataSource] invalid source "${name}" — missing name/isEnabled/fetch`);
  }
  return { name, isEnabled, fetch, toObservation: toObservation || null };
}

module.exports = { defineDataSource };
