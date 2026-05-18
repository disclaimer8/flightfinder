const { getFamilyList, getFamilyByCode, slugify, resolveFamily } = require('../models/aircraftFamilies');
const { esc } = require('./seoMetaService');
const { applyChrome } = require('./seoChrome');
const airlineAircraftService = require('./airlineAircraftService');
const {
  getEnrichmentForSlug,
  renderVariantsTable,
  renderNotableIncidents,
  renderVariantCallout,
  renderEnhancedFAQ,
  buildVariantsItemListLD,
  buildFAQPageLD,
} = require('./aircraftLandingEnrichment');

/**
 * Per-kind HTML emitters for the SEO content cache. Each builder returns
 * an HTML string ready to drop inside `<section data-seo-bake>`, or null
 * if the kind is unknown / data is missing.
 *
 * Builders MUST escape any user/db-derived value through esc(). Static
 * copy may use raw HTML.
 */

const SAFETY_DISCLAIMER =
  'Color reflects time since the last recorded fatal hull-loss involving this type, drawn from public datasets (NTSB, Aviation Safety Network, Bureau of Aircraft Accidents Archives, Wikidata). It is not a commercial safety rating and does not normalise for flights flown, hours, or fleet size — for those, see the manufacturer or IATA Safety Report.';

function _renderSafetyBand(meta) {
  if (!meta || !meta.colorBand) return '';
  const cb = meta.colorBand;
  const linkHref = meta.kind === 'aircraft' && meta.slug
    ? `<a href="/aircraft/${esc(meta.slug)}/safety">View full safety record →</a>`
    : '';
  return `
    <div class="safety-band safety-band--${esc(cb.bucket)}" role="status">
      <span class="safety-dot" aria-hidden="true"></span>
      <strong>${esc(cb.label)}</strong>
      ${linkHref}
    </div>
    <p class="safety-disclaimer">${esc(SAFETY_DISCLAIMER)}</p>
  `.trim();
}

function _safeHttpUrl(u) {
  try {
    const url = new URL(u);
    return (url.protocol === 'https:' || url.protocol === 'http:') ? url.href : '';
  } catch { return ''; }
}

function _renderTopEvents(events) {
  if (!Array.isArray(events) || events.length === 0) return '';
  const items = events.map((e) => {
    const ms = typeof e.occurred_at === 'number' ? e.occurred_at : Date.parse(e.occurred_at || '');
    const date = Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : '';

    const idParts = [e.registration, e.aircraft_icao_type].filter(Boolean).map((s) => esc(s));
    const opChunk = e.operator_name ? `<strong>${esc(e.operator_name)}</strong>` : '';
    const idChunk = idParts.length === 0 ? '' : (opChunk ? `(${idParts.join(', ')})` : idParts.join(', '));
    const actor = [opChunk, idChunk].filter(Boolean).join(' ');

    const fatalChunk = e.fatalities ? `${esc(e.fatalities)} fatalities` : '';
    const routeChunk = e.dep_iata && e.arr_iata ? `${esc(e.dep_iata)}–${esc(e.arr_iata)}` : '';
    const safeUrl = _safeHttpUrl(e.report_url);
    const srcChunk = safeUrl ? `<a href="${esc(safeUrl)}" rel="noopener nofollow">Source</a>` : '';
    const facts = [fatalChunk, routeChunk, srcChunk].filter(Boolean).join('. ');

    const lead = date ? `<time datetime="${esc(date)}">${esc(date)}</time>` : '';
    const body = [lead, actor, facts].filter(Boolean).join(' — ');
    return `<li>${body}${facts ? '.' : ''}</li>`;
  }).join('');
  return `<h3>Notable events</h3><ol>${items}</ol>`;
}

function _renderVariantsList(variants) {
  if (!Array.isArray(variants) || variants.length === 0) return '';
  const items = variants.map((v) =>
    `<li><a href="/aircraft/${esc(v.familySlug)}/variants/${esc(v.slug)}">${esc(v.shortName)}</a> — ${esc((v.description || '').split('. ')[0])}.</li>`
  ).join('');
  return `<h3>Variants</h3><ul>${items}</ul>`;
}

function _renderDecadeTimeline(events) {
  if (!Array.isArray(events) || events.length === 0) return '';
  const { groupByDecade } = require('./safetyRating');
  const grouped = groupByDecade(events);
  // String sort is correct for 4-digit-decade keys (e.g. '1990s' < '2020s').
  const decades = Object.keys(grouped).sort().reverse();
  return decades.map((d) => {
    const items = grouped[d].map((e) => {
      const ms = typeof e.occurred_at === 'number' ? e.occurred_at : Date.parse(e.occurred_at || '');
      const date = Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : '';
      const lead = date ? `<time datetime="${esc(date)}">${esc(date)}</time>` : '';
      const opChunk = e.operator_name ? `<strong>${esc(e.operator_name)}</strong>` : '';
      const variantChunk = e.aircraft_icao_type ? esc(e.aircraft_icao_type) : '';
      const fatalText = e.fatalities ? `${esc(e.fatalities)} fatal` : (e.severity ? esc(e.severity) : '');
      const parenChunk = fatalText ? `(${fatalText})` : '';
      return `<li>${[lead, opChunk, variantChunk, parenChunk].filter(Boolean).join(' — ')}</li>`;
    }).join('');
    return `<h3>${esc(d)}</h3><ul>${items}</ul>`;
  }).join('');
}

function _formatNumber(n) {
  return Number(n).toLocaleString('en-US');
}

function _renderFr24Stats(stats, opts = {}) {
  if (!stats || !stats.totalFlights) return '';
  const date = new Date(stats.fetchedAt).toISOString().slice(0, 10);
  const isRoute = opts.context === 'route';
  const windowDays = stats.windowDays || 14;

  // Explorer-tier reality: each FR24 query returns at most 20 recent flights
  // matching the filter (within the last 14 days). The block presents this
  // sample honestly rather than claiming worldwide-over-12-months stats we
  // don't have. If/when the tier is upgraded (Essential: 20000 records, 2yr
  // history), update this copy.
  const heading = isRoute
    ? `<h3>Recent flights on this route (Flightradar24 sample)</h3>`
    : `<h3>Recent flights (Flightradar24 sample)</h3>`;

  const totalLine = isRoute
    ? `<p>Sampled <strong>${esc(stats.totalFlights)}</strong> recent flight${stats.totalFlights === 1 ? '' : 's'} by ${esc(stats.uniqueOperators)} airline${stats.uniqueOperators === 1 ? '' : 's'} in the last ${esc(windowDays)} days.</p>`
    : `<p>Sampled <strong>${esc(stats.totalFlights)}</strong> recent flight${stats.totalFlights === 1 ? '' : 's'} flown by ${esc(stats.uniqueOperators)} airline${stats.uniqueOperators === 1 ? '' : 's'} in the last ${esc(windowDays)} days.</p>`;

  const operatorsLine = (stats.topOperators && stats.topOperators.length > 0)
    ? `<p>Operators in this sample: ${stats.topOperators.map((o) => `${esc(o.icao)} (${esc(o.count)})`).join(', ')}</p>`
    : '';

  const routesLine = (!isRoute && stats.topRoutes && stats.topRoutes.length > 0)
    ? `<p>Routes in this sample: ${stats.topRoutes.map((r) => `${esc(r.from)}–${esc(r.to)} (${esc(r.count)})`).join(', ')}</p>`
    : '';

  const sourceLine = `<p class="data-source">Sample data via Flightradar24, as of ${esc(date)}.</p>`;

  return [heading, totalLine, operatorsLine, routesLine, sourceLine]
    .filter(Boolean).join('\n');
}

function _renderVariantBreakdown(allEvents, variants) {
  if (!Array.isArray(variants) || variants.length === 0) return '';
  if (!Array.isArray(allEvents) || allEvents.length === 0) return '';
  const { breakdownByVariant } = require('./safetyRating');
  const counts = breakdownByVariant(allEvents);
  const items = variants.map((v) => {
    const n = counts[v.icao] || 0;
    return `${esc(v.shortName)} (${esc(n)} event${n === 1 ? '' : 's'})`;
  }).join(', ');
  return items ? `<p>By variant: ${items}.</p>` : '';
}

function bPricing() {
  return `
    <p>FlightFinder Pro unlocks enriched flight cards (livery, on-time stats, CO₂, amenities), delay predictions, and My Trips with push alerts.</p>
    <p>Three plans: <strong>Pro Monthly</strong> at $4.99/mo, <strong>Pro Annual</strong> at $39/year, and <strong>Pro Lifetime</strong> at $99 one-time (limited to 500 seats).</p>
    <p>Cancel anytime. All plans include the same feature set; the difference is billing cadence.</p>
  `.trim();
}

function bAbout() {
  return `
    <p>FlightFinder is an independent flight-search engine focused on aircraft transparency. We surface what most search engines hide: which exact aircraft is operating your flight, its safety record, on-time performance, and amenities.</p>
    <p>Data flows from Amadeus, Duffel, AirLabs, and the official safety datasets (NTSB, Aviation Safety Network, B3A). We don't sell tickets — we redirect to airline and OTA sites for booking.</p>
    <p>Built and run by Denys Kolomiiets. Contact: hello@himaxym.com.</p>
  `.trim();
}

function bMap() {
  return `
    <p>The interactive map shows every airport in our dataset and lets you draw a radius to see what flies within a region. Click any airport to see its destinations; click a destination dot to pull live priced flights for that leg.</p>
    <p>Filter by aircraft family (Boeing 747, Airbus A380, A340 family, …) to see only routes operating that equipment in the last 14 days.</p>
  `.trim();
}

