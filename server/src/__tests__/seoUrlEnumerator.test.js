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
});
