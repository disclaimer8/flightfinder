const seoMetaService = require('../services/seoMetaService');

describe('seoMetaService titles ≤ 65 chars (Bing display limit)', () => {
  const fixtures = [
    '/',
    '/by-aircraft',
    '/map',
    '/search',
    '/aircraft/boeing-737',
    '/aircraft/boeing-737/airlines',
    '/aircraft/boeing-737/routes',
    '/aircraft/boeing-737/safety',
    '/aircraft/boeing-737/specs',
    '/aircraft/boeing-737/variants/737-800',
    '/aircraft/airbus-a350/variants/a350-1000',
    '/routes/jfk-lhr',
    '/routes/jfk-lhr/boeing-737',
    '/routes/lhr-syd',
    '/airport/jfk',
    '/airport/lhr',
    '/airline/lh',
    '/airline/aa',
    '/airline/cz',
    '/airline/lh/aircraft/b737',
    '/airline/dlh/from/fra',
    '/flights-from/lhr',
    '/flights-to/jfk',
    '/country/us',
    '/country/de',
    '/country/cd',
    '/alliance/star-alliance',
    '/alliance/oneworld',
    '/alliance/skyteam',
  ];

  for (const url of fixtures) {
    test(`${url} title ≤ 65 chars`, () => {
      const meta = seoMetaService.resolve(url);
      expect(meta).toBeTruthy();
      expect(meta.title).toBeTruthy();
      expect(meta.title.length).toBeLessThanOrEqual(65);
    });
  }
});