function bByAircraft() {
  const families = getFamilyList();
  const items = families
    .map((f) => `<li><a href="/aircraft/${esc(f.slug)}">${esc(f.label || f.name || f.slug)}</a></li>`)
    .join('');
  return `
    <p>Dedicated landing pages for ${families.length} aircraft families. Each page lists the airlines that operate the type, the routes it flies, recent safety events, and full specs.</p>
    <ul>${items}</ul>
  `.trim();
}

// ── Jonty enrichment block for /routes/:from-:to ─────────────────────────────
// Returns an HTML <section> with Jonty-sourced km/duration_min and operating
// carriers, or '' if jonty.db is missing, no row matches, or any error occurs.
// Layered on top of FF observed_routes data — degrades gracefully so an
// unavailable jonty.db never breaks the existing thin/rich route page.
function _renderJontyEnrichment(from, to) {
  try {
    const jontyDb = require('../models/jontyDb');
    const db = jontyDb.getDb();
    const row = db.prepare(`
      SELECT km, duration_min
      FROM routes
      WHERE origin_iata = ? AND dest_iata = ?
    `).get(from, to);
    if (!row) return '';
    const carriers = db.prepare(`
      SELECT carrier_iata AS iata, carrier_name AS name
      FROM route_carriers
      WHERE origin_iata = ? AND dest_iata = ?
      ORDER BY carrier_iata
    `).all(from, to);
    const carriersHtml = carriers.length
      ? `<ul>${carriers.map(c => `<li>${esc(c.name)} (${esc(c.iata)})</li>`).join('')}</ul>`
      : '<p>Carrier data unavailable.</p>';
    return `<section class="route-jonty">
  <h2>Operating airlines</h2>
  ${carriersHtml}
  <p>Distance: <strong>${esc(String(row.km))}</strong> km. Duration: <strong>${esc(String(row.duration_min))}</strong> minutes.</p>
</section>`;
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    // Operational failures degrade gracefully (return empty string):
    // 1. jonty.db missing on disk
    // 2. SQLite schema drift / data lag — "no such table" / "no such column"
    // 3. Generic SQLite errors (transient connection or mock-leak in tests)
    const isOperationalFailure = msg.includes('jonty.db not present')
      || msg.includes('no such table')
      || msg.includes('no such column')
      || /SQLITE_/i.test(msg);
    if (isOperationalFailure) return '';
    if (process.env.NODE_ENV !== 'production') throw err;
    console.warn(`[seo] jonty enrichment failed for ${from}-${to}:`, msg);
    return '';
  }
}

function bRoute(meta, _db) {
  const routeService     = require('./routeService');
  const openFlightsService = require('./openFlightsService');

  if (!meta.fromIata || !meta.toIata) return null;

  const from = meta.fromIata.toUpperCase();
  const to   = meta.toIata.toUpperCase();
  const sinceMs = Date.now() - 90 * 24 * 60 * 60 * 1000;

  const route = routeService.getRouteData({ from, to, sinceMs });
  const jontyBlock = _renderJontyEnrichment(from, to);

  // ── THIN PAIR: noindex, keep minimal FAQ only ────────────────────────────────
  if (!route) {
    const fromName = meta.fromName || from;
    const toName   = meta.toName   || to;
    const thinFaq = [
      { q: `Which airlines fly from ${fromName} to ${toName}?`,
        a: `Airline availability for ${from} to ${to} changes by season. Use our search above to see current options.` },
      { q: `Are there direct flights from ${fromName} to ${toName}?`,
        a: `Direct availability on ${from} to ${to} varies by date. Check our search above with flexible dates.` },
    ];
    const faqItems = thinFaq.map(item =>
      `<div itemscope itemprop="mainEntity" itemtype="https://schema.org/Question">
        <h3 itemprop="name">${esc(item.q)}</h3>
        <div itemscope itemprop="acceptedAnswer" itemtype="https://schema.org/Answer">
          <p itemprop="text">${esc(item.a)}</p>
        </div>
      </div>`
    ).join('\n');
    const faqLd = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: thinFaq.map(item => ({
        '@type': 'Question',
        name: item.q,
        acceptedAnswer: { '@type': 'Answer', text: item.a },
      })),
    }).replace(/<\/(script)/gi, '<\\/$1');
    return [
      '<meta name="robots" content="noindex, follow">',
      jontyBlock,
      `<section class="route-faq" itemscope itemtype="https://schema.org/FAQPage">`,
      `  <h2>Frequently asked questions</h2>`,
      faqItems,
      `</section>`,
      `<script type="application/ld+json">${faqLd}</script>`,
    ].filter(Boolean).join('\n');
  }

  // ── RICH PAIR ────────────────────────────────────────────────────────────────
  const { dep, arr, distance_km, estimated_time_str, operators, aircraft, summary } = route;
  const fromName = meta.fromName || dep.city || from;
  const toName   = meta.toName   || arr.city || to;
  const depCity  = dep.city || from;
  const arrCity  = arr.city || to;

  // ── 1. Hero metrics row ──────────────────────────────────────────────────────
  const distanceMiles = Math.round(distance_km * 0.621371);
  const heroSection = `<section class="route-hero-metrics">
  <dl>
    <div><dt>Distance</dt><dd>${esc(distance_km.toLocaleString())} km (${esc(distanceMiles.toLocaleString())} mi)</dd></div>
    <div><dt>Flight time</dt><dd>~${esc(estimated_time_str)}</dd></div>
    <div><dt>Airlines</dt><dd>${esc(String(summary.distinct_operators))}</dd></div>
    <div><dt>Aircraft types</dt><dd>${esc(String(summary.distinct_aircraft))}</dd></div>
  </dl>
</section>`;

  // ── 2. Operators table ───────────────────────────────────────────────────────
  const top10Operators = operators.slice(0, 10);
  const opRows = top10Operators.map(op =>
    `<tr><td><a href="/airline/${esc(op.iata.toLowerCase())}">${esc(op.name)}</a></td><td>${esc(String(op.aircraft_count))}</td><td>${esc(String(op.obs_count))}</td></tr>`
  ).join('\n');
  const operatorsSection = `<section class="route-operators">
  <h2>Airlines flying ${esc(from)} → ${esc(to)}</h2>
  <table>
    <thead><tr><th scope="col">Airline</th><th scope="col">Aircraft types</th><th scope="col">Observations</th></tr></thead>
    <tbody>
${opRows}
    </tbody>
  </table>
</section>`;

  // ── 3. Aircraft on this route ────────────────────────────────────────────────
  const top5Aircraft = aircraft.slice(0, 5);
  const acItems = top5Aircraft.map(ac => {
    const fam = resolveFamily(ac.name);
    const slug = fam?.slug || slugify(ac.name);
    // Require an alphanumeric character — pure-dash slugs would emit /aircraft/---/.
    const isValidSlug = !!slug && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug);
    const nameHtml = isValidSlug
      ? `<a href="/aircraft/${esc(slug)}">${esc(ac.name)}</a>`
      : esc(ac.name);
    return `<li>${nameHtml} — ${esc(String(ac.operator_count))} operator${ac.operator_count === 1 ? '' : 's'}</li>`;
  }).join('\n');
  const aircraftSection = `<section class="route-aircraft">
  <h2>Aircraft on this route</h2>
  <ul>
${acItems}
  </ul>
</section>`;

  // ── 4. Airport details ───────────────────────────────────────────────────────
  function renderAirportCard(label, iata, apData) {
    const ap = openFlightsService.getAirport(iata) || {};
    const icao = ap.icao || null;
    const city    = apData.city    || ap.city    || iata;
    const country = apData.country || ap.country || null;
    const name    = ap.name || iata;
    const icaoRow = icao
      ? `<div><dt>IATA / ICAO</dt><dd>${esc(iata)} / ${esc(icao)}</dd></div>`
      : `<div><dt>IATA</dt><dd>${esc(iata)}</dd></div>`;
    return `<div class="airport-card">
    <h3>${esc(label)}: ${esc(name)} (${esc(iata)})</h3>
    <dl>
      <div><dt>City</dt><dd>${esc(city)}</dd></div>
      ${country ? `<div><dt>Country</dt><dd>${esc(country)}</dd></div>` : ''}
      ${icaoRow}
    </dl>
  </div>`;
  }
  const airportsSection = `<section class="route-airports">
  <h2>Airport details</h2>
  ${renderAirportCard('Departure', from, dep)}
  ${renderAirportCard('Arrival', to, arr)}
</section>`;

  // ── 5. Cross-routes cluster ──────────────────────────────────────────────────
  const fromRoutes = routeService.getTopRoutesFromCity({
    iata: from, sinceMs, limit: 5, excludePair: `${from}-${to}`,
  });
  const toRoutes = routeService.getTopRoutesToCity({
    iata: to, sinceMs, limit: 5, excludePair: `${from}-${to}`,
  });
  const fromItems = fromRoutes.map(r => {
    const href = `/routes/${esc(from.toLowerCase())}-${esc(r.arr_iata.toLowerCase())}`;
    const label = r.arr_city ? `${esc(from)} → ${esc(r.arr_iata)} (${esc(r.arr_city)})` : `${esc(from)} → ${esc(r.arr_iata)}`;
    return `<li><a href="${href}">${label}</a></li>`;
  }).join('\n');
  const toItems = toRoutes.map(r => {
    const href = `/routes/${esc(r.dep_iata.toLowerCase())}-${esc(to.toLowerCase())}`;
    const label = r.dep_city ? `${esc(r.dep_iata)} → ${esc(to)} (${esc(r.dep_city)})` : `${esc(r.dep_iata)} → ${esc(to)}`;
    return `<li><a href="${href}">${label}</a></li>`;
  }).join('\n');
  const crossSection = `<section class="route-cross">
  <h2>Other routes from ${esc(depCity)}</h2>
  <ul>
${fromItems || '<li>No data available</li>'}
  </ul>
  <h2>Other routes to ${esc(arrCity)}</h2>
  <ul>
${toItems || '<li>No data available</li>'}
  </ul>
</section>`;

  // ── 6. Programmatic FAQ ──────────────────────────────────────────────────────
  const top3AcNames = aircraft.slice(0, 3).map(ac => ac.name).join(', ');
  const faqItems = [
    {
      q: `How many airlines fly ${from} to ${to}?`,
      a: `${summary.distinct_operators} airline${summary.distinct_operators === 1 ? '' : 's'} operate${summary.distinct_operators === 1 ? 's' : ''} the ${from} to ${to} route in our 90-day observed dataset.`,
    },
    {
      q: `What aircraft fly the ${from}-${to} route?`,
      a: top3AcNames
        ? `The most commonly observed aircraft on ${from} to ${to} include: ${top3AcNames}.`
        : `Multiple aircraft types have been observed on the ${from} to ${to} route.`,
    },
    {
      q: `How long is the ${fromName} to ${toName} flight?`,
      a: `The estimated flight time from ${fromName} (${from}) to ${toName} (${to}) is approximately ${estimated_time_str}, based on a cruise speed of 850 km/h.`,
    },
    {
      q: `What's the distance from ${fromName} to ${toName}?`,
      a: `The great-circle distance from ${fromName} (${from}) to ${toName} (${to}) is approximately ${distance_km.toLocaleString()} km (${distanceMiles.toLocaleString()} miles).`,
    },
  ];
  const faqHtmlItems = faqItems.map(item =>
    `<div itemscope itemprop="mainEntity" itemtype="https://schema.org/Question">
    <h3 itemprop="name">${esc(item.q)}</h3>
    <div itemscope itemprop="acceptedAnswer" itemtype="https://schema.org/Answer">
      <p itemprop="text">${esc(item.a)}</p>
    </div>
  </div>`
  ).join('\n');
  const faqSection = `<section class="route-faq" itemscope itemtype="https://schema.org/FAQPage">
  <h2>Frequently asked questions</h2>
${faqHtmlItems}
</section>`;

  // ── FAQPage JSON-LD ──────────────────────────────────────────────────────────
  const faqLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqItems.map(item => ({
      '@type': 'Question',
      name: item.q,
      acceptedAnswer: { '@type': 'Answer', text: item.a },
    })),
  }).replace(/<\/(script)/gi, '<\\/$1');
  const jsonLdBlock = `<script type="application/ld+json">${faqLd}</script>`;

  return [
    heroSection,
    operatorsSection,
    aircraftSection,
    airportsSection,
    jontyBlock,
    crossSection,
    faqSection,
    jsonLdBlock,
  ].filter(Boolean).join('\n');
}

