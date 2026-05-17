'use strict';

const jonty = require('./jontyRouteService');
const intro = require('./seoEditorialIntro');
const schema = require('./schemaMarkup');
const { aircraftPlaceholder } = require('./seoAircraftPlaceholder');

const SITE = 'https://himaxym.com';

function build(carrierIata) {
  const network = jonty.getAirlineNetwork(carrierIata);
  if (!network || network.length === 0) return null;

  const carrierName = network[0].carrier_name || carrierIata;
  // Aggregate stats
  const countries = new Set();
  const origins = new Map();
  for (const r of network) {
    if (r.origin_country) countries.add(r.origin_country);
    if (r.dest_country) countries.add(r.dest_country);
    if (!origins.has(r.origin_iata)) {
      origins.set(r.origin_iata, { iata: r.origin_iata, city: r.origin_city, routes: [] });
    }
    origins.get(r.origin_iata).routes.push(r);
  }
  // Hub = origin with ≥10 routes
  const hubCount = Array.from(origins.values()).filter(o => o.routes.length >= 10).length;

  const stats = { totalRoutes: network.length, totalCountries: countries.size, hubCount };
  const introHTML = intro.airline({ iata: carrierIata, name: getCarrierName(network) }, stats);

  const breadcrumbItems = [
    { name: 'Home', url: SITE + '/' },
    { name: 'Airlines', url: SITE + '/' },
    { name: `${getCarrierName(network)} (${carrierIata})`, url: `${SITE}/airline/${carrierIata}` },
  ];

  const faq = [
    {
      question: `How many routes does ${getCarrierName(network)} operate?`,
      answer: `${getCarrierName(network)} operates ${network.length} non-stop routes.`,
    },
    {
      question: `Which countries does ${getCarrierName(network)} fly to?`,
      answer: `${getCarrierName(network)} serves ${countries.size} countries.`,
    },
  ];

  const jsonLd = schema.toScriptTags(
    schema.breadcrumb(breadcrumbItems),
    schema.faqPage(faq)
  );

  const originsHTML = Array.from(origins.values())
    .sort((a, b) => b.routes.length - a.routes.length)
    .map(o => `<li><a href="/airline/${carrierIata}/from/${o.iata}">${escapeHtml(o.city || o.iata)} (${o.iata}) — ${o.routes.length} routes</a></li>`)
    .join('\n');

  const carrierName2 = getCarrierName(network);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(carrierName2)} (${carrierIata}) routes — network map | FlightFinder</title>
<meta name="description" content="Full route network for ${carrierName2} ${carrierIata}: ${network.length} routes across ${countries.size} countries.">
<link rel="canonical" href="${SITE}/airline/${carrierIata}">
<meta name="robots" content="index, follow">
${jsonLd}
</head>
<body>
<main>
<h1>${escapeHtml(carrierName2)} (${carrierIata}) route network</h1>
<section class="intro">${introHTML}</section>
<section class="origins">
<h2>Where ${escapeHtml(carrierName2)} flies from</h2>
<ul>${originsHTML}</ul>
</section>
${aircraftPlaceholder()}
<section class="faq">
<h2>Frequently asked questions</h2>
${faq.map(f => `<details><summary>${escapeHtml(f.question)}</summary><p>${escapeHtml(f.answer)}</p></details>`).join('\n')}
</section>
<footer><p>Editorial by <a href="/about/team">Denys Kolomiiets</a>. Data: <a href="/methodology">methodology</a>.</p></footer>
</main>
</body>
</html>`;
}

function getCarrierName(network) {
  for (const r of network) if (r.carrier_name) return r.carrier_name;
  return 'Airline';
}

function escapeHtml(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

module.exports = { build };
