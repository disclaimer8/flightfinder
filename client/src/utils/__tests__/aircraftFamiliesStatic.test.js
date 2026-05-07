import { describe, test, expect } from 'vitest';
import { AIRCRAFT_FAMILIES, getFamily } from '../aircraftFamilies';

describe('AIRCRAFT_FAMILIES', () => {
  test('has all 17 spec families with slug/label/category', () => {
    expect(AIRCRAFT_FAMILIES.length).toBe(17);
    for (const fam of AIRCRAFT_FAMILIES) {
      expect(fam.slug).toMatch(/^[a-z0-9-]+$/);
      expect(fam.label).toBeTruthy();
      expect(['wide-body', 'narrow-body', 'regional', 'turboprop']).toContain(fam.category);
    }
  });

  test('has Boeing 787 slug "boeing-787"', () => {
    expect(getFamily('boeing-787')).toEqual(expect.objectContaining({
      slug: 'boeing-787', label: 'Boeing 787 Dreamliner', category: 'wide-body',
    }));
  });

  test('returns undefined for unknown slug', () => {
    expect(getFamily('flying-saucer')).toBeUndefined();
  });
});