function bAircraft(meta, db) {
  if (!Array.isArray(meta.icaoList) || meta.icaoList.length === 0) return null;
  const facts = db.getAircraftFacts(meta.icaoList);
  const haveFacts = facts.airlineCount > 0 || facts.routeCount > 0;
  const haveSafety = meta.colorBand && meta.colorBand.bucket !== undefined;
  const haveVariants = Array.isArray(meta.variants) && meta.variants.length > 0;
  if (!haveFacts && !haveSafety && !haveVariants && !meta.fr24Stats?.totalFlights) return null;

  const topRoutes = haveFacts ? db.getAircraftTopRoutes(meta.icaoList, 5) : [];
  const routeLabels = topRoutes.map((r) => `${esc(r.from)}-${esc(r.to)}`).join(', ');
  const label = meta.aircraftLabel || meta.slug || 'this aircraft';

  // 1. Existing "About" block (operator count, top routes)
  const factsBlock = haveFacts ? `
    <p>The ${esc(label)} is operated by ${esc(facts.airlineCount)} airline${facts.airlineCount === 1 ? '' : 's'} across ${esc(facts.routeCount)} city pair${facts.routeCount === 1 ? '' : 's'} in our observed-flights dataset (last 14 days).</p>
    ${routeLabels ? `<p>Top routes: ${routeLabels}.</p>` : ''}
  `.trim() : '';

  // 5. Existing safety / variants / FR24 blocks (unchanged)
  const safetyBlock = _renderSafetyBand(meta) + _renderTopEvents(meta.topEvents);
  const variantsBlock = _renderVariantsList(meta.variants);
  const fr24Block = _renderFr24Stats(meta.fr24Stats, { context: 'aircraft' });

  // Enrichment path — only populated for slugs present in aircraftLandingContent.json
  const enriched = getEnrichmentForSlug(meta.slug);

  if (!enriched) {
    // No enrichment: return existing template output unchanged.
    return [factsBlock, safetyBlock, variantsBlock, fr24Block].filter(Boolean).join('\n').trim();
  }

  // 2. NEW: Variants table
  const variantsTableBlock = renderVariantsTable(enriched.variants);
  // 3. NEW: Notable accidents
  const incidentsBlock = renderNotableIncidents(enriched.notableIncidents);
  // 4. NEW: Variant callout
  const calloutBlock = renderVariantCallout(enriched.variantCallout);
  // 6. NEW: Enhanced FAQ (replaces template FAQ for enriched slugs)
  const faqBlock = renderEnhancedFAQ(enriched.faq);

  // Inline JSON-LD: variants ItemList + enhanced FAQPage.
  // Embedded in body (inside data-seo-bake section) so tests can parse it
  // from the build() output without needing inject(). The seoMetaService
  // also emits its own FAQPage in <head> — for enriched slugs we override
  // with the richer 6-Q set here; Google will use the most specific signal.
  const ldGraph = [];
  const variantsLD = buildVariantsItemListLD(enriched.variants, meta.slug);
  if (variantsLD) ldGraph.push(variantsLD);
  const faqLD = buildFAQPageLD(enriched.faq);
  if (faqLD) ldGraph.push(faqLD);

  const jsonLdBlock = ldGraph.length > 0
    ? `<script type="application/ld+json">${JSON.stringify({
        '@context': 'https://schema.org',
        '@graph': ldGraph,
      }).replace(/<\/(script)/gi, '<\\/$1')}</script>`
    : '';

  return [
    factsBlock,
    variantsTableBlock,
    incidentsBlock,
    calloutBlock,
    safetyBlock,
    variantsBlock,
    fr24Block,
    faqBlock,
    jsonLdBlock,
  ].filter(Boolean).join('\n').trim();
}

function bAircraftAirlines(meta, db) {
  if (!Array.isArray(meta.icaoList) || meta.icaoList.length === 0) return null;
  const ops = db.getAircraftOperators(meta.icaoList, 20);
  if (ops.length === 0) return null;

  // Build a Set of "iata:icao" keys from valid matrix combos for O(1) lookup.
  const openFlightsService = require('./openFlightsService');
  const validCombos = airlineAircraftService.listValidCombinations({ minPairs: 5 });
  const validSet = airlineAircraftService.buildValidComboSet(validCombos);

  const label = meta.aircraftLabel || meta.slug || 'this aircraft';

  const items = ops.map((o) => {
    // o.airline is the ICAO code stored in airline_iata column — resolve to IATA.
    const airlineRecord = openFlightsService.getAirlineByIcao(o.airline);
    const airlineIata   = airlineRecord?.iata;
    const displayName   = airlineRecord?.name || o.airline;

    // Find the first aircraft ICAO in this family's icaoList that has a valid matrix page.
    let matrixIcao = null;
    if (airlineIata) {
      for (const icao of meta.icaoList) {
        const key = `${airlineIata.toLowerCase()}:${icao.toLowerCase()}`;
        if (validSet.has(key)) { matrixIcao = icao; break; }
      }
    }

    const nameHtml = matrixIcao && airlineIata
      ? `<a href="/airline/${esc(airlineIata.toLowerCase())}/aircraft/${esc(matrixIcao.toLowerCase())}">${esc(displayName)}</a>`
      : esc(displayName);

    return `<li>${nameHtml} — ${esc(o.count)} observed flight${o.count === 1 ? '' : 's'}</li>`;
  }).join('');

  return `
    <p>${esc(ops.length)} airline${ops.length === 1 ? '' : 's'} observed operating the ${esc(label)} in the last 14 days, ranked by flight frequency:</p>
    <ul>${items}</ul>
  `.trim();
}

function bAircraftRoutes(meta, db) {
  if (!Array.isArray(meta.icaoList) || meta.icaoList.length === 0) return null;
  const routes = db.getAircraftTopRoutes(meta.icaoList, 30);
  if (routes.length === 0) return null;
  const items = routes
    .map((r) => `<li>${esc(r.from)} → ${esc(r.to)} (${esc(r.count)} flight${r.count === 1 ? '' : 's'})</li>`)
    .join('');
  const label = meta.aircraftLabel || meta.slug || 'this aircraft';
  return `
    <p>Top ${esc(routes.length)} city pairs flown by the ${esc(label)}, ranked by frequency in the last 14 days:</p>
    <ul>${items}</ul>
  `.trim();
}

