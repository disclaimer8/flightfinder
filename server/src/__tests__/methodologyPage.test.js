'use strict';
const { buildMethodologyPage } = require('../services/methodologyPage');

describe('methodologyPage', () => {
  it('lists data sources by name + URL', () => {
    const html = buildMethodologyPage();
    expect(html).toContain('Jonty');
    expect(html).toMatch(/github\.com\/Jonty\/airline-route-data/);
    expect(html).toContain('FlightConnections');
  });

  it('emits Dataset JSON-LD with creator + license', () => {
    const html = buildMethodologyPage();
    expect(html).toMatch(/"@type":\s*"Dataset"/);
    expect(html).toMatch(/"creator"/);
    expect(html).toMatch(/"license"/);
  });

  it('is canonical + indexable', () => {
    const html = buildMethodologyPage();
    expect(html).toContain('<link rel="canonical" href="https://himaxym.com/methodology">');
    expect(html).toContain('<meta name="robots" content="index, follow">');
  });
});
