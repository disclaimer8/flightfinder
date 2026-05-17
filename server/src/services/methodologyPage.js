'use strict';

const SITE = 'https://himaxym.com';

const DATASET = {
  '@context': 'https://schema.org',
  '@type': 'Dataset',
  name: 'FlightFinder route and airport reference data',
  description: 'Worldwide passenger flight routes, carriers, airport metadata and aircraft assignments — aggregated weekly from community and proprietary sources, cross-validated.',
  url: `${SITE}/methodology`,
  creator: {
    '@type': 'Person',
    name: 'Denys Kolomiiets',
    url: `${SITE}/about/team`,
  },
  license: 'https://creativecommons.org/licenses/by/4.0/',
  isAccessibleForFree: true,
  keywords: [
    'flight routes', 'airports', 'airlines', 'aircraft types',
    'IATA codes', 'flight distance', 'flight duration',
  ],
};

function buildMethodologyPage() {
  const jsonLd = JSON.stringify(DATASET);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Methodology — how FlightFinder gathers route and airport data</title>
<meta name="description" content="FlightFinder's data sources, refresh cadence and validation methodology for airport, route, airline and aircraft pages.">
<link rel="canonical" href="${SITE}/methodology">
<meta name="robots" content="index, follow">
<script type="application/ld+json">${jsonLd}</script>
</head>
<body>
<main>
<h1>How FlightFinder gathers its data</h1>
<section>
<h2>Data sources</h2>
<dl>
<dt>Jonty/airline-route-data (community)</dt>
<dd>A weekly-updated global airport + route inventory maintained at <a href="https://github.com/Jonty/airline-route-data">github.com/Jonty/airline-route-data</a>. Provides airport metadata (IATA, ICAO, lat/lon, timezone, elevation) and which carriers fly each route. Updated weekly; we mirror nightly.</dd>

<dt>FlightConnections.com (our crawl)</dt>
<dd>Public route-map pages, scraped under fair-use derivative terms. Provides per-airline aircraft assignments — which aircraft type each carrier operates on each route. Updated quarterly.</dd>

<dt>FAA Releasable Aircraft Database</dt>
<dd>US public-domain dataset for aircraft tail-number → type lookups.</dd>

<dt>NTSB Aviation Accident Database</dt>
<dd>US public-domain accident records, surfaced on our safety overlay.</dd>
</dl>
</section>

<section>
<h2>Cross-validation</h2>
<p>Every route shown on FlightFinder is independently confirmed by at least one source. Routes appearing in only one source are flagged on the page with a "single-source" badge. The freshness date shown on each page reflects when its sources were last cross-validated.</p>
</section>

<section>
<h2>What we do not do</h2>
<ul>
<li>We do not generate flight data with AI. Every numerical claim traces to a named source.</li>
<li>We do not show real-time availability on indexable pages — that lives behind the search UI.</li>
<li>We do not publish data behind paid subscriptions on these pages.</li>
</ul>
</section>

<section>
<h2>Author</h2>
<p>Editor: <a href="/about/team">Denys Kolomiiets</a>.</p>
</section>
</main>
</body>
</html>`;
}

module.exports = { buildMethodologyPage, DATASET };
