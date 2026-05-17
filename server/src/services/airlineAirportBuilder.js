'use strict';

const jonty = require('./jontyRouteService');
const jontyDb = require('../models/jontyDb');
const schema = require('./schemaMarkup');
const { aircraftPlaceholder } = require('./seoAircraftPlaceholder');
const { SITE, escapeHtml } = require('./seoSharedUtil');

function build(carrierIata, airportIata) {
  const meta = jonty.getAirportMeta(airportIata);
  if (!meta) return null;

  const db = jontyDb.getDb();
  const rows = db.prepare(`
    SELECT r.dest_iata, r.km, r.duration_min,
           a.city AS dest_city, a.country AS dest_country
    FROM route_carriers rc
    JOIN routes r ON r.origin_iata = rc.origin_iata AND r.dest_iata = rc.dest_iata
    LEFT JOIN airports a ON a.iata = rc.dest_iata
    WHERE rc.carrier_iata = ? AND rc.origin_iata = ?
    ORDER BY r.dest_iata
  `).all(carrierIata, airportIata);

  if (rows.length === 0) return null;

  const carrierName = (db.prepare(`SELECT carrier_name FROM route_carriers WHERE carrier_iata = ? LIMIT 1`).get(carrierIata) || {}).carrier_name || carrierIata;

  const breadcrumbItems = [
    { name: 'Home', url: SITE + '/' },
    { name: `${carrierName} (${carrierIata})`, url: `${SITE}/airline/${carrierIata}` },
    { name: `From ${meta.city}`, url: `${SITE}/airline/${carrierIata}/from/${airportIata}` },
  ];

  const faq = [
    {
      question: `How many destinations does ${carrierName} serve from ${meta.city} (${airportIata})?`,
      answer: `${carrierName} flies to ${rows.length} non-stop destination${rows.length === 1 ? '' : 's'} from ${meta.city} ${airportIata}.`,
    },
  ];

  const jsonLd = schema.toScriptTags(
    schema.breadcrumb(breadcrumbItems),
    schema.faqPage(faq)
  );

  const destsHTML = rows.map(r => `<li><a href="/routes/${airportIata.toLowerCase()}-${r.dest_iata.toLowerCase()}">${escapeHtml(r.dest_city || r.dest_iata)} (${r.dest_iata})</a> — ${r.km ? r.km.toLocaleString('en-US') + ' km' : '—'}, ${r.duration_min || '—'} min</li>`).join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(carrierName)} flights from ${escapeHtml(meta.city)} (${airportIata}) | FlightFinder</title>
<meta name="description" content="${escapeHtml(carrierName)} non-stop destinations from ${escapeHtml(meta.city)} ${airportIata}: ${rows.length} routes, distance and duration.">
<link rel="canonical" href="${SITE}/airline/${carrierIata}/from/${airportIata}">
<meta name="robots" content="index, follow">
${jsonLd}
</head>
<body>
<main>
<h1>${escapeHtml(carrierName)} flights from ${escapeHtml(meta.city)} (${airportIata})</h1>
<section class="intro"><p>${escapeHtml(carrierName)} operates <strong>${rows.length}</strong> non-stop route${rows.length === 1 ? '' : 's'} from ${escapeHtml(meta.city)} ${airportIata}.</p></section>
<section class="destinations">
<ul>${destsHTML}</ul>
</section>
${aircraftPlaceholder()}
<section class="faq">
${faq.map(f => `<details><summary>${escapeHtml(f.question)}</summary><p>${escapeHtml(f.answer)}</p></details>`).join('\n')}
</section>
<footer><p>Editorial by <a href="/about/team">Denys Kolomiiets</a>. Data: <a href="/methodology">methodology</a>.</p></footer>
</main>
</body>
</html>`;
}

module.exports = { build };
