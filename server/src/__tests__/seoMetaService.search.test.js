// Regression test for the /search redesign Phase 1 hotfix:
// /search was returning 404 because seoMetaService.resolve() didn't
// recognize the path and fell through to notFoundMeta (which sets
// kind='not-found' → spaFallback returns HTTP 404). Both /search and
// /map need to return 200 with their canonical meta.

const seoMeta = require('../services/seoMetaService');

describe('seoMetaService /search and /map paths', () => {
  test('/search resolves with kind=search (not 404)', () => {
    const meta = seoMeta.resolve('/search');
    expect(meta.kind).toBe('search');
    expect(meta.kind).not.toBe('not-found');
    expect(meta.canonical).toMatch(/\/search$/);
    expect(meta.title).toMatch(/[Ff]light [Ss]earch/);
  });

  test('/search/ (trailing slash) resolves the same as /search', () => {
    const meta = seoMeta.resolve('/search/');
    expect(meta.kind).toBe('search');
  });

  test('/map resolves with kind=map (not 404)', () => {
    const meta = seoMeta.resolve('/map');
    expect(meta.kind).toBe('map');
  });

  test('unknown path still returns kind=not-found', () => {
    const meta = seoMeta.resolve('/this-path-does-not-exist');
    expect(meta.kind).toBe('not-found');
  });
});
