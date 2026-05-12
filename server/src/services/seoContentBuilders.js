const { getFamilyList, getFamilyByCode, slugify } = require('../models/aircraftFamilies');
const { esc } = require('./seoMetaService');
const { applyChrome } = require('./seoChrome');

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

// /routes/:pair/:slug — narrow combo page (e.g. /routes/lhr-jfk/boeing-787).
// Before this builder existed, build() returned null for kind 'aircraft-route'
// → applyChrome returned null → spaFallback served the React shell with no
// bake section. Google flagged 200+ such URLs as Soft 404. This builder
// always returns some content (real observed data when available, an explain
// + cross-links fallback when not), so chrome wraps every page with nav,
// breadcrumbs, footer, and cross-refs — enough to escape Soft 404.
function bAircraftRoute(meta, db) {
  if (!meta || !meta.fromIata || !meta.toIata || !meta.slug) return null;
  const { fromIata, toIata, fromName, toName, aircraftLabel, slug } = meta;

  const { getFamilyBySlug } = require('../models/aircraftFamilies');
  const fam = getFamilyBySlug(slug);
  const icaoList = (fam && fam.icaoList) || [];

  let observed = [];
  try { observed = db.getObservedAircraftOnRoute(fromIata, toIata, icaoList); } catch {}

  const label = aircraftLabel || slug;
  const intro = `<p>Recent <strong>${esc(label)}</strong> activity between <strong>${esc(fromName || fromIata)}</strong> (${esc(fromIata)}) and <strong>${esc(toName || toIata)}</strong> (${esc(toIata)}), drawn from open ADS-B observations in our 14-day rolling window.</p>`;

  const routeHref = `/routes/${esc(fromIata.toLowerCase())}-${esc(toIata.toLowerCase())}`;
  const aircraftHref = `/aircraft/${esc(slug)}`;

  let detail;
  if (observed.length > 0) {
    const variants = observed
      .map((o) => `${esc(o.aircraft_icao)}${o.airline_iata ? ` (operator: ${esc(o.airline_iata)})` : ''}`)
      .join('; ');
    detail = `<p>Observed variants on this route: ${variants}.</p>
      <p>This page is auto-generated for every qualifying ADS-B-observed route × aircraft combination. See the parent <a href="${routeHref}">${esc(fromIata)}–${esc(toIata)} route page</a> for the full operator list, and the <a href="${aircraftHref}">${esc(label)} family page</a> for general specifications, safety record, and worldwide deployment data.</p>`;
  } else {
    detail = `<p>No recent observations of the ${esc(label)} on this exact route in our 14-day rolling ADS-B window. The route may be operated by other aircraft types — see the <a href="${routeHref}">${esc(fromIata)}–${esc(toIata)} route page</a> for current operators, or the <a href="${aircraftHref}">${esc(label)} family page</a> for general fleet info.</p>`;
  }

  return [intro, detail].join('\n');
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
    <p>Worldwide aviation accident dataset aggregated from the Aviation Safety Network, the Bureau of Aircraft Accidents Archives (B3A), and Wikidata. Approximately 5 200 records since 1980 with aircraft type, operator, location, fatalities and source URL where known.</p>
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

  const heading = `<h1>${esc(iata)} — destinations and fleet</h1>`;

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

  const jsonLd = `<script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Airline',
    name: `${iata} Airline`,
    iataCode: iata,
  })}</script>`;

  return [heading, destBlock, jsonLd].filter(Boolean).join('\n');
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

  // Amadeus-backed kinds: builder returns inner HTML, applyChromeAsync wraps
  // with chrome + Amadeus-backed extras (direct dest / network dest sidebars).
  if (meta.kind === 'airport' || meta.kind === 'airline') {
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

function _esc(s) {
  if (s == null) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
                  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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
