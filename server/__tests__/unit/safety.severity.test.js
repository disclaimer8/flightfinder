'use strict';

const { normalizeSeverity, isFatal, isHullLoss } = require('../../src/services/safety/severity');

describe('normalizeSeverity', () => {
  test('TotalFatalInjuries > 0 → fatal', () => {
    expect(normalizeSeverity({ TotalFatalInjuries: 1, HighestInjuryLevel: 'Minor' }))
      .toBe('fatal');
  });

  test('HighestInjuryLevel = Fatal → fatal even when count is 0', () => {
    expect(normalizeSeverity({ HighestInjuryLevel: 'Fatal' })).toBe('fatal');
  });

  test('HighestInjuryLevel = fatal (lowercase) → fatal', () => {
    expect(normalizeSeverity({ HighestInjuryLevel: 'fatal' })).toBe('fatal');
  });

  test('Destroyed without fatalities → hull_loss', () => {
    expect(normalizeSeverity({ AircraftDamage: 'Destroyed', HighestInjuryLevel: 'None' }))
      .toBe('hull_loss');
  });

  test('Destroyed (lowercase) without fatalities → hull_loss', () => {
    expect(normalizeSeverity({ AircraftDamage: 'destroyed' }))
      .toBe('hull_loss');
  });

  test('Serious injury (HighestInjuryLevel) → serious_incident', () => {
    expect(normalizeSeverity({ HighestInjuryLevel: 'Serious' })).toBe('serious_incident');
  });

  test('Serious injury (TotalSeriousInjuries count) → serious_incident', () => {
    expect(normalizeSeverity({ TotalSeriousInjuries: 2 })).toBe('serious_incident');
  });

  test('Substantial damage → incident', () => {
    expect(normalizeSeverity({ AircraftDamage: 'Substantial' })).toBe('incident');
  });

  test('Minor injury level → incident', () => {
    expect(normalizeSeverity({ HighestInjuryLevel: 'Minor' })).toBe('incident');
  });

  test('TotalMinorInjuries count → incident', () => {
    expect(normalizeSeverity({ TotalMinorInjuries: 3 })).toBe('incident');
  });

  test('Minor damage → minor', () => {
    expect(normalizeSeverity({ AircraftDamage: 'Minor' })).toBe('minor');
  });

  test('No damage → minor', () => {
    expect(normalizeSeverity({ AircraftDamage: 'None' })).toBe('minor');
  });

  test('Empty record → unknown', () => {
    expect(normalizeSeverity({})).toBe('unknown');
  });

  test('Null input → unknown (defensive)', () => {
    expect(normalizeSeverity(null)).toBe('unknown');
  });

  test('Undefined input → unknown (defensive)', () => {
    expect(normalizeSeverity(undefined)).toBe('unknown');
  });

  test('Non-object input → unknown (defensive)', () => {
    expect(normalizeSeverity('not an object')).toBe('unknown');
  });

  test('Priority order: fatal trumps all', () => {
    // Even with destroyed aircraft, fatal injuries take priority
    expect(normalizeSeverity({
      TotalFatalInjuries: 1,
      AircraftDamage: 'Destroyed',
      HighestInjuryLevel: 'Fatal'
    })).toBe('fatal');
  });

  test('Priority order: hull_loss before serious_incident', () => {
    // Destroyed but serious (not fatal) injuries
    expect(normalizeSeverity({
      AircraftDamage: 'Destroyed',
      HighestInjuryLevel: 'Serious',
      TotalFatalInjuries: 0
    })).toBe('hull_loss');
  });

  test('Priority order: serious_incident before incident', () => {
    // Serious injury takes precedence over minor damage
    expect(normalizeSeverity({
      HighestInjuryLevel: 'Serious',
      AircraftDamage: 'Minor'
    })).toBe('serious_incident');
  });

  test('Whitespace in string fields is trimmed', () => {
    expect(normalizeSeverity({ HighestInjuryLevel: '  Fatal  ' })).toBe('fatal');
    expect(normalizeSeverity({ AircraftDamage: ' Destroyed ' })).toBe('hull_loss');
  });
});

describe('severity helper functions', () => {
  test('isFatal returns true for fatal', () => {
    expect(isFatal('fatal')).toBe(true);
  });

  test('isFatal returns false for other severities', () => {
    expect(isFatal('incident')).toBe(false);
    expect(isFatal('hull_loss')).toBe(false);
    expect(isFatal('unknown')).toBe(false);
  });

  test('isHullLoss returns true for hull_loss', () => {
    expect(isHullLoss('hull_loss')).toBe(true);
  });

  test('isHullLoss returns false for other severities', () => {
    expect(isHullLoss('fatal')).toBe(false);
    expect(isHullLoss('incident')).toBe(false);
    expect(isHullLoss('unknown')).toBe(false);
  });
});