// /routes/:pair/:slug — narrow combo page (e.g. /routes/lhr-jfk/boeing-787).
//
// If getVariantData() returns null (0 observations in 14-day window):
//   - emit noindex, follow
//   - render minimal "no recent observations" body + cross-links to parent pages
//
// If data exists: full landing page with 6 rich sections + JSON-LD.
function bAircraftRoute(meta, _db) {
  if (!meta || !meta.fromIata || !meta.toIata || !meta.slug) return null;
  const { fromIata, toIata, slug } = meta;

  const aircraftRouteService = require('./aircraftRouteService');
  const openFlightsService   = require('./openFlightsService');

  const from = fromIata.toUpperCase();
  const to   = toIata.toUpperCase();
  const pair = `${from.toLowerCase()}-${to.toLowerCase()}`;

  const data = aircraftRouteService.getVariantData({ from, to, slug });

  const routeHref   = `/routes/${esc(pair)}`;
  const aircraftHref = `/aircraft/${esc(slug)}`;

  // ── EMPTY PAIR: noindex + minimal cross-links ─────────────────────────────
  if (!data) {
    const label = meta.aircraftLabel || slug;
    return [
      '<meta name="robots" content="noindex, follow">',
      `<section class="variant-route-empty">`,
      `  <p>No recent observations of the <strong>${esc(label)}</strong> on the ${esc(from)}–${esc(to)} route in our 14-day rolling ADS-B window.</p>`,
      `  <p>The route may be operated by other aircraft types — see the <a href="${routeHref}">${esc(from)}–${esc(to)} route page</a> for current operators, or the <a href="${aircraftHref}">${esc(label)} family page</a> for global fleet data.</p>`,
      `  <p><a href="/aircraft/${esc(slug)}/safety">Safety record for the ${esc(label)} →</a></p>`,
      `</section>`,
    ].join('\n');
  }

  // ── RICH PAIR ─────────────────────────────────────────────────────────────
  const BASE_URL = 'https://himaxym.com';
  const { dep, arr, family, distance_km, estimated_time_str, operators, other_aircraft, observed_count } = data;
  const label    = family.label || family.name;
  const depCity  = dep.city  || from;
  const arrCity  = arr.city  || to;
  const distanceMiles = Math.round(distance_km * 0.621371);

  // ── 1. Hero metrics row ───────────────────────────────────────────────────
  const heroSection = `<section class="variant-route-hero-metrics">
  <dl>
    <div><dt>Distance</dt><dd>${esc(distance_km.toLocaleString())} km (${esc(distanceMiles.toLocaleString())} mi)</dd></div>
    <div><dt>Est. flight time</dt><dd>~${esc(estimated_time_str)}</dd></div>
    <div><dt>Operators on ${esc(label)}</dt><dd>${esc(String(operators.length))}</dd></div>
    <div><dt>Observations (14 days)</dt><dd>${esc(String(observed_count))}</dd></div>
  </dl>
</section>`;

  // ── 2. Operators table ────────────────────────────────────────────────────
  // Build valid-combo set for matrix page links (same pattern as bAircraftAirlines)
  const validCombos = airlineAircraftService.listValidCombinations({ minPairs: 5 });
  const validSet    = airlineAircraftService.buildValidComboSet(validCombos);

  const opRows = operators.map((op) => {
    // Check if we can link to matrix page /airline/{iata}/aircraft/{icao}
    let matrixIcao = null;
    for (const icao of family.icao_list) {
      const key = `${op.iata.toLowerCase()}:${icao.toLowerCase()}`;
      if (validSet.has(key)) { matrixIcao = icao; break; }
    }
    const nameHtml = matrixIcao
      ? `<a href="/airline/${esc(op.iata.toLowerCase())}/aircraft/${esc(matrixIcao.toLowerCase())}">${esc(op.name)}</a>`
      : `<a href="/airline/${esc(op.iata.toLowerCase())}">${esc(op.name)}</a>`;
    const firstDate = op.first_seen_at ? new Date(op.first_seen_at).toISOString().slice(0, 10) : '—';
    const lastDate  = op.last_seen_at  ? new Date(op.last_seen_at).toISOString().slice(0, 10)  : '—';
    return `<tr><td>${nameHtml}</td><td>${esc(String(op.obs_count))}</td><td>${esc(firstDate)}</td><td>${esc(lastDate)}</td></tr>`;
  }).join('\n');

  const operatorsSection = `<section class="variant-route-operators">
  <h2>Airlines operating the ${esc(label)} on ${esc(from)} → ${esc(to)}</h2>
  <table>
    <thead><tr><th scope="col">Airline</th><th scope="col">Observations</th><th scope="col">First seen</th><th scope="col">Last seen</th></tr></thead>
    <tbody>
${opRows}
    </tbody>
  </table>
</section>`;

  // ── 3. About this aircraft on this route ─────────────────────────────────
  const aircraftCalloutSection = `<section class="variant-route-callout">
  <h2>About the ${esc(label)} on this route</h2>
  <p>The <a href="${aircraftHref}">${esc(label)}</a> is used by ${esc(String(operators.length))} operator${operators.length === 1 ? '' : 's'} on ${esc(depCity)} → ${esc(arrCity)}.</p>
  <p>For specifications, safety record, and global deployment data, see the <a href="${aircraftHref}">${esc(label)} family page</a> or the <a href="/aircraft/${esc(slug)}/safety">${esc(label)} safety record</a>.</p>
</section>`;

  // ── 4. Other aircraft on this route ──────────────────────────────────────
  let otherAircraftSection = '';
  if (other_aircraft.length > 0) {
    const otherCards = other_aircraft.map((ac) =>
      `<li><a href="/routes/${esc(pair)}/${esc(ac.slug)}">${esc(ac.name)}</a> — ${esc(String(ac.obs_count))} observation${ac.obs_count === 1 ? '' : 's'}</li>`
    ).join('\n');
    otherAircraftSection = `<section class="variant-route-other-aircraft">
  <h2>Other aircraft on the ${esc(from)}–${esc(to)} route</h2>
  <ul>
${otherCards}
  </ul>
</section>`;
  }

  // ── 5. Airport details ────────────────────────────────────────────────────
  function renderAirportCard(labelStr, iata, apData) {
    const ap = openFlightsService.getAirport(iata) || {};
    const icao    = ap.icao    || null;
    const city    = apData.city    || ap.city    || iata;
    const country = apData.country || ap.country || null;
    const name    = ap.name || iata;
    const icaoRow = icao
      ? `<div><dt>IATA / ICAO</dt><dd>${esc(iata)} / ${esc(icao)}</dd></div>`
      : `<div><dt>IATA</dt><dd>${esc(iata)}</dd></div>`;
    return `<div class="airport-card">
    <h3>${esc(labelStr)}: ${esc(name)} (${esc(iata)})</h3>
    <dl>
      <div><dt>City</dt><dd>${esc(city)}</dd></div>
      ${country ? `<div><dt>Country</dt><dd>${esc(country)}</dd></div>` : ''}
      ${icaoRow}
    </dl>
  </div>`;
  }
  const airportsSection = `<section class="variant-route-airports">
  <h2>Airport details</h2>
  ${renderAirportCard('Departure', from, dep)}
  ${renderAirportCard('Arrival', to, arr)}
</section>`;

  // ── 6. Programmatic FAQ ───────────────────────────────────────────────────
  const top3OpNames = operators.slice(0, 3).map((op) => op.name).join(', ');
  const top3OtherNames = other_aircraft.slice(0, 3).map((ac) => ac.name).join(', ');
  const windowDays = 14;

  const faqItems = [
    {
      q: `Which airlines fly the ${label} on the ${pair.toUpperCase()} route?`,
      a: top3OpNames
        ? `Airlines observed operating the ${label} on ${from} to ${to} include: ${top3OpNames}.`
        : `No airlines were observed operating the ${label} on ${from}–${to} in the last ${windowDays} days.`,
    },
    {
      q: `How often does the ${label} fly ${pair.toUpperCase()}?`,
      a: `The ${label} was observed ${observed_count} time${observed_count === 1 ? '' : 's'} on the ${from}–${to} route in the last ${windowDays} days across ${operators.length} operator${operators.length === 1 ? '' : 's'}.`,
    },
    {
      q: `What's the distance from ${depCity} to ${arrCity}?`,
      a: `The great-circle distance from ${depCity} (${from}) to ${arrCity} (${to}) is approximately ${distance_km.toLocaleString()} km (${distanceMiles.toLocaleString()} miles). Estimated flight time is ~${estimated_time_str}.`,
    },
    {
      q: `What other aircraft fly the ${pair.toUpperCase()} route?`,
      a: top3OtherNames
        ? `Other aircraft observed on ${from}–${to} include: ${top3OtherNames}.`
        : `No other aircraft families were observed on the ${from}–${to} route in the last ${windowDays} days.`,
    },
  ];

  const faqHtmlItems = faqItems.map((item) =>
    `<div itemscope itemprop="mainEntity" itemtype="https://schema.org/Question">
    <h3 itemprop="name">${esc(item.q)}</h3>
    <div itemscope itemprop="acceptedAnswer" itemtype="https://schema.org/Answer">
      <p itemprop="text">${esc(item.a)}</p>
    </div>
  </div>`
  ).join('\n');

  const faqSection = `<section class="variant-route-faq" itemscope itemtype="https://schema.org/FAQPage">
  <h2>Frequently asked questions</h2>
${faqHtmlItems}
</section>`;

  // ── FAQPage JSON-LD ───────────────────────────────────────────────────────
  const faqLd = {
    '@type': 'FAQPage',
    mainEntity: faqItems.map((item) => ({
      '@type': 'Question',
      name: item.q,
      acceptedAnswer: { '@type': 'Answer', text: item.a },
    })),
  };

  // ── BreadcrumbList JSON-LD ────────────────────────────────────────────────
  const breadcrumbLd = {
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home',   item: `${BASE_URL}/` },
      { '@type': 'ListItem', position: 2, name: 'Routes', item: `${BASE_URL}/routes` },
      { '@type': 'ListItem', position: 3, name: pair.toUpperCase(), item: `${BASE_URL}/routes/${pair}` },
      { '@type': 'ListItem', position: 4, name: label, item: `${BASE_URL}/routes/${pair}/${slug}` },
    ],
  };

  const jsonLdRaw = JSON.stringify({
    '@context': 'https://schema.org',
    '@graph': [faqLd, breadcrumbLd],
  }).replace(/<\/(script)/gi, '<\\/$1');
  const jsonLdBlock = `<script type="application/ld+json">${jsonLdRaw}</script>`;

  return [
    heroSection,
    operatorsSection,
    aircraftCalloutSection,
    otherAircraftSection,
    airportsSection,
    faqSection,
    jsonLdBlock,
  ].filter(Boolean).join('\n');
}

