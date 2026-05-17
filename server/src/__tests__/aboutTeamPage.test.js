'use strict';
const { buildAboutTeamPage } = require('../services/aboutTeamPage');

describe('aboutTeamPage', () => {
  it('returns SSR HTML containing author name + Person JSON-LD', () => {
    const html = buildAboutTeamPage();
    expect(html).toContain('<h1>About the FlightFinder team</h1>');
    expect(html).toContain('Denys Kolomiiets');
    expect(html).toMatch(/<script type="application\/ld\+json">[\s\S]*"@type":\s*"Person"[\s\S]*<\/script>/);
    expect(html).toMatch(/"name":\s*"Denys Kolomiiets"/);
    expect(html).toMatch(/"jobTitle":\s*"Founder/);
    expect(html).toMatch(/"sameAs":\s*\[[^\]]*github\.com\/disclaimer8/);
  });

  it('returns canonical meta + indexable robots', () => {
    const html = buildAboutTeamPage();
    expect(html).toContain('<link rel="canonical" href="https://himaxym.com/about/team">');
    expect(html).toContain('<meta name="robots" content="index, follow">');
  });
});
