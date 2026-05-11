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

  it('emits both directions for each hub-network edge', () => {
    const fakeDb = { getHubNetwork: () => ({ edges: [['LHR', 'JFK']] }) };
    const paths = enumerateSeoUrls({ db: fakeDb });
    expect(paths).toContain('/routes/lhr-jfk');
    expect(paths).toContain('/routes/jfk-lhr');
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
    // No hub-network /routes/{pair} entries because the query failed.
    // (Aircraft-route /routes/{pair}/{slug} URLs come from a separate
    // listQualifying call that uses the real default DB.)
    expect(paths.some((p) => /^\/routes\/[a-z]{3}-[a-z]{3}$/.test(p))).toBe(false);
  });

  it('includes /aircraft/{family}/variants/{variant} for every catalog entry', () => {
    const { getAllVariants } = require('../models/aircraftVariants');
    const paths = enumerateSeoUrls();
    for (const v of getAllVariants()) {
      expect(paths).toContain(`/aircraft/${v.familySlug}/variants/${v.slug}`);
    }
  });
});
