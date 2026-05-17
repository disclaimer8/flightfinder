'use strict';

const SITE = 'https://himaxym.com';

const PERSON = {
  '@context': 'https://schema.org',
  '@type': 'Person',
  name: 'Denys Kolomiiets',
  jobTitle: 'Founder, FlightFinder',
  url: `${SITE}/about/team`,
  worksFor: {
    '@type': 'Organization',
    name: 'FlightFinder',
    url: SITE,
  },
  sameAs: [
    'https://github.com/disclaimer8',
  ],
  knowsAbout: [
    'aviation data',
    'commercial flight routes',
    'aircraft fleets',
    'flight safety records',
  ],
};

function buildAboutTeamPage() {
  const jsonLd = JSON.stringify(PERSON);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>About the FlightFinder team — Denys Kolomiiets</title>
<meta name="description" content="The team behind FlightFinder (himaxym.com). Founder Denys Kolomiiets — author of airport, route, airline and aircraft data pages.">
<link rel="canonical" href="${SITE}/about/team">
<meta name="robots" content="index, follow">
<script type="application/ld+json">${jsonLd}</script>
</head>
<body>
<main>
<h1>About the FlightFinder team</h1>
<section>
<p><strong>Denys Kolomiiets</strong> is the founder and primary editor of FlightFinder. He researches and curates the airport, route, airline, and aircraft data published on this site, combining community datasets with custom acquisition pipelines.</p>
<p>Contact: <a rel="me" href="https://github.com/disclaimer8">github.com/disclaimer8</a>.</p>
</section>
<section>
<h2>Editorial policy</h2>
<p>Every page on FlightFinder cites its underlying data source on <a href="/methodology">our methodology page</a>. We do not generate facts with AI; numerical claims (route counts, distances, flight durations) come from named datasets we cross-validate weekly.</p>
</section>
</main>
</body>
</html>`;
}

module.exports = { buildAboutTeamPage, PERSON };
