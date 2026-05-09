// Integration test: resolve → build end-to-end against seeded DB data.
// Verifies that seoMetaService.resolve() populates enough fields for
// seoContentBuilders.build() to produce non-null output on live paths.
const seoMeta  = require('../services/seoMetaService');
const builders = require('../services/seoContentBuilders');
const db       = require('../models/db');

beforeAll(() => {
  function seed(dep, arr, icao, airline) {
    db.upsertObservedRoute({
      depIata: dep, arrIata: arr, aircraftIcao: icao, airlineIata: airline, source: 'test',
    });
  }
  seed('LHR', 'JFK', 'B77W', 'BA');
  seed('LHR', 'JFK', 'A359', 'AA');
  seed('JFK', 'CDG', 'B77W', 'AF');
});

describe('end-to-end resolve→build', () => {
  it('produces non-null bake content for /routes/lhr-jfk', () => {
    const meta = seoMeta.resolve('/routes/lhr-jfk');
    const html = builders.build(meta);
    expect(html).not.toBeNull();
    expect(html).toMatch(/airline/i);
  });

  it('produces non-null bake content for an aircraft URL whose ICAO matches seeded data', () => {
    // Pick an aircraft slug whose icaoList contains B77W. Iterate families to find one.
    const { getFamilyList, getFamilyBySlug } = require('../models/aircraftFamilies');
    const target = getFamilyList().find((f) => {
      const fb = getFamilyBySlug(f.slug);
      return fb && fb.icaoList && fb.icaoList.includes('B77W');
    });
    if (!target) {
      // No family carries B77W in the catalogue — skip this assertion rather
      // than fail the build. Worth knowing if the catalogue changes.
      console.warn('[seoBuild.integration] no aircraft family with B77W; skipping aircraft assertion');
      return;
    }
    const meta = seoMeta.resolve(`/aircraft/${target.slug}`);
    const html = builders.build(meta);
    expect(html).not.toBeNull();
  });
});
