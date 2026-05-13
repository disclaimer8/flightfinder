// Tests for filter-aware SEO meta on /map.
// Covers the four cases from the spec:
//   1. /map (no params)        — generic title, noindex: false
//   2. /map?airline=BA         — airline-specific title, noindex: true
//   3. /map?aircraft=A320      — aircraft-specific title, noindex: true
//   4. /map?airline=BA&aircraft=A380 — combined title, noindex: true

const seoMeta = require('../services/seoMetaService');

describe('seoMetaService — /map filter-aware meta', () => {
  test('default /map: generic title, indexable', () => {
    const meta = seoMeta.resolve('/map');
    expect(meta.kind).toBe('map');
    expect(meta.title).toMatch(/FlightFinder/);
    // Default /map has no robots override (undefined = indexable, no noindex injected).
    expect(meta.robots == null || !String(meta.robots).includes('noindex')).toBe(true);
    expect(meta.canonical).toMatch(/\/map$/);
  });

  test('/map?airline=BA: resolves airline name, noindex', () => {
    const meta = seoMeta.resolve('/map', { airline: 'BA' });
    expect(meta.kind).toBe('map');
    expect(meta.title).toMatch(/British Airways/);
    expect(meta.title).toMatch(/route map/i);
    expect(meta.title).toMatch(/FlightFinder/);
    expect(meta.description).toMatch(/British Airways/);
    expect(meta.description).toMatch(/90 days/);
    expect(meta.robots).toBe('noindex, follow');
    // canonical must still point to /map (not a filtered URL)
    expect(meta.canonical).toMatch(/\/map$/);
  });

  test('/map?airline=9Z (unknown): falls back to raw code, noindex', () => {
    // 9Z is not a known airline IATA code in the dataset.
    const meta = seoMeta.resolve('/map', { airline: '9Z' });
    expect(meta.title).toMatch(/9Z/);
    expect(meta.robots).toBe('noindex, follow');
  });

  test('/map?aircraft=A320: resolves aircraft name without "family", noindex', () => {
    const meta = seoMeta.resolve('/map', { aircraft: 'A320' });
    expect(meta.kind).toBe('map');
    expect(meta.title).toMatch(/Airbus A320/);
    expect(meta.title).toMatch(/routes/i);
    expect(meta.title).toMatch(/FlightFinder/);
    // Should NOT include the word "family"
    expect(meta.title).not.toMatch(/family/i);
    expect(meta.description).toMatch(/Airbus A320/);
    expect(meta.description).toMatch(/90 days/);
    expect(meta.robots).toBe('noindex, follow');
    expect(meta.canonical).toMatch(/\/map$/);
  });

  test('/map?aircraft=ZZZ (unknown): falls back to raw ICAO, noindex', () => {
    const meta = seoMeta.resolve('/map', { aircraft: 'ZZZ' });
    expect(meta.title).toMatch(/ZZZ/);
    expect(meta.robots).toBe('noindex, follow');
  });

  test('/map?airline=BA&aircraft=A380: combined title, no duplicate "Airbus", noindex', () => {
    const meta = seoMeta.resolve('/map', { airline: 'BA', aircraft: 'A380' });
    expect(meta.kind).toBe('map');
    expect(meta.title).toMatch(/British Airways/);
    expect(meta.title).toMatch(/A380/);
    expect(meta.title).toMatch(/route map/i);
    expect(meta.title).toMatch(/FlightFinder/);
    // "Airbus" should NOT appear in the title — it would look like "British Airways Airbus A380 route map"
    expect(meta.title).not.toMatch(/Airbus/i);
    expect(meta.description).toMatch(/British Airways/);
    expect(meta.description).toMatch(/A380/);
    expect(meta.description).toMatch(/90 days/);
    expect(meta.robots).toBe('noindex, follow');
    expect(meta.canonical).toMatch(/\/map$/);
  });
});
