const { enumerateSeoUrls } = require('../services/seoUrlEnumerator');

describe('enumerateSeoUrls', () => {
  it('includes the seven static top-level paths', () => {
    const paths = enumerateSeoUrls();
    expect(paths).toEqual(expect.arrayContaining([
      '/', '/by-aircraft', '/map', '/safety/global',
      '/safety/feed', '/pricing', '/about',
    ]));
  });

  it('includes one /aircraft/{slug} path per aircraft family', () => {
    const { getFamilyList } = require('../models/aircraftFamilies');
    const families = getFamilyList();
    const paths = enumerateSeoUrls();
    for (const fam of families) {
      expect(paths).toContain(`/aircraft/${fam.slug}`);
    }
  });

  it('returns deduplicated paths', () => {
    const paths = enumerateSeoUrls();
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('returns paths starting with /', () => {
    const paths = enumerateSeoUrls();
    for (const p of paths) expect(p.startsWith('/')).toBe(true);
  });

  it('includes /routes/{from}-{to} paths from injected db.getHubNetwork', () => {
    const fakeDb = {
      getHubNetwork: () => ({
        edges: [['LHR', 'JFK'], ['JFK', 'CDG']],
      }),
    };
    const paths = enumerateSeoUrls({ db: fakeDb });
    expect(paths).toContain('/routes/lhr-jfk');
    expect(paths).toContain('/routes/jfk-cdg');
  });

  it('returns static paths gracefully when injected db.getHubNetwork throws', () => {
    const fakeDb = {
      getHubNetwork: () => { throw new Error('cold start'); },
    };
    // Suppress the expected console.warn in test output.
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const paths = enumerateSeoUrls({ db: fakeDb });
    warnSpy.mockRestore();
    expect(paths).toContain('/');
    expect(paths).toContain('/by-aircraft');
    // No /routes/ entries because the query failed.
    expect(paths.some((p) => p.startsWith('/routes/'))).toBe(false);
  });
});
