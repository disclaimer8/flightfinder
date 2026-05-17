'use strict';
const intro = require('../services/seoEditorialIntro');

describe('seoEditorialIntro.airport', () => {
  const ork = { iata: 'ORK', city: 'Cork', country: 'Ireland', name: 'Cork' };
  const data = {
    destinations: [
      { dest_iata: 'LHR', dest_city: 'London', km: 557 },
      { dest_iata: 'AMS', dest_city: 'Amsterdam', km: 908 },
      { dest_iata: 'RHO', dest_city: 'Rhodes', km: 3343 },
    ],
    airlines: [
      { iata: 'EI', name: 'Aer Lingus', route_count: 12 },
      { iata: 'FR', name: 'Ryanair', route_count: 24 },
    ],
  };

  it('opens with 2-sentence factual summary (AEO-extractable)', () => {
    const text = intro.airport(ork, data);
    const sentences = text.split(/[.!?]\s+/).filter(Boolean);
    expect(sentences.length).toBeGreaterThanOrEqual(2);
    expect(text).toContain('Cork');
    expect(text).toContain('3 non-stop destinations');
    expect(text).toContain('2 airlines');
  });

  it('wraps numerical claims in <strong> for AEO', () => {
    const text = intro.airport(ork, data);
    expect(text).toMatch(/<strong>3<\/strong>/);
    expect(text).toMatch(/<strong>2<\/strong>/);
  });

  it('names the longest route', () => {
    const text = intro.airport(ork, data);
    expect(text).toContain('Rhodes');
    expect(text).toContain('3,343');
  });

  it('returns empty string on empty data', () => {
    expect(intro.airport(ork, { destinations: [], airlines: [] })).toBe('');
  });
});

describe('seoEditorialIntro.airline', () => {
  it('summarizes airline network with counts', () => {
    const text = intro.airline(
      { iata: 'EI', name: 'Aer Lingus' },
      { totalRoutes: 87, totalCountries: 14, hubCount: 2 }
    );
    expect(text).toContain('Aer Lingus');
    expect(text).toMatch(/<strong>87<\/strong>/);
    expect(text).toMatch(/<strong>14<\/strong>/);
  });
});
