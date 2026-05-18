'use strict';

const jonty = require('./jontyRouteService');
const schema = require('./schemaMarkup');
const alliances = require('../data/alliances.json');
const { SITE, escapeHtml } = require('./seoSharedUtil');

function getAlliance(slug) {
  return alliances[slug] || null;
}

function build(slug) {
  const alliance = getAlliance(slug);
  if (!alliance) return null;

  let totalRoutes = 0;
  const destSet = new Set();
  const memberRows = [];
  for (const memberIata of alliance.members) {
    let network = [];
    try { network = jonty.getAirlineNetwork(memberIata) || []; } catch { network = []; }
    totalRoutes += network.length;
    for (const r of network) {
      if (r.dest_iata) destSet.add(r.dest_iata);
    }
    let carrierName = null;
    for (const r of network) { if (r.carrier_name) { carrierName = r.carrier_name; break; } }
    memberRows.push({ iata: memberIata, name: carrierName || memberIata, routeCount: network.length });
  }
  memberRows.sort((a, b) => b.routeCount - a.routeCount);

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
      answer: `Across member carriers, ${alliance.name} reaches approximately ${destSet.size} destinations with ${totalRoutes} non-stop routes.` },
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
    .map(m => `<li><a href="/airline/${m.iata}">${escapeHtml(m.name)} (${m.iata}) — ${m.routeCount} routes</a></li>`)
    .join('\n');

  const hubsHTML = alliance.hubs
    .map(h => `<li><a href="/flights-from/${h}">${h}</a></li>`)
    .join('\n');

  return `<main>
${jsonLd}
<section class="intro">
<p>${escapeHtml(alliance.name)} is a global airline alliance founded in ${alliance.founded}, with ${alliance.members.length} member airlines operating approximately ${totalRoutes} non-stop routes across ${destSet.size} destinations.</p>
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