function bAircraftSafety(meta, _db) {
  if (!meta) return null;

  const safetyHeader = _renderSafetyBand(meta);
  const breakdown = _renderVariantBreakdown(meta.allEvents, meta.variants);
  const top = _renderTopEvents(meta.topEvents);
  const fullList = _renderDecadeTimeline(meta.allEvents);

  if (!safetyHeader && !top && !breakdown && !fullList) return null;
  return [safetyHeader, breakdown, top, fullList].filter(Boolean).join('\n').trim();
}

function bAircraftVariant(meta, db) {
  if (!meta || !meta.variant) return null;
  const v = meta.variant;
  const fam = meta.family || {};

  const operators = (() => {
    try { return db.getAircraftOperators([v.icao], 10); } catch { return []; }
  })();
  const topRoutes = (() => {
    try { return db.getAircraftTopRoutes([v.icao], 10); } catch { return []; }
  })();

  const description = `<p>${esc(v.description)}</p><p>First flight ${esc(v.firstFlight)}. Capacity ${esc(v.capacity)}. Range ${esc(v.range_km)} km. Engines: ${esc((v.engines || []).join(' or '))}.</p>`;

  const safetyHeader = _renderSafetyBand(meta);
  const topEvents = _renderTopEvents(meta.topEvents);
  const fullTimeline = _renderDecadeTimeline(meta.allEvents);

  const operatorsBlock = operators.length > 0
    ? `<h3>Operators</h3><p>Operated by ${esc(operators.length)} airline${operators.length === 1 ? '' : 's'} (top by frequency in our observed-flights dataset):</p><ul>${operators.map((o) => `<li>${esc(o.airline)} — ${esc(o.count)} observed flight${o.count === 1 ? '' : 's'}</li>`).join('')}</ul>`
    : '<p>No observed flights for this variant in our dataset.</p>';

  const routesBlock = topRoutes.length > 0
    ? `<h3>Top routes</h3><ul>${topRoutes.map((r) => `<li>${esc(r.from)} → ${esc(r.to)} (${esc(r.count)} flight${r.count === 1 ? '' : 's'})</li>`).join('')}</ul>`
    : '';

  const familyLink = fam.label
    ? `<p>Part of the <a href="/aircraft/${esc(fam.slug || meta.variant.familySlug)}">${esc(fam.label)}</a> family.</p>`
    : '';

  const fr24Block = _renderFr24Stats(meta.fr24Stats, { context: 'aircraft' });

  return [description, safetyHeader, topEvents, fullTimeline, operatorsBlock, routesBlock, familyLink, fr24Block]
    .filter(Boolean).join('\n').trim();
}

function bAircraftSpecs(meta, _db) {
  const fam = meta.family || {};
  const parts = [];
  if (fam.range_km)  parts.push(`Range: <strong>${esc(fam.range_km)} km</strong>`);
  if (fam.capacity)  parts.push(`Capacity: <strong>${esc(fam.capacity)} seats</strong>`);
  if (fam.engines)   parts.push(`Engines: <strong>${esc(fam.engines)}</strong>`);
  if (fam.mtow_kg)   parts.push(`MTOW: <strong>${esc(fam.mtow_kg)} kg</strong>`);
  if (parts.length === 0) return null;
  const label = meta.aircraftLabel || meta.slug || 'aircraft';
  return `
    <p>Specifications for the ${esc(label)}:</p>
    <ul>${parts.map((p) => `<li>${p}</li>`).join('')}</ul>
  `.trim();
}

function bHome(_meta, db) {
  const routeCount = db.getRouteCount();
  const families = getFamilyList();

  const intro = `
    <p>Search ${esc(routeCount)} observed routes worldwide, filtered by aircraft type. Pick a Boeing 737, Airbus A320, turboprop, or wide-body jet — see only flights operating that equipment.</p>
    <p>${esc(families.length)} aircraft families have dedicated landing pages with operator lists, top routes, safety records, and full specifications.</p>
  `.trim();

  const familyCards = `
    <h2>Aircraft families</h2>
    <div class="family-grid">
      ${families.map((f) => _familyCard(f, db)).filter(Boolean).join('')}
    </div>
  `.trim();

  let topRoutes = [];
  try { topRoutes = db.getTopRoutesByObservedFrequency(15); } catch { topRoutes = []; }
  const routesBlock = topRoutes.length > 0 ? `
    <h2>Popular routes</h2>
    <ul class="popular-routes">
      ${topRoutes.map((r) => `<li><a href="/routes/${esc(r.from.toLowerCase())}-${esc(r.to.toLowerCase())}">${esc(r.from)}–${esc(r.to)}</a> <small>(${esc(r.count)} observed)</small></li>`).join('')}
    </ul>
  `.trim() : '';

  const safetyBlock = `
    <h2>Safety</h2>
    <ul>
      <li><a href="/safety/global">Global safety overview</a> — color-coded buckets per aircraft type</li>
      <li><a href="/safety/feed">Recent safety events</a> — chronological feed from public datasets</li>
    </ul>
  `.trim();

  return [intro, familyCards, routesBlock, safetyBlock].filter(Boolean).join('\n');
}

function _familyCard(f, db) {
  const { getFamilyBySlug } = require('../models/aircraftFamilies');
  const fullFam = getFamilyBySlug(f.slug);
  const icaoList = (fullFam && fullFam.icaoList) || [];
  let facts = { airlineCount: 0, routeCount: 0 };
  try { facts = db.getAircraftFacts(icaoList); } catch {}
  const stats = facts.airlineCount > 0
    ? `<p class="stats">${esc(facts.airlineCount)} operators · ${esc(facts.routeCount)} city pairs</p>`
    : '';
  return `<article class="family-card">
    <h3><a href="/aircraft/${esc(f.slug)}">${esc(f.label)}</a></h3>
    <p class="manufacturer">${esc(f.manufacturer)}${f.type ? ` · ${esc(f.type)}` : ''}</p>
    ${stats}
  </article>`;
}

function bSafetyGlobal(_meta, _db) {
  return `
    <p>Worldwide aviation accident dataset aggregated from the Aviation Safety Network, the Bureau of Aircraft Accidents Archives (B3A), and Wikidata. Over 40,000 records since 1980 with aircraft type, operator, location, fatalities and source URL where known.</p>
    <p>Updated weekly. Free for non-commercial use; cite Aviation Safety Network and B3A when redistributing.</p>
  `.trim();
}

function bSafetyEvent(meta, _db) {
  const ev = meta?.eventData;
  if (!ev) return null;

  const date = new Date(ev.occurred_at).toISOString().slice(0, 10);
  const fam = ev.aircraft_icao_type ? getFamilyByCode(ev.aircraft_icao_type) : null;
  const aircraftLabel = fam?.label || ev.aircraft_icao_type || 'Unknown aircraft';
  const familySlug = fam ? slugify(fam.name) : null;

  const severityLabel = ev.severity === 'fatal'
    ? 'Fatal'
    : ev.hull_loss === 1 ? 'Hull loss' : 'Incident';

  const operator = ev.operator_name || ev.operator_icao || null;
  const operatorIdent = ev.operator_iata || ev.operator_icao || null;

  const route = (ev.dep_iata || ev.arr_iata)
    ? `${ev.dep_iata || '—'} → ${ev.arr_iata || '—'}`
    : null;

  const sourceUrl = _safeHttpUrl(ev.report_url || '')
    || (ev.source === 'ntsb' && ev.source_event_id
      ? `https://www.ntsb.gov/safety/Pages/safety-overview.aspx?ev=${ev.source_event_id}`
      : '');
  const sourceLabel = ev.source === 'ntsb' ? 'US NTSB CAROL' : 'Aviation Safety Network / Wikidata';

  // Fact list — render only rows we actually have, so stub events stay tidy.
  const rows = [
    ['Date', date],
    operator ? ['Operator', operatorIdent
      ? `<a href="/safety/global?op=${esc(operatorIdent)}">${esc(operator)}</a>`
      : esc(operator)] : null,
    ['Aircraft', familySlug
      ? `<a href="/aircraft/${esc(familySlug)}">${esc(aircraftLabel)}</a>`
      : esc(aircraftLabel)],
    ev.registration ? ['Registration', esc(ev.registration)] : null,
    route ? ['Route', esc(route)] : null,
    ev.phase_of_flight ? ['Phase of flight', esc(ev.phase_of_flight)] : null,
    ev.fatalities > 0 ? ['Fatalities', esc(ev.fatalities)] : null,
    ev.injuries > 0 ? ['Injuries', esc(ev.injuries)] : null,
    ['Hull loss', ev.hull_loss === 1 ? 'Yes' : 'No'],
    ev.location_country ? ['Country', esc(ev.location_country)] : null,
    ['Severity', esc(severityLabel)],
  ].filter(Boolean);

  const dl = `<dl class="safety-event-facts">${
    rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')
  }</dl>`;

  const narrativeBlock = ev.narrative && ev.narrative.length > 30
    ? `<section><h2>Probable cause</h2><p>${esc(ev.narrative)}</p></section>`
    : '';

  const sourceBlock = sourceUrl
    ? `<p class="safety-event-source">Source: <a href="${esc(sourceUrl)}" rel="nofollow">${esc(sourceLabel)}</a>${
        ev.source_event_id ? ` · Case ID <code>${esc(ev.source_event_id)}</code>` : ''
      }</p>`
    : `<p class="safety-event-source">Source: ${esc(sourceLabel)}</p>`;

  const backLink = `<p><a href="/safety/feed">← Back to NTSB feed</a></p>`;

  return [dl, narrativeBlock, sourceBlock, backLink].filter(Boolean).join('\n');
}

