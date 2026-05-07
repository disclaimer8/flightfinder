import { describe, test, expect } from 'vitest';
import { computeSafetyScore } from '../safetyScore';

describe('computeSafetyScore', () => {
  test('returns 1 (perfect) when no incidents', () => {
    expect(computeSafetyScore({ operatorIncidents5y: 0, aircraftIncidents5y: 0 })).toBe(1);
  });

  test('returns 1 when fields are missing entirely (graceful default)', () => {
    expect(computeSafetyScore({})).toBe(1);
    expect(computeSafetyScore({ airline: 'BA' })).toBe(1);
  });

  test('operator-only incidents drop the score by 0.6 weight', () => {
    // 10 operator incidents = operator_score 0; aircraft_score 1
    // weighted = 0 * 0.6 + 1 * 0.4 = 0.4
    expect(computeSafetyScore({ operatorIncidents5y: 10, aircraftIncidents5y: 0 })).toBeCloseTo(0.4, 5);
  });

  test('aircraft-only incidents drop the score by 0.4 weight', () => {
    // 10 aircraft incidents = aircraft_score 0; operator_score 1
    // weighted = 1 * 0.6 + 0 * 0.4 = 0.6
    expect(computeSafetyScore({ operatorIncidents5y: 0, aircraftIncidents5y: 10 })).toBeCloseTo(0.6, 5);
  });

  test('both maxed-out incidents → score 0', () => {
    expect(computeSafetyScore({ operatorIncidents5y: 50, aircraftIncidents5y: 50 })).toBe(0);
  });

  test('partial incidents linearly interpolate', () => {
    // 5 operator (0.5 score) + 0 aircraft (1.0)
    // weighted = 0.5 * 0.6 + 1 * 0.4 = 0.3 + 0.4 = 0.7
    expect(computeSafetyScore({ operatorIncidents5y: 5, aircraftIncidents5y: 0 })).toBeCloseTo(0.7, 5);
  });

  test('negative or non-numeric inputs treated as 0', () => {
    expect(computeSafetyScore({ operatorIncidents5y: -5, aircraftIncidents5y: 'banana' })).toBe(1);
  });

  test('null flight returns 1 (defensive)', () => {
    expect(computeSafetyScore(null)).toBe(1);
    expect(computeSafetyScore(undefined)).toBe(1);
  });
});
