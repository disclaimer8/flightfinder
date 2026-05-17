'use strict';

const jonty = require('./jontyRouteService');
const intro = require('./seoEditorialIntro');
const schema = require('./schemaMarkup');
const { aircraftPlaceholder } = require('./seoAircraftPlaceholder');
const { SITE, escapeHtml } = require('./seoSharedUtil');

function buildDepartures(iata) {
  const meta = jonty.getAirportMeta(iata);
  if (!meta) return null;
  const destinations = jonty.getDeparturesFromAirport(iata);
  const airlines = jonty.getAirlinesFromAirport(iata);

  return renderPage({
    direction: 'departures',
    meta,
    routes: destinations,
    airlines,
    canonical: `${SITE}/flights-from/${iata}`,
    h1: `Flights from ${meta.city} (${iata})`,
    title: `Flights from ${meta.city} (${iata}) — destinations, airlines, distance | FlightFinder`,
    metaDesc: `All non-stop flights from ${meta.city} ${iata}. ${destinations.length} destinations on ${airlines.length} airlines. Distance, duration, carriers.`,
  });
}

function buildArrivals(iata) {
  const meta = jonty.getAirportMeta(iata);
  if (!meta) return null;
  const arrivals = jonty.getArrivalsToAirport(iata);

  return renderPage({
    direction: 'arrivals',
    meta,
    routes: arrivals,
    airlines: [],
    canonical: `${SITE}/flights-to/${iata}`,
    h1: `Flights to ${meta.name && meta.name !== meta.city ? `${meta.city} ${meta.name}` : meta.city} (${iata})`,
    title: `Flights to ${meta.city} (${iata}) — origins, airlines, distance | FlightFinder`,
    metaDesc: `All non-stop flights arriving at ${meta.city} ${iata}. ${arrivals.length} origins. Distance, duration, carriers.`,
  });
}

function renderPage({ direction, meta, routes, airlines, canonical, h1, title, metaDesc }) {
  const introHTML = direction === 'departures'
    ? intro.airport(meta, { destinations: routes, airlines })
    : intro.airport(meta, { destinations: routes, airlines: [] });

  const breadcrumbItems = [
    { name: 'Home', url: SITE + '/' },
    { name: 'Airports', url: SITE + '/' },
    { name: `${meta.city} (${meta.iata})`, url: canonical },
  ];

  const faq = buildFAQ(direction, meta, routes, airlines);

  const jsonLd = schema.toScriptTags(
    schema.airport(meta),
    schema.breadcrumb(breadcrumbItems),
    schema.faqPage(faq)
  );

  const routesHTML = routes.map(r => routeRow(direction, r)).join('\n');
  const airlinesHTML = direction === 'departures' && airlines.length > 0
    ? `<section><h2>Airlines flying from ${meta.iata}</h2><ul>${airlines.map(a => `<li><a href="/airline/${a.iata}/from/${meta.iata}">${a.name} (${a.iata}) — ${a.route_count} routes</a></li>`).join('')}</ul></section>`
    : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(metaDesc)}">
<link rel="canonical" href="${canonical}">
<meta name="robots" content="index, follow">
${jsonLd}
</head>
<body>
<main>
<h1>${escapeHtml(h1)}</h1>
<section class="intro">${introHTML}</section>
<section class="routes">
<h2>${direction === 'departures' ? 'Destinations' : 'Origins'}</h2>
<table>
<thead><tr><th>${direction === 'departures' ? 'Destination' : 'Origin'}</th><th>Distance</th><th>Duration</th><th>Airlines</th></tr></thead>
<tbody>${routesHTML}</tbody>
</table>
</section>
${airlinesHTML}
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

function routeRow(direction, r) {
  const otherIata = direction === 'departures' ? r.dest_iata : r.origin_iata;
  const otherCity = direction === 'departures' ? (r.dest_city || r.dest_iata) : (r.origin_city || r.origin_iata);
  const carriers = (r.carriers || []).map(c => c.name).join(', ');
  return `<tr><td><a href="/routes/${direction === 'departures' ? `${(r.origin_iata||'').toLowerCase()}-${otherIata.toLowerCase()}` : `${otherIata.toLowerCase()}-${(r.dest_iata||'').toLowerCase()}`}">${escapeHtml(otherCity)} (${otherIata})</a></td><td>${r.km ? `${r.km.toLocaleString('en-US')} km` : '—'}</td><td>${r.duration_min ? `${r.duration_min} min` : '—'}</td><td>${escapeHtml(carriers)}</td></tr>`;
}

function buildFAQ(direction, meta, routes, airlines) {
  const out = [];
  if (direction === 'departures' && routes.length) {
    out.push({
      question: `How many destinations are there from ${meta.city} (${meta.iata})?`,
      answer: `${meta.city} Airport has ${routes.length} non-stop destinations.`,
    });
  }
  if (direction === 'departures' && airlines.length) {
    out.push({
      question: `Which airlines fly from ${meta.city} (${meta.iata})?`,
      answer: airlines.map(a => a.name).join(', ') + '.',
    });
  }
  if (routes.length) {
    const farthest = routes.reduce((a, b) => (b.km > a.km ? b : a));
    const other = direction === 'departures' ? (farthest.dest_city || farthest.dest_iata) : (farthest.origin_city || farthest.origin_iata);
    out.push({
      question: `What is the longest flight ${direction === 'departures' ? 'from' : 'to'} ${meta.iata}?`,
      answer: `${other} at ${farthest.km.toLocaleString('en-US')} km.`,
    });
  }
  return out;
}

module.exports = { buildDepartures, buildArrivals };