function bSafetyFeed(meta, _db) {
  if (!Array.isArray(meta.recentIncidents) || meta.recentIncidents.length === 0) return null;
  const items = meta.recentIncidents.slice(0, 10).map((i) =>
    `<li>${esc(i.date)} — ${esc(i.aircraft || 'unknown aircraft')}: ${esc(i.summary || 'no summary')}</li>`
  ).join('');
  return `
    <p>Recent U.S. aviation accidents and incidents from the official National Transportation Safety Board (NTSB) CAROL database, updated daily.</p>
    <ul>${items}</ul>
  `.trim();
}

async function bAirport(meta, _db) {
  const iata = meta.iata;
  if (!iata) return null;
  const amadeus = require('./amadeusAnalyticsService');

  const directDest = await amadeus.getAirportDirectDestinations(iata).catch(() => null);

  const heading = `<h1>${esc(iata)} airport — flights and destinations</h1>`;

  let destBlock = '';
  if (directDest && directDest.length > 0) {
    const top = directDest.slice(0, 50);
    const links = top.map(d =>
      `<a href="/routes/${esc(iata.toLowerCase())}-${esc(String(d).toLowerCase())}">${esc(iata)}→${esc(d)}</a>`
    ).join(', ');
    destBlock = `<section><h2>Direct destinations (${esc(top.length)})</h2><p>${links}</p></section>`;
  }

  const jsonLd = `<script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Airport',
    name: `${iata} Airport`,
    iataCode: iata,
  })}</script>`;

  return [heading, destBlock, jsonLd].filter(Boolean).join('\n');
}

async function bAirline(meta, _db) {
  const iata = meta.iata;
  if (!iata) return null;
  const amadeus = require('./amadeusAnalyticsService');

  const destinations = await amadeus.getAirlineRoutes(iata).catch(() => null);

  const heading = `<h1>${esc(meta.airlineName || iata)} — destinations and fleet</h1>`;

  let destBlock = '';
  if (destinations && destinations.length > 0) {
    const top = destinations.slice(0, 100);
    const links = top.map(d =>
      `<a href="/airport/${esc(String(d).toLowerCase())}">${esc(d)}</a>`
    ).join(', ');
    destBlock = `<section><h2>Destinations served (${esc(top.length)})</h2><p>${links}</p></section>`;
  } else {
    destBlock = `<p>Network data is being collected.</p>`;
  }

  // Top aircraft section: query observed_routes for this airline's fleet,
  // link to matrix pages where a valid combo (≥5 pairs) exists.
  let topAircraftBlock = '';
  try {
    const topAircraft = airlineAircraftService.getTopAircraftForAirline({ iataAirline: iata, limit: 6 });
    if (topAircraft.length > 0) {
      // Build valid combo set for O(1) lookup.
      const validCombos = airlineAircraftService.listValidCombinations({ minPairs: 5 });
      const validSet = airlineAircraftService.buildValidComboSet(validCombos);

      const airlineIataLower = iata.toLowerCase();
      const items = topAircraft.map(ac => {
        const key = `${airlineIataLower}:${ac.icao_aircraft.toLowerCase()}`;
        const nameLabel = esc(ac.name);
        const nameHtml = validSet.has(key)
          ? `<a href="/airline/${esc(airlineIataLower)}/aircraft/${esc(ac.icao_aircraft.toLowerCase())}">${nameLabel}</a>`
          : nameLabel;
        return `<li>${nameHtml} — ${esc(ac.n_pairs)} route pair${ac.n_pairs === 1 ? '' : 's'}</li>`;
      }).join('');

      const airlineName = esc(iata);
      topAircraftBlock = `<section><h2>Top aircraft flown by ${airlineName}</h2><ul>${items}</ul></section>`;
    }
  } catch { /* non-fatal */ }

  // Hub airports section: top 5 departure airports in last 90d.
  let hubsBlock = '';
  try {
    const hubs = airlineAircraftService.getTopHubsForAirline({ iataAirline: iata, limit: 5 });
    if (hubs.length > 0) {
      const items = hubs.map(h => {
        const loc = h.country ? `${esc(h.city)}, ${esc(h.country)}` : esc(h.city);
        return `<li>${esc(h.iata)} · ${loc} · ${esc(h.pair_count)} route${h.pair_count === 1 ? '' : 's'}</li>`;
      }).join('');
      hubsBlock = `<section><h2>Hub airports</h2><ul>${items}</ul></section>`;
    }
  } catch { /* non-fatal */ }

  // Top destinations section: top 5 arrival airports in last 90d.
  let topDestBlock = '';
  try {
    const dests = airlineAircraftService.getTopDestinationsForAirline({ iataAirline: iata, limit: 5 });
    if (dests.length > 0) {
      const items = dests.map(d => {
        const loc = d.country ? `${esc(d.city)}, ${esc(d.country)}` : esc(d.city);
        return `<li>${esc(d.iata)} · ${loc} · ${esc(d.pair_count)} route${d.pair_count === 1 ? '' : 's'}</li>`;
      }).join('');
      topDestBlock = `<section><h2>Top destinations</h2><ul>${items}</ul></section>`;
    }
  } catch { /* non-fatal */ }

  // Safety record section: cross-link to filtered safety page.
  const safetyBlock = `<section><h2>Safety record</h2><p>Recent accident and incident reports involving ${esc(iata)} aircraft.</p><p><a href="/safety/global?op=${esc(iata)}">View safety database →</a></p></section>`;

  const jsonLd = `<script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Airline',
    name: `${iata} Airline`,
    iataCode: iata,
  })}</script>`;

  return [heading, destBlock, topAircraftBlock, hubsBlock, topDestBlock, safetyBlock, jsonLd].filter(Boolean).join('\n');
}

/**
 * /airline/:iata/aircraft/:icao — airline × aircraft matrix landing page.
 * Synchronous: airlineAircraftService.getCombo() is SQLite (better-sqlite3, sync).
 *
 * @param {object} meta - must include iata, icao (from airlineAircraftMeta)
 * @param {object} _db  - unused (service has its own db reference)
 * @returns {string} HTML inner content
 */
