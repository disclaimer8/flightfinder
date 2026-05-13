'use strict';

/**
 * aircraftLandingEnrichment.js
 *
 * Loads the hand-curated aircraftLandingContent.json and exposes
 * rendering helpers consumed by bAircraft() in seoContentBuilders.js.
 *
 * HTML escaping rules:
 *   - All data from the JSON is escaped via esc() before being placed in
 *     HTML attributes or text nodes.
 *   - variantCallout.html is hand-curated trusted markup (paragraph/em/strong
 *     only) and is emitted verbatim — NOT escaped.
 *   - Incident slugs are validated to be safe URL path segments before use
 *     as href values.
 */

const path = require('path');

// xml-escape compatible with seoMetaService.esc / seoChrome.esc
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
);

// --------------------------------------------------------------------------
// JSON loading — cached at module init (process-lifetime singleton)
// --------------------------------------------------------------------------

let _cache = null;

function loadEnrichment() {
  if (_cache !== null) return _cache;
  try {
    const filePath = path.join(__dirname, '..', 'content', 'aircraftLandingContent.json');
    // require() is synchronous and Node caches the result; second call is free.
    _cache = require(filePath);
  } catch {
    _cache = {};
  }
  return _cache;
}

/**
 * Returns the enrichment object for a given slug, or null if not present.
 * @param {string} slug
 * @returns {object|null}
 */
function getEnrichmentForSlug(slug) {
  const data = loadEnrichment();
  return (slug && data[slug]) ? data[slug] : null;
}

// --------------------------------------------------------------------------
// HTML renderers
// --------------------------------------------------------------------------

/**
 * Renders a <table> of variant rows.
 * @param {Array} variants
 * @returns {string} HTML section
 */
function renderVariantsTable(variants) {
  if (!Array.isArray(variants) || variants.length === 0) return '';
  const rows = variants.map((v) => `
    <tr>
      <td>${esc(v.name)}</td>
      <td>${esc(v.firstFlight)}</td>
      <td>${esc(v.seats)}</td>
      <td>${esc(v.range_nm)}</td>
      <td>${esc(v.status)}</td>
    </tr>`).join('');
  return `
<section class="aircraft-variants">
  <h2>Variants and specifications</h2>
  <table class="variants-table">
    <thead>
      <tr>
        <th>Variant</th>
        <th>First flight</th>
        <th>Typical seats</th>
        <th>Range (nm)</th>
        <th>Status</th>
      </tr>
    </thead>
    <tbody>${rows}
    </tbody>
  </table>
</section>`.trim();
}

/**
 * Validates that a slug string is a safe URL path segment.
 * Allows lowercase letters, digits, and hyphens only.
 * @param {string|null} slug
 * @returns {string|null}
 */
function _safeLinkSlug(slug) {
  if (!slug || typeof slug !== 'string') return null;
  return /^[a-z0-9-]+$/.test(slug) ? slug : null;
}

/**
 * Renders a list of notable accident entries.
 * @param {Array} items
 * @returns {string} HTML section
 */
function renderNotableIncidents(items) {
  if (!Array.isArray(items) || items.length === 0) return '';
  const listItems = items.map((item) => {
    const safeSlug = _safeLinkSlug(item.slug);
    const flightLabel = safeSlug
      ? `<a href="/accidents/${safeSlug}">${esc(item.flight)}</a>`
      : `<span>${esc(item.flight)}</span>`;
    const fatalitiesText = item.fatalities === 0
      ? 'no fatalities'
      : `${esc(item.fatalities)} ${item.fatalities === 1 ? 'fatality' : 'fatalities'}`;
    return `
    <li class="incident-item">
      <div class="incident-header">
        <time datetime="${esc(item.date)}">${esc(item.date)}</time>
        ${flightLabel}
        <span class="incident-operator">${esc(item.operator)}</span>
        <span class="incident-variant">${esc(item.variant)}</span>
        <span class="incident-fatalities">${fatalitiesText}</span>
      </div>
      <p class="incident-summary">${esc(item.summary)}</p>
    </li>`;
  }).join('');
  return `
<section class="notable-incidents">
  <h2>Notable accidents and incidents</h2>
  <ul class="incidents-list">${listItems}
  </ul>
</section>`.trim();
}

/**
 * Renders the variant callout panel. The callout.html field is trusted
 * hand-curated markup and is emitted verbatim.
 * @param {object} callout - { title: string, html: string }
 * @returns {string} HTML section
 */
function renderVariantCallout(callout) {
  if (!callout || !callout.title || !callout.html) return '';
  return `
<section class="variant-callout">
  <h2>${esc(callout.title)}</h2>
  <div class="callout-body">${callout.html}</div>
</section>`.trim();
}

/**
 * Renders an enhanced FAQ section from the enrichment data.
 * @param {Array} faq - array of { q, a } objects
 * @returns {string} HTML section
 */
function renderEnhancedFAQ(faq) {
  if (!Array.isArray(faq) || faq.length === 0) return '';
  const items = faq.map((item) => `
    <dt>${esc(item.q)}</dt>
    <dd>${esc(item.a)}</dd>`).join('');
  return `
<section class="enhanced-faq">
  <h2>Frequently asked questions</h2>
  <dl class="faq-list">${items}
  </dl>
</section>`.trim();
}

/**
 * Builds a JSON-LD ItemList object for the variants of an aircraft family.
 * Each item uses Product type with name, additionalType, and description.
 * @param {Array} variants
 * @param {string} slug - family slug, used in description context
 * @returns {object} JSON-LD compatible object
 */
function buildVariantsItemListLD(variants, slug) {
  if (!Array.isArray(variants) || variants.length === 0) return null;
  return {
    '@type': 'ItemList',
    name: `${slug} variants`,
    numberOfItems: variants.length,
    itemListElement: variants.map((v, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      item: {
        '@type': 'Product',
        name: v.name,
        additionalType: 'AircraftModel',
        description: `${v.name}: first flight ${v.firstFlight}, ${v.seats} seats, range ${v.range_nm} nm, status ${v.status}.`,
      },
    })),
  };
}

/**
 * Builds a FAQPage JSON-LD object from the enrichment FAQ array.
 * @param {Array} faq
 * @returns {object} JSON-LD compatible object
 */
function buildFAQPageLD(faq) {
  if (!Array.isArray(faq) || faq.length === 0) return null;
  return {
    '@type': 'FAQPage',
    mainEntity: faq.map((qa) => ({
      '@type': 'Question',
      name: qa.q,
      acceptedAnswer: { '@type': 'Answer', text: qa.a },
    })),
  };
}

module.exports = {
  loadEnrichment,
  getEnrichmentForSlug,
  renderVariantsTable,
  renderNotableIncidents,
  renderVariantCallout,
  renderEnhancedFAQ,
  buildVariantsItemListLD,
  buildFAQPageLD,
  // Exported for testing
  _esc: esc,
};
