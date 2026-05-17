'use strict';

const jonty = require('./jontyRouteService');
const intro = require('./seoEditorialIntro');
const schema = require('./schemaMarkup');
const { aircraftPlaceholder } = require('./seoAircraftPlaceholder');
const { SITE, escapeHtml } = require('./seoSharedUtil');

const HUB_MIN_ROUTES = 10;

function build(carrierIata) {
  const network = jonty.getAirlineNetwork(carrierIata);
  if (!network || network.length === 0) return null;

  const carrierName = getCarrierName(network);

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
  // Hub = origin with ≥HUB_MIN_ROUTES routes
  const hubCount = Array.from(origins.values()).filter(o => o.routes.length >= HUB_MIN_ROUTES).length;

  const stats = { totalRoutes: network.length, totalCountries: countries.size, hubCount };
  const introHTML = intro.airline({ iata: carrierIata, name: carrierName }, stats);

  const breadcrumbItems = [
    { name: 'Home', url: SITE + '/' },
    { name: 'Airlines', url: SITE + '/' },
    { name: `${carrierName} (${carrierIata})`, url: `${SITE}/airline/${carrierIata}` },
  ];

  const faq = [
    {
      question: `How many routes does ${carrierName} operate?`,
      answer: `${carrierName} operates ${network.length} non-stop routes.`,
    },
    {
      question: `Which countries does ${carrierName} fly to?`,
      answer: `${carrierName} serves ${countries.size} countries.`,
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

  // Returns inner <main>...</main> only — doctype/<head>/<title>/canonical/
  // robots AND the <h1> come from the React shell + seoMetaService.inject()
  // driven by the resolver's full meta (airlineMeta.h1 for kind:'airline'
  // coexistence). JSON-LD <script> tags live inside <main>; Google parses
  // JSON-LD anywhere. No <h1> here — would cause double-h1 in served HTML.
  return `<main>
${jsonLd}
<section class="intro">${introHTML}</section>
<section class="origins">
<h2>Where ${escapeHtml(carrierName)} flies from</h2>
<ul>${originsHTML}</ul>
</section>
${aircraftPlaceholder()}
<section class="faq">
<h2>Frequently asked questions</h2>
${faq.map(f => `<details><summary>${escapeHtml(f.question)}</summary><p>${escapeHtml(f.answer)}</p></details>`).join('\n')}
</section>
<footer><p>Editorial by <a href="/about/team">Denys Kolomiiets</a>. Data: <a href="/methodology">methodology</a>.</p></footer>
</main>`;
}

function getCarrierName(network) {
  for (const r of network) if (r.carrier_name) return r.carrier_name;
  return 'Airline';
}

module.exports = { build };
