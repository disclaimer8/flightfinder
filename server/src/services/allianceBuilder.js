'use strict';

const jonty = require('./jontyRouteService');
const openFlights = require('./openFlightsService');
const schema = require('./schemaMarkup');
const alliances = require('../data/alliances.json');
const { SITE, escapeHtml, routeLabel } = require('./seoSharedUtil');

function getAlliance(slug) {
  return alliances[slug] || null;
}

function build(slug) {
  const alliance = getAlliance(slug);
  if (!alliance) return null;

  const destSet = new Set();
  // Deduplicate routes across alliance members: codeshare routes appear once
  // per operating carrier in route_carriers, so summing per-carrier counts
  // would multi-count them. routePairSet keeps unique (origin,dest) pairs.
  const routePairSet = new Set();
  const memberRows = [];

  for (const memberIata of alliance.members) {
    // Lightweight queries (Wave 3a I1 fix) — avoid the heavy 4-table JOIN in
    // getAirlineNetwork(). Both prepared statements hit the composite index
    // idx_route_carriers_carrier(carrier_iata, origin_iata) from Wave 2 B3.
    let meta = null;
    let destinations = [];
    try { meta = jonty.getCarrierMeta(memberIata) || null; } catch { meta = null; }
    if (meta) {
      try { destinations = jonty.getCarrierDestinations(memberIata) || []; } catch { destinations = []; }
    }

    for (const d of destinations) {
      if (d.dest_iata) destSet.add(d.dest_iata);
      if (d.origin_iata && d.dest_iata) routePairSet.add(`${d.origin_iata}-${d.dest_iata}`);
    }

    // Name resolution (Wave 3a I2 fix): jonty.carrier_name first, then
    // OpenFlights airline name, then bare IATA as last resort.
    let carrierName = meta?.carrier_name || null;
    if (!carrierName) {
      try { carrierName = openFlights.getAirline(memberIata)?.name || null; } catch { /* ignore */ }
    }
    memberRows.push({
      iata: memberIata,
      name: carrierName || memberIata,
      routeCount: meta?.routeCount || 0,
    });
  }
  memberRows.sort((a, b) => b.routeCount - a.routeCount);

  const uniqueRoutePairs = routePairSet.size;

  const breadcrumbItems = [
    { name: 'Home', url: SITE + '/' },
    { name: 'Alliances', url: SITE + '/' },
    { name: alliance.name, url: `${SITE}/alliance/${slug}` },
  ];

  const faq = [
    { question: `How many member airlines does ${alliance.name} have?`,
      answer: `${alliance.name} has ${alliance.members.length} member airlines.` },
    { question: `When was ${alliance.name} founded?`,
      answer: `${alliance.name} was founded in ${alliance.founded}.` },
    { question: `How many destinations does ${alliance.name} cover?`,
      answer: `Across member carriers, ${alliance.name} reaches approximately ${destSet.size} destinations with ${uniqueRoutePairs} unique non-stop routes.` },
  ];

  const orgLd = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: alliance.name,
    foundingDate: String(alliance.founded),
    member: memberRows.map(m => ({ '@type': 'Airline', name: m.name, iataCode: m.iata })),
  };

  const jsonLd = schema.toScriptTags(
    orgLd,
    schema.breadcrumb(breadcrumbItems),
    schema.faqPage(faq)
  );

  const membersHTML = memberRows
    .map(m => `<li><a href="/airline/${m.iata}">${escapeHtml(m.name)} (${m.iata}) — ${routeLabel(m.routeCount)}</a></li>`)
    .join('\n');

  const hubsHTML = alliance.hubs
    .map(h => `<li><a href="/flights-from/${h}">${h}</a></li>`)
    .join('\n');

  return `<main>
${jsonLd}
<section class="intro">
<p>${escapeHtml(alliance.name)} is a global airline alliance founded in ${alliance.founded}, with ${alliance.members.length} member airlines operating approximately ${uniqueRoutePairs} unique non-stop routes across ${destSet.size} destinations.</p>
</section>
<section class="hubs">
<h2>Major hubs</h2>
<ul>${hubsHTML}</ul>
</section>
<section class="members">
<h2>Member airlines</h2>
<ul>${membersHTML}</ul>
</section>
<section class="faq">
<h2>Frequently asked questions</h2>
${faq.map(f => `<details><summary>${escapeHtml(f.question)}</summary><p>${escapeHtml(f.answer)}</p></details>`).join('\n')}
</section>
<footer><p>Editorial by <a href="/about/team">Denys Kolomiiets</a>. Data: <a href="/methodology">methodology</a>.</p></footer>
</main>`;
}

module.exports = { build, getAlliance };
