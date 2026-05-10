const variantsModule = require('../models/aircraftVariants');
const { getFamilyList, getFamilyBySlug } = require('../models/aircraftFamilies');

describe('aircraftVariants catalog', () => {
  it('exports getVariantBySlug, getVariantsByFamilySlug, getAllVariants', () => {
    expect(typeof variantsModule.getVariantBySlug).toBe('function');
    expect(typeof variantsModule.getVariantsByFamilySlug).toBe('function');
    expect(typeof variantsModule.getAllVariants).toBe('function');
  });

  it('returns at least 30 variants', () => {
    expect(variantsModule.getAllVariants().length).toBeGreaterThanOrEqual(30);
  });

  it('every variant has unique ICAO', () => {
    const all = variantsModule.getAllVariants();
    const icaos = all.map((v) => v.icao);
    expect(new Set(icaos).size).toBe(icaos.length);
  });

  it('every variant has unique slug within its family', () => {
    const all = variantsModule.getAllVariants();
    const seen = new Set();
    for (const v of all) {
      const key = `${v.familySlug}/${v.slug}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it('every variant maps to a family that exists in aircraftFamilies', () => {
    const familySlugs = new Set(getFamilyList().map((f) => f.slug));
    for (const v of variantsModule.getAllVariants()) {
      expect(familySlugs.has(v.familySlug)).toBe(true);
    }
  });

  it('every variant has the required content fields populated', () => {
    for (const v of variantsModule.getAllVariants()) {
      expect(v.icao).toMatch(/^[A-Z0-9]{3,4}$/);
      expect(v.slug).toMatch(/^[a-z0-9-]+$/);
      expect(v.fullName).toBeTruthy();
      expect(v.shortName).toBeTruthy();
      expect(v.firstFlight).toMatch(/^\d{4}/);
      expect(v.capacity).toBeTruthy();
      expect(v.range_km).toBeGreaterThan(0);
      expect(Array.isArray(v.engines)).toBe(true);
      expect(v.engines.length).toBeGreaterThan(0);
      expect(v.description.length).toBeGreaterThan(40);
    }
  });

  it('every variant ICAO appears in its family `codes` Set', () => {
    for (const v of variantsModule.getAllVariants()) {
      const fam = getFamilyBySlug(v.familySlug);
      expect(fam).toBeTruthy();
      expect(fam.icaoList.includes(v.icao)).toBe(true);
    }
  });

  it('getVariantBySlug returns a variant by family+variant slug', () => {
    const v = variantsModule.getVariantBySlug('boeing-787', '787-9');
    expect(v).toBeTruthy();
    expect(v.icao).toBe('B789');
  });

  it('getVariantBySlug returns null for unknown', () => {
    expect(variantsModule.getVariantBySlug('boeing-787', 'does-not-exist')).toBeNull();
    expect(variantsModule.getVariantBySlug('does-not-exist', '787-9')).toBeNull();
  });

  it('getVariantsByFamilySlug returns all variants for a family', () => {
    const v787 = variantsModule.getVariantsByFamilySlug('boeing-787');
    const icaos = v787.map((v) => v.icao);
    expect(icaos).toEqual(expect.arrayContaining(['B788', 'B789', 'B78X']));
  });
});
