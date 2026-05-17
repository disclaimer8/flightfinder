'use strict';
const stage = require('../services/seoP1Stage');

describe('seoP1Stage', () => {
  it('defaults to top50', () => {
    expect(stage.STAGE).toBe('top50');
  });

  it('TOP_50_HUBS has exactly 50 entries', () => {
    expect(stage.TOP_50_HUBS).toHaveLength(50);
  });

  describe('shouldEnumerate', () => {
    it('top50 stage includes ATL but not ORK', () => {
      expect(stage.shouldEnumerate('ATL')).toBe(true);
      expect(stage.shouldEnumerate('ORK')).toBe(false);
    });

    it('case-insensitive', () => {
      expect(stage.shouldEnumerate('atl')).toBe(true);
      expect(stage.shouldEnumerate('lhr')).toBe(true);
    });
  });

  describe('filterAirports', () => {
    it('keeps only top-50 hubs', () => {
      expect(stage.filterAirports(['ATL', 'ORK', 'JFK', 'XXX'])).toEqual(['ATL', 'JFK']);
    });

    it('case-insensitive', () => {
      expect(stage.filterAirports(['atl', 'ork', 'jfk'])).toEqual(['atl', 'jfk']);
    });

    it('empty input → empty output', () => {
      expect(stage.filterAirports([])).toEqual([]);
    });
  });
});
