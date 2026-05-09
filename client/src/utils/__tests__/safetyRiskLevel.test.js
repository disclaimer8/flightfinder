import { describe, test, expect } from 'vitest';
import { getRiskLevel } from '../safetyRiskLevel';

describe('getRiskLevel', () => {
  test('null counts + null globalMatch → none', () => {
    expect(getRiskLevel({ counts: null, globalMatch: null })).toEqual({
      level: 'none', label: '', summary: '',
    });
  });

  test('recent fatal incident → red', () => {
    const r = getRiskLevel({ counts: { fatal: 1, total: 1 }, globalMatch: null });
    expect(r.level).toBe('red');
    expect(r.label).toMatch(/fatal/i);
  });

  test('recent serious incident (no fatal) → yellow', () => {
    const r = getRiskLevel({ counts: { serious_incident: 2, total: 2, fatal: 0 }, globalMatch: null });
    expect(r.level).toBe('yellow');
    expect(r.label).toMatch(/serious/i);
  });

  test('recent total > 0 but only minor/incident → yellow', () => {
    const r = getRiskLevel({ counts: { incident: 3, total: 3, fatal: 0, serious_incident: 0 }, globalMatch: null });
    expect(r.level).toBe('yellow');
    expect(r.label).toMatch(/incident/i);
  });

  test('clean recent record (zero everything) + no global match → green', () => {
    const r = getRiskLevel({ counts: { fatal: 0, total: 0 }, globalMatch: null });
    expect(r.level).toBe('green');
    expect(r.label).toMatch(/clean/i);
  });

  test('clean recent record + global match with high count → yellow (history matters)', () => {
    const r = getRiskLevel({
      counts: { fatal: 0, total: 0 },
      globalMatch: { name: 'Aeroflot', count: 120, fatalities: 800 },
    });
    expect(r.level).toBe('yellow');
    expect(r.summary).toMatch(/120/);
  });

  test('clean recent record + global match with low count → green', () => {
    const r = getRiskLevel({
      counts: { fatal: 0, total: 0 },
      globalMatch: { name: 'JetSmall', count: 2, fatalities: 0 },
    });
    expect(r.level).toBe('green');
  });

  test('recent fatal trumps low historical', () => {
    const r = getRiskLevel({
      counts: { fatal: 1, total: 1 },
      globalMatch: { name: 'X', count: 0, fatalities: 0 },
    });
    expect(r.level).toBe('red');
  });
});