function bAirlineAircraft(meta, _db) {
  const { iata, icao } = meta;
  const data = airlineAircraftService.getCombo({
    iataAirline:  iata,
    icaoAircraft: icao,
    sinceMs:      Date.now() - 90 * 86400000,
  });

  if (!data) {
    // Downgrade robots on the way out so the chain picks it up.
    meta.robots = 'noindex, follow';
    return `
<section class="landing-airline-aircraft__no-data">
  <h1>${esc(meta.h1)}</h1>
  <p>No routes found for this airline and aircraft combination in the last 90 days.</p>
</section>
<meta name="robots" content="noindex, follow">`.trim();
  }

  const { airline, aircraft, summary, routes } = data;

  // ── Hero ──────────────────────────────────────────────────────────────────
  const heroSection = `
<section class="landing-airline-aircraft__hero">
  <h1>${esc(airline.name)} routes on the ${esc(aircraft.name)}</h1>
  <p>${esc(String(summary.n_pairs))} routes across ${esc(String(summary.n_airports))} airports in the last 90 days.</p>
</section>`.trim();

  // ── Routes table ──────────────────────────────────────────────────────────
  const routeRows = routes.map(r => `
    <tr>
      <td><a href="/search?from=${esc(r.dep.iata)}&amp;to=${esc(r.arr.iata)}">${esc(r.dep.iata)}</a></td>
      <td>${esc(r.arr.iata)}</td>
      <td>${esc(new Date(r.last_seen_at).toISOString().slice(0, 10))}</td>
      <td>${esc(String(r.distance_km))}</td>
    </tr>`).join('');

  const routesSection = `
<section class="landing-airline-aircraft__routes">
  <h2>Routes flown</h2>
  <table>
    <thead>
      <tr>
        <th scope="col">Departure</th>
        <th scope="col">Arrival</th>
        <th scope="col">Last seen</th>
        <th scope="col">Distance (km)</th>
      </tr>
    </thead>
    <tbody>
      ${routeRows}
    </tbody>
  </table>
</section>`.trim();

  // ── Mini map placeholder ──────────────────────────────────────────────────
  const mapSection = `
<section class="landing-airline-aircraft__map">
  <h2>Route map</h2>
  <div id="airline-aircraft-map"></div>
</section>`.trim();

  // ── Airline card ──────────────────────────────────────────────────────────
  const airlineSection = `
<section class="landing-airline-aircraft__airline">
  <h2>${esc(airline.name)}</h2>
  ${airline.country ? `<p>${esc(airline.country)}</p>` : ''}
  <p><a href="/airline/${esc(airline.iata.toLowerCase())}">View all ${esc(airline.name)} routes →</a></p>
</section>`.trim();

  // ── Aircraft card ─────────────────────────────────────────────────────────
  const aircraftSlug = slugify(aircraft.name);
  const aircraftSection = `
<section class="landing-airline-aircraft__aircraft">
  <h2>${esc(aircraft.name)}</h2>
  ${aircraft.category ? `<p>Category: ${esc(aircraft.category)}</p>` : ''}
  <p><a href="/aircraft/${esc(aircraftSlug)}">View ${esc(aircraft.name)} routes and specs →</a></p>
</section>`.trim();

  // ── FAQ ───────────────────────────────────────────────────────────────────
  // Compute top 5 departure and arrival airports by frequency.
  const depFreq = {};
  const arrFreq = {};
  for (const r of routes) {
    depFreq[r.dep.iata] = (depFreq[r.dep.iata] || 0) + 1;
    arrFreq[r.arr.iata] = (arrFreq[r.arr.iata] || 0) + 1;
  }
  const top5dep = Object.entries(depFreq).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k]) => k);
  const top5arr = Object.entries(arrFreq).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k]) => k);

  const faqQ1 = `How many routes does ${airline.name} fly on the ${aircraft.name}?`;
  const faqA1 = `${airline.name} operates ${summary.n_pairs} route${summary.n_pairs === 1 ? '' : 's'} on the ${aircraft.name} based on observations in the last 90 days.`;

  const longestRoute = summary.longest;
  const faqQ2 = `What is the longest route?`;
  const faqA2 = longestRoute
    ? `The longest route is ${longestRoute.dep}→${longestRoute.arr} at ${longestRoute.distance_km} km.`
    : `Route distance data is not available.`;

  const shortestRoute = summary.shortest;
  const faqQ3 = `What is the shortest route?`;
  const faqA3 = shortestRoute
    ? `The shortest route is ${shortestRoute.dep}→${shortestRoute.arr} at ${shortestRoute.distance_km} km.`
    : `Route distance data is not available.`;

  const faqQ4 = `Which airports does ${airline.name} use for the ${aircraft.name}?`;
  const faqA4Top5dep = top5dep.join(', ');
  const faqA4Top5arr = top5arr.join(', ');
  const faqA4 = `Top departure airports: ${faqA4Top5dep}. Top arrival airports: ${faqA4Top5arr}.`;

  const faqDetails = [
    [faqQ1, faqA1],
    [faqQ2, faqA2],
    [faqQ3, faqA3],
    [faqQ4, faqA4],
  ].map(([q, a]) => `
  <details>
    <summary>${esc(q)}</summary>
    <p>${esc(a)}</p>
  </details>`).join('');

  const faqSection = `
<section class="landing-airline-aircraft__faq">
  <h2>Frequently asked questions</h2>
  ${faqDetails}
</section>`.trim();

  // ── Internal links / breadcrumbs ──────────────────────────────────────────
  const crumbsSection = `
<section class="landing-airline-aircraft__crumbs">
  <nav aria-label="Breadcrumb">
    <ol>
      <li><a href="/">Home</a></li>
      <li><a href="/by-aircraft">Airlines</a></li>
      <li><a href="/airline/${esc(airline.iata.toLowerCase())}">${esc(airline.name)}</a></li>
      <li><a href="/by-aircraft">Aircraft</a></li>
      <li>${esc(aircraft.name)}</li>
    </ol>
  </nav>
</section>`.trim();

  // ── JSON-LD ───────────────────────────────────────────────────────────────
  const BASE_URL = 'https://himaxym.com';

  const breadcrumbList = {
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home',     item: `${BASE_URL}/` },
      { '@type': 'ListItem', position: 2, name: 'Airlines', item: `${BASE_URL}/by-aircraft` },
      { '@type': 'ListItem', position: 3, name: airline.name, item: `${BASE_URL}/airline/${airline.iata.toLowerCase()}` },
      { '@type': 'ListItem', position: 4, name: 'Aircraft', item: `${BASE_URL}/by-aircraft` },
      { '@type': 'ListItem', position: 5, name: aircraft.name, item: `${BASE_URL}/airline/${airline.iata.toLowerCase()}/aircraft/${icao.toLowerCase()}` },
    ],
  };

  const itemList = {
    '@type': 'ItemList',
    itemListElement: routes.map((r, i) => ({
      '@type':    'ListItem',
      position:   i + 1,
      name:       `${r.dep.iata}→${r.arr.iata}`,
      item: {
        '@type': 'Thing',
        name:    `${r.dep.iata}→${r.arr.iata}`,
        url:     `${BASE_URL}/search?from=${r.dep.iata}&to=${r.arr.iata}`,
      },
    })),
  };

  const faqPage = {
    '@type': 'FAQPage',
    mainEntity: [
      { '@type': 'Question', name: faqQ1, acceptedAnswer: { '@type': 'Answer', text: faqA1 } },
      { '@type': 'Question', name: faqQ2, acceptedAnswer: { '@type': 'Answer', text: faqA2 } },
      { '@type': 'Question', name: faqQ3, acceptedAnswer: { '@type': 'Answer', text: faqA3 } },
      { '@type': 'Question', name: faqQ4, acceptedAnswer: { '@type': 'Answer', text: faqA4 } },
    ],
  };

  // Escape </script> inside JSON-LD to prevent HTML parser from closing the
  // script block prematurely when airline/aircraft names contain injection text.
  const jsonLdRaw = JSON.stringify({
    '@context': 'https://schema.org',
    '@graph':   [breadcrumbList, itemList, faqPage],
  }).replace(/<\/script>/gi, '<\\/script>');
  const jsonLd = `<script type="application/ld+json">${jsonLdRaw}</script>`;

  return [heroSection, routesSection, mapSection, airlineSection, aircraftSection, faqSection, crumbsSection, jsonLd].join('\n');
}

const STATIC_BUILDERS = {
  pricing:       bPricing,
  about:         bAbout,
  map:           bMap,
  'by-aircraft': bByAircraft,
};

/**
 * @param {object} meta - resolved meta object from seoMetaService.resolve()
 * @param {object} [db] - optional db override for testing; defaults to ../models/db
 * @returns {string|null} HTML string, or null if kind is unknown or build failed
 */
function build(meta, db) {
  if (!meta || !meta.kind) return null;
  const dbInstance = db || require('../models/db');
  let innerHtml = null;
  const builder = STATIC_BUILDERS[meta.kind];
  if (builder) innerHtml = builder(meta);
  else if (meta.kind === 'route')              innerHtml = bRoute(meta, dbInstance);
  else if (meta.kind === 'aircraft')           innerHtml = bAircraft(meta, dbInstance);
  else if (meta.kind === 'aircraft-specs')     innerHtml = bAircraftSpecs(meta, dbInstance);
  else if (meta.kind === 'aircraft-airlines')  innerHtml = bAircraftAirlines(meta, dbInstance);
  else if (meta.kind === 'aircraft-routes')    innerHtml = bAircraftRoutes(meta, dbInstance);
  else if (meta.kind === 'aircraft-safety')    innerHtml = bAircraftSafety(meta, dbInstance);
  else if (meta.kind === 'aircraft-variant')   innerHtml = bAircraftVariant(meta, dbInstance);
  else if (meta.kind === 'aircraft-route')     innerHtml = bAircraftRoute(meta, dbInstance);
  else if (meta.kind === 'home')               innerHtml = bHome(meta, dbInstance);
  else if (meta.kind === 'safety-global')      innerHtml = bSafetyGlobal(meta, dbInstance);
  else if (meta.kind === 'safety-feed')        innerHtml = bSafetyFeed(meta, dbInstance);
  else if (meta.kind === 'safety-event')       innerHtml = bSafetyEvent(meta, dbInstance);
  else if (meta.kind === 'airline-aircraft')   innerHtml = bAirlineAircraft(meta, dbInstance);
  return applyChrome(meta, innerHtml, dbInstance);
}

/**
 * Async builder entry point. Use this for any kind that needs awaited data
 * (currently: airport, airline). Other kinds delegate to the sync `build()`
 * unchanged. Both paths end up wrapped by applyChrome.
 *
 * @param {object} meta - resolved meta object
 * @param {object} [db] - optional db override
 * @returns {Promise<string|null>}
 */
