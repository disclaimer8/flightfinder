const { getFamilyList } = require('../models/aircraftFamilies');
const { esc } = require('./seoMetaService');

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

function _renderYearlyBreakdown(yearlyBreakdown) {
  if (!Array.isArray(yearlyBreakdown) || yearlyBreakdown.length === 0) return '';
  const items = yearlyBreakdown
    .map((y) => `<li>${esc(y.year)}: ${esc(_formatNumber(y.count))} flights</li>`)
    .join('');
  return `<h4>5-year trend</h4><ul class="yearly-breakdown">${items}</ul>`;
}

function _renderFr24Stats(stats, opts = {}) {
  if (!stats || !stats.totalFlights) return '';
  const date = new Date(stats.fetchedAt).toISOString().slice(0, 10);
  const isRoute = opts.context === 'route';

  const heading = isRoute
    ? '<h3>Worldwide activity on this route (last 12 months)</h3>'
    : '<h3>Worldwide activity (last 12 months)</h3>';

  const totalLine = isRoute
    ? `<p>Flown <strong>${esc(_formatNumber(stats.totalFlights))}</strong> times by ${esc(stats.uniqueOperators)} airlines in the past year.</p>`
    : `<p>Operated <strong>${esc(_formatNumber(stats.totalFlights))}</strong> times globally by ${esc(stats.uniqueOperators)} airlines.</p>`;

  const operatorsLine = (stats.topOperators && stats.topOperators.length > 0)
    ? `<p>Top operators: ${stats.topOperators.map((o) => `${esc(o.icao)} (${esc(_formatNumber(o.count))})`).join(', ')}</p>`
    : '';

  const routesLine = (!isRoute && stats.topRoutes && stats.topRoutes.length > 0)
    ? `<p>Top routes: ${stats.topRoutes.map((r) => `${esc(r.from)}–${esc(r.to)} (${esc(_formatNumber(r.count))})`).join(', ')}</p>`
    : '';

  const yearly = _renderYearlyBreakdown(stats.yearlyBreakdown);
  const sourceLine = `<p class="data-source">Data via Flightradar24, as of ${esc(date)}.</p>`;

  return [heading, totalLine, operatorsLine, routesLine, yearly, sourceLine]
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

function bRoute(meta, db) {
  const fr24Block = _renderFr24Stats(meta.fr24Stats, { context: 'route' });

  // If we lack route IATA codes, fall back to FR24-only rendering (or null if neither).
  if (!meta.fromIata || !meta.toIata) return fr24Block || null;
  const facts = db.getRouteFacts(meta.fromIata, meta.toIata);
  if (facts.airlineCount === 0 && facts.aircraftCount === 0) return fr24Block || null;

  const fromLabel = meta.fromName || meta.fromIata;
  const toLabel   = meta.toName   || meta.toIata;
  const aircraftLabel = facts.topAircraft.length
    ? `Most common aircraft: ${facts.topAircraft.map(esc).join(', ')}.`
    : '';
  const airlineLabel = facts.topAirlines.length
    ? `Top operators: ${facts.topAirlines.map(esc).join(', ')}.`
    : '';
  const factsBlock = `
    <p>${esc(facts.airlineCount)} airline${facts.airlineCount === 1 ? '' : 's'} operate${facts.airlineCount === 1 ? 's' : ''} the ${esc(fromLabel)} (${esc(meta.fromIata)}) to ${esc(toLabel)} (${esc(meta.toIata)}) route across ${esc(facts.aircraftCount)} aircraft type${facts.aircraftCount === 1 ? '' : 's'} in our dataset.</p>
    <p>${aircraftLabel} ${airlineLabel}</p>
  `.trim();
  return [factsBlock, fr24Block].filter(Boolean).join('\n').trim();
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

  const factsBlock = haveFacts ? `
    <p>The ${esc(label)} is operated by ${esc(facts.airlineCount)} airline${facts.airlineCount === 1 ? '' : 's'} across ${esc(facts.routeCount)} city pair${facts.routeCount === 1 ? '' : 's'} in our observed-flights dataset (last 14 days).</p>
    ${routeLabels ? `<p>Top routes: ${routeLabels}.</p>` : ''}
  `.trim() : '';

  const safetyBlock = _renderSafetyBand(meta) + _renderTopEvents(meta.topEvents);
  const variantsBlock = _renderVariantsList(meta.variants);
  const fr24Block = _renderFr24Stats(meta.fr24Stats, { context: 'aircraft' });

  return [factsBlock, safetyBlock, variantsBlock, fr24Block].filter(Boolean).join('\n').trim();
}

function bAircraftAirlines(meta, db) {
  if (!Array.isArray(meta.icaoList) || meta.icaoList.length === 0) return null;
  const ops = db.getAircraftOperators(meta.icaoList, 20);
  if (ops.length === 0) return null;
  const items = ops
    .map((o) => `<li>${esc(o.airline)} — ${esc(o.count)} observed flight${o.count === 1 ? '' : 's'}</li>`)
    .join('');
  const label = meta.aircraftLabel || meta.slug || 'this aircraft';
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
  const families   = getFamilyList().length;
  return `
    <p>Search ${esc(routeCount)} observed routes worldwide, filtered by aircraft type. Pick a Boeing 737, Airbus A320, turboprop, or wide-body jet — see only flights operating that equipment.</p>
    <p>${esc(families)} aircraft families have dedicated landing pages with operator lists, top routes, safety records, and full specifications.</p>
  `.trim();
}

function bSafetyGlobal(_meta, _db) {
  return `
    <p>Worldwide aviation accident dataset aggregated from the Aviation Safety Network, the Bureau of Aircraft Accidents Archives (B3A), and Wikidata. Approximately 5 200 records since 1980 with aircraft type, operator, location, fatalities and source URL where known.</p>
    <p>Updated weekly. Free for non-commercial use; cite Aviation Safety Network and B3A when redistributing.</p>
  `.trim();
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
  const builder = STATIC_BUILDERS[meta.kind];
  if (builder) return builder(meta);
  if (meta.kind === 'route')              return bRoute(meta, dbInstance);
  if (meta.kind === 'aircraft')           return bAircraft(meta, dbInstance);
  if (meta.kind === 'aircraft-specs')     return bAircraftSpecs(meta, dbInstance);
  if (meta.kind === 'aircraft-airlines')  return bAircraftAirlines(meta, dbInstance);
  if (meta.kind === 'aircraft-routes')    return bAircraftRoutes(meta, dbInstance);
  if (meta.kind === 'aircraft-safety')    return bAircraftSafety(meta, dbInstance);
  if (meta.kind === 'aircraft-variant')   return bAircraftVariant(meta, dbInstance);
  if (meta.kind === 'home')               return bHome(meta, dbInstance);
  if (meta.kind === 'safety-global')      return bSafetyGlobal(meta, dbInstance);
  if (meta.kind === 'safety-feed')        return bSafetyFeed(meta, dbInstance);
  return null;
}

module.exports = {
  build,
  _renderFr24Stats,
  _renderYearlyBreakdown,
};
