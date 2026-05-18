'use strict';

const jonty = require('./jontyRouteService');
const schema = require('./schemaMarkup');
const { SITE, escapeHtml, routeLabel, airportLabel, routeSlug } = require('./seoSharedUtil');

function build(cc, countryName) {
  const stats = jonty.getCountryStats(cc);
  if (!stats) return null;

  const breadcrumbItems = [
    { name: 'Home', url: SITE + '/' },
    { name: 'Countries', url: SITE + '/' },
    { name: countryName, url: `${SITE}/country/${cc}` },
  ];

  const faq = [
    { question: `How many airports are in ${countryName}?`,
      answer: `${countryName} has ${airportLabel(stats.airportCount)} in our dataset.` },
    { question: `How many non-stop routes originate in ${countryName}?`,
      answer: `${countryName} has ${routeLabel(stats.routeCount)} departing from its airports in our weekly dataset.` },
    { question: `Which airlines operate most routes from ${countryName}?`,
      answer: `Top operators by route count: ${stats.topAirlines.slice(0, 5).map(a => a.name || a.iata).join(', ')}.` },
  ];

  // Memory `seo-schema-validator-traps`: country page uses Place (NOT Country).
  // schema.org Country lacks the rich connectedness Place offers; Place is the
  // safe, Google-validator-clean choice for an aviation overview landing page.
  const placeLd = {
    '@context': 'https://schema.org',
    '@type': 'Place',
    name: countryName,
    identifier: cc,
  };

  const jsonLd = schema.toScriptTags(
    placeLd,
    schema.breadcrumb(breadcrumbItems),
    schema.faqPage(faq)
  );

  const airportsHTML = stats.topAirports
    .map(a => `<li><a href="/flights-from/${a.iata}">${escapeHtml(a.city || a.iata)} (${a.iata}) — ${routeLabel(a.routeCount)}</a></li>`)
    .join('\n');

  const airlinesHTML = stats.topAirlines
    .map(a => `<li><a href="/airline/${a.iata}">${escapeHtml(a.name || a.iata)} — ${routeLabel(a.routeCount)}</a></li>`)
    .join('\n');

  const routesHTML = stats.popularRoutes
    .map(r => `<li><a href="/routes/${routeSlug(r.origin, r.dest)}">${r.origin} → ${r.dest} (${r.carrierCount} ${r.carrierCount === 1 ? 'carrier' : 'carriers'})</a></li>`)
    .join('\n');

  return `<main>
${jsonLd}
<section class="intro">
<p>${escapeHtml(countryName)} has ${airportLabel(stats.airportCount)} operating ${routeLabel(stats.routeCount)} departing in our dataset.</p>
</section>
<section class="airports">
<h2>Top airports in ${escapeHtml(countryName)}</h2>
<ul>${airportsHTML}</ul>
</section>
<section class="airlines">
<h2>Top airlines from ${escapeHtml(countryName)}</h2>
<ul>${airlinesHTML}</ul>
</section>
<section class="routes">
<h2>Popular routes from ${escapeHtml(countryName)}</h2>
<ul>${routesHTML}</ul>
</section>
<section class="faq">
<h2>Frequently asked questions</h2>
${faq.map(f => `<details><summary>${escapeHtml(f.question)}</summary><p>${escapeHtml(f.answer)}</p></details>`).join('\n')}
</section>
<footer><p>Editorial by <a href="/about/team">Denys Kolomiiets</a>. Data: <a href="/methodology">methodology</a>.</p></footer>
</main>`;
}

module.exports = { build };
