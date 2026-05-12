'use strict';
const { normalizeNtsbFactor } = require('../utils/normalizeNtsbFactor');

describe('normalizeNtsbFactor', () => {
  it('picks last meaningful segment from a specific finding', () => {
    expect(normalizeNtsbFactor(
      'Personnel issues-Action/decision-Info processing/decision-Identification/recognition-Pilot of other aircraft - C'
    )).toEqual({ label: 'Pilot of other aircraft', role: 'cause' });
  });

  it('strips trailing "Not specified" placeholder before picking last', () => {
    expect(normalizeNtsbFactor(
      'Environmental issues-Conditions/weather/phenomena-Wind-Crosswind-Not specified - F'
    )).toEqual({ label: 'Crosswind', role: 'factor' });
  });

  it('prepends previous segment for generic last token ("Failure")', () => {
    expect(normalizeNtsbFactor(
      'Aircraft-Aircraft power plant-Engine (reciprocating)-Recip engine power section-Failure - F'
    )).toEqual({ label: 'Recip engine power section — Failure', role: 'factor' });
  });

  it('returns null when every segment is placeholder', () => {
    expect(normalizeNtsbFactor(
      'Not determined-Not determined-(general)-(general)-Unknown/Not determined - C'
    )).toBeNull();
  });

  it('returns role:null when there is no - C/F suffix', () => {
    expect(normalizeNtsbFactor(
      'Aircraft-Aircraft oper/perf/capability-Performance/control parameters-Lateral/bank control-Not attained/maintained'
    )).toEqual({
      label: 'Lateral/bank control — Not attained/maintained',
      role: null,
    });
  });

  it('null/empty input → null', () => {
    expect(normalizeNtsbFactor(null)).toBeNull();
    expect(normalizeNtsbFactor('')).toBeNull();
    expect(normalizeNtsbFactor('   ')).toBeNull();
  });

  it('handles single-segment input', () => {
    expect(normalizeNtsbFactor('Pilot fatigue')).toEqual({
      label: 'Pilot fatigue',
      role: null,
    });
  });
});
