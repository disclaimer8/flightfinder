'use strict';
const { computeQualityScore, INDEXABLE_THRESHOLD } = require('../utils/accidentQualityScore');

describe('computeQualityScore', () => {
  it('all empty → 0', () => {
    expect(computeQualityScore({})).toBe(0);
  });
  it('narrative >= 300 → 30', () => {
    expect(computeQualityScore({ narrative_text: 'x'.repeat(300) })).toBe(30);
  });
  it('narrative < 300 → 0', () => {
    expect(computeQualityScore({ narrative_text: 'x'.repeat(299) })).toBe(0);
  });
  it('probable_cause >= 100 → 20', () => {
    expect(computeQualityScore({ probable_cause: 'y'.repeat(100) })).toBe(20);
  });
  it('factors_json with >=1 item → 20', () => {
    expect(computeQualityScore({ factors_json: '["Loss of control"]' })).toBe(20);
  });
  it('factors_json empty array → 0', () => {
    expect(computeQualityScore({ factors_json: '[]' })).toBe(0);
  });
  it('factors_json invalid JSON → 0', () => {
    expect(computeQualityScore({ factors_json: 'not-json' })).toBe(0);
  });
  it('weather_summary → 15', () => {
    expect(computeQualityScore({ weather_summary: 'VMC' })).toBe(15);
  });
  it('phase_of_flight → 15', () => {
    expect(computeQualityScore({ phase_of_flight: 'CRUISE' })).toBe(15);
  });
  it('full score = 100', () => {
    expect(computeQualityScore({
      narrative_text: 'x'.repeat(300),
      probable_cause: 'y'.repeat(100),
      factors_json: '["A","B"]',
      weather_summary: 'VMC',
      phase_of_flight: 'CRUISE',
    })).toBe(100);
  });
  it('threshold boundary: narrative+weather only = 45 (below); narrative+weather+phase = 60 (above)', () => {
    expect(computeQualityScore({
      narrative_text: 'x'.repeat(300), weather_summary: 'VMC',
    })).toBe(45);
    expect(computeQualityScore({
      narrative_text: 'x'.repeat(300), weather_summary: 'VMC', phase_of_flight: 'CRUISE',
    })).toBe(60);
  });
  it('INDEXABLE_THRESHOLD is 50', () => {
    expect(INDEXABLE_THRESHOLD).toBe(50);
  });
});
