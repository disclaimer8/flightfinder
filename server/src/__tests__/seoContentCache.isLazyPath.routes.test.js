'use strict';
const { isLazyPath } = require('../services/seoContentCache');

describe('seoContentCache.isLazyPath — Spec B paths', () => {
  describe('/routes/:pair', () => {
    it('matches valid pair', () => {
      expect(isLazyPath('/routes/lhr-jfk')).toBe(true);
      expect(isLazyPath('/routes/LHR-JFK')).toBe(true);
    });
    it('matches with trailing slash', () => {
      expect(isLazyPath('/routes/lhr-jfk/')).toBe(true);
    });
    it('rejects malformed', () => {
      expect(isLazyPath('/routes/lhr')).toBe(false);
      expect(isLazyPath('/routes/lhr-jfk-extra')).toBe(false);
      expect(isLazyPath('/routes/')).toBe(false);
    });
  });

  describe('/routes/:pair/:aircraftSlug', () => {
    it('matches valid pair with aircraft slug', () => {
      expect(isLazyPath('/routes/lhr-jfk/boeing-787-9')).toBe(true);
      expect(isLazyPath('/routes/lhr-jfk/airbus-a380')).toBe(true);
    });
    it('matches with trailing slash', () => {
      expect(isLazyPath('/routes/lhr-jfk/boeing-787-9/')).toBe(true);
    });
  });
});