async function buildAsync(meta, db) {
  if (!meta || !meta.kind) return null;
  const dbInstance = db || require('../models/db');

  // Phase 1 SEO landing pages (jonty.db-backed). Builders return INNER HTML
  // (<main>...</main> only) with JSON-LD inline. The React shell + spaFallback's
  // seoMetaService.inject() supply <!doctype>, <html>, <head>, <title>,
  // <link rel=canonical>, <meta robots> from the resolver's full meta — these
  // builders therefore bypass applyChromeAsync but DO rely on inject() being
  // called downstream to produce a valid document.
  if (meta.kind === 'airport-departures') {
    return require('./airportLandingBuilder').buildDepartures(meta.iata);
  }
  if (meta.kind === 'airport-arrivals') {
    return require('./airportLandingBuilder').buildArrivals(meta.iata);
  }
  if (meta.kind === 'airline-airport') {
    return require('./airlineAirportBuilder').build(meta.airlineIata, meta.airportIata);
  }
  // Amadeus-backed kinds: builder returns inner HTML, applyChromeAsync wraps
  // with chrome + Amadeus-backed extras (direct dest / network dest sidebars).
  if (meta.kind === 'airport' || meta.kind === 'airline') {
    // Phase 1 coexistence: if kind='airline' and jonty.db has data for this
    // carrier_iata, render the new airlineNetworkBuilder (inner <main> HTML,
    // no chrome wrap — inject() owns the shell). Otherwise fall back to the
    // existing Amadeus-backed bAirline path which uses applyChromeAsync.
    if (meta.kind === 'airline' && meta.iata) {
      // Phase 1 coexistence: airlineNetworkBuilder.build() returns null when jonty
      // has no rows for this carrier — relying on that means one query, not two.
      try {
        const jontyHtml = require('./airlineNetworkBuilder').build(meta.iata);
        if (jontyHtml) return jontyHtml;
      } catch (err) {
        const msg = err && err.message ? err.message : String(err);
        // Operational failures that should silently fall back to bAirline:
        // 1. jonty.db missing on disk (deploy lag / first boot)
        // 2. SQLite schema drift (data lag) — "no such table" / "no such column"
        // 3. Generic SQLite errors from a momentarily-bad connection
        const isOperationalFailure = msg.includes('jonty.db not present')
          || msg.includes('no such table')
          || msg.includes('no such column')
          || /SQLITE_/i.test(msg);
        if (!isOperationalFailure) {
          if (process.env.NODE_ENV !== 'production') throw err;
          console.warn('[seo] airline jonty render failed for %s:', meta.iata, msg);
        }
        // jonty unavailable — fall through to bAirline
      }
    }
    const { applyChromeAsync } = require('./seoChrome');
    const innerHtml = meta.kind === 'airport'
      ? await bAirport(meta, dbInstance)
      : await bAirline(meta, dbInstance);
    return applyChromeAsync(meta, innerHtml, dbInstance);
  }
  // Accident narrative pages: bAccident is async (DB lookup) but doesn't need
  // the Amadeus-backed chrome extras, so wrap with the sync applyChrome.
  if (meta.kind === 'accident') {
    const innerHtml = await bAccident(meta.slug);
    return applyChrome(meta, innerHtml, dbInstance);
  }
  // All other kinds (route included — Amadeus route enrichment was deprecated
  // by Amadeus): sync builder already calls applyChrome inside build().
  return build(meta, dbInstance);
}

// ---------------------------------------------------------------------------
// bAccident — SEO page builder for /accidents/:slug
// ---------------------------------------------------------------------------
const _accidentSvc = require('./accidentNarrativeService');
// openFlightsService only exposes getAirlineByIcao — no name-based lookup.
// Operator → airline cross-link is skipped until a fuzzy-name helper exists.

function _esc(s) {
  if (s == null) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
                  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Free-text aircraft strings from accident sources include variant suffixes
// ("BOEING 737-800") that resolveFamily can't match. Strip the variant
// suffix to get the manufacturer + base model that aircraftFamilies indexes.
function normalizeForFamily(rawModel) {
  if (!rawModel || typeof rawModel !== 'string') return '';
  const tokens = rawModel.trim().split(/\s+/);
  if (tokens.length < 2) return rawModel.trim();
  const [mfr, modelToken] = tokens;
  // Strip variant suffix from the model token: '737-800' → '737', 'A321-271NX' → 'A321'
  const baseModel = modelToken.replace(/[-\s].*$/, '');
  return [mfr, baseModel].join(' ');
}

async function bAccident(slug) {
  const data = _accidentSvc.getBySlug(slug);
  if (!data) return null;
  if (data.indexable !== 1) return null;

  const f = data.facts;
  const regChunk = f.registration ? ` <span class="ad-reg">(${_esc(f.registration)})</span>` : '';
  const heroH1 = `${_esc(f.date)}: ${_esc(f.aircraft_model)}${regChunk} — ${_esc(f.operator || 'Unknown operator')}`;
  // Severity label: always show — "No fatalities" is meaningful (vs unknown).
  const fatalitiesNum = String(f.fatalities ?? '').split('+')
    .reduce((a, b) => a + (Number(b) || 0), 0);
  const sevLabel = fatalitiesNum > 0
    ? `${fatalitiesNum} ${fatalitiesNum === 1 ? 'fatality' : 'fatalities'}`
    : f.fatalities === '0' ? 'No fatalities' : 'Casualties unknown';
  const sevClass = fatalitiesNum > 0 ? 'fatal' : f.fatalities === '0' ? 'no-fatal' : 'unknown';
  const metaLine = [
    `<span class="ad-sev ad-sev--${sevClass}">${_esc(sevLabel)}</span>`,
    f.location ? _esc(f.location) : null,
    data.phase_of_flight ? _esc(data.phase_of_flight) : null,
  ].filter(Boolean).join(' • ');

  const probableHtml = data.probable_cause
    ? `<section class="ad-probable">
         <h2>Probable cause</h2>
         <blockquote>${_esc(data.probable_cause)}</blockquote>
         <p class="ad-attrib">— NTSB Determination</p>
       </section>`
    : '';

  const narrativeHtml = data.narrative_text
    ? `<section class="ad-narrative">
         <h2>Accident narrative</h2>
         <article>${data.narrative_text.split(/\r?\n\r?\n+/)
           .map(p => p.trim()).filter(Boolean)
           .map(p => `<p>${_esc(p)}</p>`).join('')}</article>
       </section>`
    : '';

  const factorsHtml = (data.factors && data.factors.length)
    ? `<section class="ad-factors">
         <h2>Contributing factors</h2>
         <ul>${data.factors.map(x => {
           // Service emits {label, role} objects; string fallback for safety.
           const label = typeof x === 'string' ? x : x.label;
           const role  = typeof x === 'string' ? null : x.role;
           const badge = role
             ? `<span class="ad-role ad-role--${role}">${role}</span> `
             : '';
           return `<li>${badge}<span class="ad-factor-label">${_esc(label)}</span></li>`;
         }).join('')}</ul>
       </section>`
    : '';

  const condsHtml = (data.phase_of_flight || data.weather_summary)
    ? `<section class="ad-conds">
         <h2>Conditions</h2>
         <dl>
           ${data.phase_of_flight ? `<dt>Phase</dt><dd>${_esc(data.phase_of_flight)}</dd>` : ''}
           ${data.weather_summary ? `<dt>Weather</dt><dd>${_esc(data.weather_summary)}</dd>` : ''}
         </dl>
       </section>`
    : '';

  const relA = (data.related && data.related.byAircraft || []).map(r =>
    `<li>${_esc(r.date)} — ${_esc(r.aircraft_model)} (${_esc(r.operator || '—')})</li>`
  ).join('');
  const relO = (data.related && data.related.byOperator || []).map(r =>
    `<li>${_esc(r.date)} — ${_esc(r.aircraft_model)} (${_esc(r.operator || '—')})</li>`
  ).join('');
  const relatedHtml = (relA || relO)
    ? `<section class="ad-related">
         <h2>Related events</h2>
         ${relA ? `<h3>Same aircraft</h3><ul>${relA}</ul>` : ''}
         ${relO ? `<h3>Same operator</h3><ul>${relO}</ul>` : ''}
       </section>`
    : '';

  const sourceLabel = data.source === 'ntsb' ? 'NTSB' : 'Wikidata contributors';
  const license     = data.source === 'ntsb' ? 'public domain (NTSB)' : 'CC0 (Wikidata)';

  // --- Internal-link cluster (SEO) ----------------------------------------
  // Similar accidents: same aircraft_model, different slug, indexable=1.
  const similarAccidents = _accidentSvc.listSimilarByAircraft(
    f.aircraft_model, slug, 5
  );

  // Aircraft cross-link: resolve free-text aircraft_model → family slug.
  // Free-text strings from accident sources include variant suffixes that
  // resolveFamily can't match; normalizeForFamily strips them first.
  const familyResult = resolveFamily(normalizeForFamily(f.aircraft_model));
  const aircraftSlug  = familyResult ? slugify(familyResult.name) : null;
  const aircraftLabel = familyResult ? familyResult.name : null;

  const similarItems = similarAccidents.map(r =>
    `<li><a href="/accidents/${_esc(r.slug)}">${_esc(r.date)}: ${_esc(r.aircraft_model)} — ${_esc(r.operator || 'unknown')}</a></li>`
  ).join('');

  const aircraftLinkItem = (aircraftSlug && aircraftLabel)
    ? `<li><a href="/aircraft/${_esc(aircraftSlug)}/safety">More ${_esc(aircraftLabel)} safety records</a></li>`
    : '';

  const relatedClusterHtml = (similarItems || aircraftLinkItem)
    ? `<section class="accident__related">
         <h2>Related</h2>
         <ul>
           ${similarItems}${aircraftLinkItem}
         </ul>
       </section>`
    : '';

  return `
<nav class="ad-crumbs"><a href="/">Home</a> → <a href="/safety/global">Safety</a> → Accident</nav>
<header class="ad-hero">
  <h1>${heroH1}</h1>
  <p class="ad-meta">${metaLine}</p>
</header>
${probableHtml}
${narrativeHtml}
${factorsHtml}
${condsHtml}
${relatedHtml}
${relatedClusterHtml}
<footer class="ad-attribution">
  <p>Investigation report by ${_esc(sourceLabel)}.
     Original record: <a href="${_esc(data.source_url)}" rel="external">${_esc(data.source_url)}</a>.
     This page is a structured re-presentation; facts and quotes are in the ${_esc(license)}.</p>
</footer>
`.trim();
}

module.exports = {
  build,
  buildAsync,
  bAccident,
  _renderFr24Stats,
};
