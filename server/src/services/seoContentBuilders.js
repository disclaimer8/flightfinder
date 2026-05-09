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
function build(meta, _db) {
  if (!meta || !meta.kind) return null;
  const builder = STATIC_BUILDERS[meta.kind];
  if (builder) return builder(meta);
  // Non-static kinds are added in subsequent tasks (route, aircraft, …).
  return null;
}

module.exports = { build };
