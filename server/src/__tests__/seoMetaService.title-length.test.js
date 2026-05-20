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

describe('clampTitle runtime guard', () => {
  test('inject clamps over-budget title with ellipsis', () => {
    const html = '<!DOCTYPE html><html><head><title>old</title></head><body></body></html>';
    const longTitle = 'A'.repeat(100);
    const meta = {
      title: longTitle,
      description: 'd',
      canonical: 'https://himaxym.com/',
      ogType: 'website',
    };
    const out = seoMetaService.inject(html, meta);
    const titleMatch = out.match(/<title>([^<]+)<\/title>/);
    expect(titleMatch).toBeTruthy();
    expect(titleMatch[1].length).toBeLessThanOrEqual(65);
    expect(titleMatch[1].endsWith('…')).toBe(true);
  });

  test('inject leaves under-budget title untouched', () => {
    const html = '<!DOCTYPE html><html><head><title>old</title></head><body></body></html>';
    const meta = {
      title: 'Short title',
      description: 'd',
      canonical: 'https://himaxym.com/',
      ogType: 'website',
    };
    const out = seoMetaService.inject(html, meta);
    expect(out).toContain('<title>Short title</title>');
  });
});
