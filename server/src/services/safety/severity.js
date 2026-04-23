'use strict';

const SEVERITIES = ['fatal', 'hull_loss', 'serious_incident', 'incident', 'minor', 'unknown'];

/**
 * Converts NTSB CAROL raw records into one of 6 severity codes.
 *
 * Priority order (locked):
 * 1. TotalFatalInjuries > 0 OR HighestInjuryLevel === 'Fatal' → 'fatal'
 * 2. AircraftDamage === 'Destroyed' (and no fatalities) → 'hull_loss'
 * 3. HighestInjuryLevel === 'Serious' OR TotalSeriousInjuries > 0 → 'serious_incident'
 * 4. AircraftDamage === 'Substantial' OR HighestInjuryLevel === 'Minor' OR TotalMinorInjuries > 0 → 'incident'
 * 5. AircraftDamage === 'Minor' OR AircraftDamage === 'None' → 'minor'
 * 6. anything else / missing fields / null input → 'unknown'
 *
 * @param {Object|null|undefined} rawNtsbRow - NTSB CAROL record with fields like:
 *   - TotalFatalInjuries (number)
 *   - TotalSeriousInjuries (number)
 *   - TotalMinorInjuries (number)
 *   - HighestInjuryLevel (string, case-insensitive)
 *   - AircraftDamage (string, case-insensitive)
 * @returns {string} One of: 'fatal', 'hull_loss', 'serious_incident', 'incident', 'minor', 'unknown'
 */
function normalizeSeverity(rawNtsbRow) {
  // Defensive: handle null/undefined/non-object
  if (!rawNtsbRow || typeof rawNtsbRow !== 'object') {
    return 'unknown';
  }

  // Parse and normalize inputs (coerce to number, lowercase strings)
  const fatalInj   = Number(rawNtsbRow.TotalFatalInjuries)   || 0;
  const seriousInj = Number(rawNtsbRow.TotalSeriousInjuries) || 0;
  const minorInj   = Number(rawNtsbRow.TotalMinorInjuries)   || 0;
  const hil        = String(rawNtsbRow.HighestInjuryLevel || '').trim().toLowerCase();
  const dmg        = String(rawNtsbRow.AircraftDamage     || '').trim().toLowerCase();

  // Apply rules in priority order
  if (fatalInj > 0 || hil === 'fatal') {
    return 'fatal';
  }

  if (dmg === 'destroyed') {
    return 'hull_loss';
  }

  if (hil === 'serious' || seriousInj > 0) {
    return 'serious_incident';
  }

  if (dmg === 'substantial' || hil === 'minor' || minorInj > 0) {
    return 'incident';
  }

  if (dmg === 'minor' || dmg === 'none') {
    return 'minor';
  }

  return 'unknown';
}

/**
 * Type guard: check if severity is 'fatal'.
 * @param {string} severity
 * @returns {boolean}
 */
const isFatal = (severity) => severity === 'fatal';

/**
 * Type guard: check if severity is 'hull_loss'.
 * @param {string} severity
 * @returns {boolean}
 */
const isHullLoss = (severity) => severity === 'hull_loss';

module.exports = {
  normalizeSeverity,
  isFatal,
  isHullLoss,
  SEVERITIES,
};
