'use strict';

jest.mock('../../src/data/wikidata-routes.json', () => ({
  MAD: ['BCN', 'LHR', 'CDG'],
  LHR: ['JFK', 'LAX'],
}), { virtual: false });

const wikidataService = require('../../src/services/wikidataService');

describe('wikidataService', () => {
  test('getRoutes returns Set of destinations for known airport', () => {
    const result = wikidataService.getRoutes('MAD');
    expect(result).toBeInstanceOf(Set);
    expect(result.has('BCN')).toBe(true);
    expect(result.has('LHR')).toBe(true);
    expect(result.size).toBe(3);
  });

  test('getRoutes returns empty Set for unknown airport', () => {
    const result = wikidataService.getRoutes('ZZZ');
    expect(result).toBeInstanceOf(Set);
    expect(result.size).toBe(0);
  });

  test('getRoutes is case-insensitive', () => {
    const result = wikidataService.getRoutes('mad');
    expect(result.has('BCN')).toBe(true);
  });
});
