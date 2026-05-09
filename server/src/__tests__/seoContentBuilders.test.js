// server/src/__tests__/seoContentBuilders.test.js
const { build } = require('../services/seoContentBuilders');

describe('seoContentBuilders.build — static kinds', () => {
  it('returns null for unknown kind', () => {
    expect(build({ kind: 'never-heard-of-this' })).toBeNull();
  });

  it('returns HTML containing pricing tier names for kind=pricing', () => {
    const html = build({ kind: 'pricing' });
    expect(html).toMatch(/Pro Monthly|monthly/i);
    expect(html).toMatch(/Pro Annual|annual|yearly/i);
  });

  it('returns HTML mentioning the team for kind=about', () => {
    const html = build({ kind: 'about' });
    expect(html).toMatch(/<p>/);
    expect(html.length).toBeGreaterThan(200);
  });

  it('returns HTML describing the map for kind=map', () => {
    const html = build({ kind: 'map' });
    expect(html).toMatch(/airport|route|map/i);
  });

  it('returns HTML listing aircraft families for kind=by-aircraft', () => {
    const html = build({ kind: 'by-aircraft' });
    expect(html).toMatch(/<li>/);
  });
});
