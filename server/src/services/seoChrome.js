// server/src/services/seoChrome.js
//
// Wraps every baked SEO page with site-wide chrome (nav, breadcrumbs,
// footer) plus per-kind cross-references. Invoked from
// seoContentBuilders.build(meta, db) so individual b* builders stay
// focused on inner content.
//
// Hidden from JS users via `section[data-seo-bake="true"]{display:none}`
// in client/index.html — Googlebot still sees the chrome in HTML, users
// see no flash.

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
);

const { getFamilyList } = require('../models/aircraftFamilies');

const FOOTER_CACHE_TTL_MS = 60_000;
let _footerCache = null;
let _footerCachedAt = 0;

function _invalidateFooterCache() {
  _footerCache = null;
  _footerCachedAt = 0;
}

// ── Site nav (static const) ─────────────────────────────────────────────

const SITE_NAV_HTML = `<nav class="seo-nav" aria-label="Site navigation">
  <a href="/">FlightFinder</a>
  <a href="/by-aircraft">Aircraft</a>
  <a href="/map">Map</a>
  <a href="/safety/global">Safety</a>
  <a href="/about">About</a>
  <a href="/pricing">Pricing</a>
</nav>`;

function _renderSiteNav() {
  return SITE_NAV_HTML;
}

// ── Safe wrapper ────────────────────────────────────────────────────────

function _safeChrome(fn, fallback = '') {
  try { return fn(); }
  catch (err) {
    console.warn(`[seoChrome] helper failed: ${err.message || err}`);
    return fallback;
  }
}

// ── Stubs (implemented in later tasks) ──────────────────────────────────

function _renderBreadcrumbs(meta) {
  if (!meta || !meta.kind) return '';
  if (meta.kind === 'home' || meta.kind === 'not-found') return '';

  const crumbs = [['/', 'Home']];

  switch (meta.kind) {
    case 'aircraft':
      crumbs.push(['/by-aircraft', 'Aircraft']);
      crumbs.push([null, meta.aircraftLabel || meta.slug]);
      break;
    case 'aircraft-variant':
      crumbs.push(['/by-aircraft', 'Aircraft']);
      if (meta.family) crumbs.push([`/aircraft/${meta.family.slug || meta.variant?.familySlug}`, meta.family.name || meta.family.label]);
      crumbs.push([null, meta.variant?.shortName || meta.variant?.slug]);
      break;
    case 'aircraft-airlines':
    case 'aircraft-routes':
    case 'aircraft-safety':
    case 'aircraft-specs': {
      const labels = {
        'aircraft-airlines': 'Operators',
        'aircraft-routes': 'Top routes',
        'aircraft-safety': 'Safety',
        'aircraft-specs': 'Specs',
      };
      crumbs.push(['/by-aircraft', 'Aircraft']);
      crumbs.push([`/aircraft/${meta.slug}`, meta.aircraftLabel || meta.slug]);
      crumbs.push([null, labels[meta.kind]]);
      break;
    }
    case 'route':
      crumbs.push([null, 'Routes']);
      crumbs.push([null, `${meta.fromIata}–${meta.toIata}`]);
      break;
    case 'aircraft-route':
      crumbs.push([null, 'Routes']);
      crumbs.push([`/routes/${(meta.fromIata || '').toLowerCase()}-${(meta.toIata || '').toLowerCase()}`, `${meta.fromIata}–${meta.toIata}`]);
      crumbs.push([null, meta.aircraftLabel || meta.slug]);
      break;
    case 'safety-feed':
      crumbs.push(['/safety/global', 'Safety']);
      crumbs.push([null, 'Recent events']);
      break;
    case 'safety-global':
      crumbs.push([null, 'Safety']);
      break;
    case 'by-aircraft':
      crumbs.push([null, 'Browse by aircraft']);
      break;
    case 'map':
      crumbs.push([null, 'Map']);
      break;
    case 'about':
      crumbs.push([null, 'About']);
      break;
    case 'pricing':
      crumbs.push([null, 'Pricing']);
      break;
    case 'legal':
      crumbs.push([null, meta.legalLabel || 'Legal']);
      break;
    default:
      crumbs.push([null, meta.kind]);
  }

  const items = crumbs.map(([href, label], i) => {
    const escLabel = esc(label || '');
    if (!escLabel) return '';
    if (href && i < crumbs.length - 1) return `<a href="${esc(href)}">${escLabel}</a>`;
    return `<span>${escLabel}</span>`;
  }).filter(Boolean).join(' › ');

  return `<nav class="breadcrumbs" aria-label="Breadcrumb">${items}</nav>`;
}

function _renderFooter(db) {
  if (_footerCache && (Date.now() - _footerCachedAt) < FOOTER_CACHE_TTL_MS) {
    return _footerCache;
  }

  const families = _safeChrome(() => getFamilyList(), []);
  const familiesList = families
    .map((f) => `<li><a href="/aircraft/${esc(f.slug)}">${esc(f.label)}</a></li>`)
    .join('');

  const routes = _safeChrome(() => db.getTopRoutesByObservedFrequency(30), []);
  const routesList = routes
    .map((r) => `<li><a href="/routes/${esc(r.from.toLowerCase())}-${esc(r.to.toLowerCase())}">${esc(r.from)}–${esc(r.to)}</a></li>`)
    .join('');

  const html = `<footer class="seo-footer">
    <div class="footer-section">
      <h4>Aircraft families</h4>
      <ul>${familiesList}</ul>
    </div>
    <div class="footer-section">
      <h4>Popular routes</h4>
      <ul>${routesList}</ul>
    </div>
    <div class="footer-section">
      <h4>Safety</h4>
      <ul>
        <li><a href="/safety/global">Global overview</a></li>
        <li><a href="/safety/feed">Recent events</a></li>
      </ul>
    </div>
    <div class="footer-section">
      <h4>About</h4>
      <ul>
        <li><a href="/about">About FlightFinder</a></li>
        <li><a href="/pricing">Pricing</a></li>
      </ul>
    </div>
  </footer>`;

  _footerCache = html;
  _footerCachedAt = Date.now();
  return html;
}

function _renderCrossRefs(_meta, _db) { return ''; }

// ── Public ──────────────────────────────────────────────────────────────

function applyChrome(meta, innerHtml, db) {
  if (!innerHtml) return null;
  if (!meta) return innerHtml;

  return [
    SITE_NAV_HTML,
    _safeChrome(() => _renderBreadcrumbs(meta)),
    innerHtml,
    _safeChrome(() => _renderCrossRefs(meta, db)),
    _safeChrome(() => _renderFooter(db)),
  ].filter(Boolean).join('\n');
}

module.exports = {
  applyChrome,
  _internal: {
    _renderSiteNav,
    _renderBreadcrumbs,
    _renderFooter,
    _renderCrossRefs,
    _safeChrome,
    _invalidateFooterCache,
    esc,
  },
};
