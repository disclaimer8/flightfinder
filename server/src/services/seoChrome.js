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

function _crossRefsForVariant(meta) {
  if (!meta.variant?.familySlug) return '';
  const { getVariantsByFamilySlug } = require('../models/aircraftVariants');
  const siblings = getVariantsByFamilySlug(meta.variant.familySlug)
    .filter((v) => v.icao !== meta.variant.icao);
  if (siblings.length === 0) return '';
  const items = siblings
    .map((v) => `<li><a href="/aircraft/${esc(v.familySlug)}/variants/${esc(v.slug)}">${esc(v.shortName)}</a></li>`)
    .join('');
  return `<aside class="cross-refs"><h3>Other variants in this family</h3><ul>${items}</ul></aside>`;
}

function _crossRefsForFamily(meta) {
  if (!meta.family?.manufacturer) return '';
  const all = getFamilyList();
  const siblings = all
    .filter((f) => f.manufacturer === meta.family.manufacturer && f.slug !== meta.slug)
    .slice(0, 5);
  if (siblings.length === 0) return '';
  const items = siblings
    .map((f) => `<li><a href="/aircraft/${esc(f.slug)}">${esc(f.label)}</a></li>`)
    .join('');
  return `<aside class="cross-refs"><h3>Other ${esc(meta.family.manufacturer)} families</h3><ul>${items}</ul></aside>`;
}

function _crossRefsForAircraftSubpage(meta) {
  const slug = meta.slug;
  if (!slug) return '';
  const label = meta.aircraftLabel || slug;
  const subpages = [
    ['', 'Overview'],
    ['/airlines', 'Operators'],
    ['/routes', 'Top routes'],
    ['/safety', 'Safety record'],
    ['/specs', 'Full specs'],
  ];
  const currentSuffix = {
    'aircraft-airlines': '/airlines',
    'aircraft-routes': '/routes',
    'aircraft-safety': '/safety',
    'aircraft-specs': '/specs',
  }[meta.kind];
  const items = subpages
    .filter(([suffix]) => suffix !== currentSuffix)
    .map(([suffix, lbl]) => `<li><a href="/aircraft/${esc(slug)}${suffix}">${esc(lbl)}</a></li>`)
    .join('');
  return `<aside class="cross-refs"><h3>More about ${esc(label)}</h3><ul>${items}</ul></aside>`;
}

function _crossRefsForRoute(meta, db) {
  const orig = meta.fromIata;
  const dest = meta.toIata;
  if (!orig || !dest) return '';

  const fromRoutes = _safeChrome(() => db.getTopRoutesFromAirport(orig, 6), [])
    .filter((r) => !(r.from === orig && r.to === dest))
    .slice(0, 5);
  const toRoutes = _safeChrome(() => db.getTopRoutesToAirport(dest, 6), [])
    .filter((r) => !(r.from === orig && r.to === dest))
    .slice(0, 5);

  const blocks = [];
  if (fromRoutes.length > 0) {
    const items = fromRoutes
      .map((r) => `<li><a href="/routes/${esc(r.from.toLowerCase())}-${esc(r.to.toLowerCase())}">${esc(r.from)}–${esc(r.to)}</a></li>`)
      .join('');
    blocks.push(`<h3>Other routes from ${esc(orig)}</h3><ul>${items}</ul>`);
  }
  if (toRoutes.length > 0) {
    const items = toRoutes
      .map((r) => `<li><a href="/routes/${esc(r.from.toLowerCase())}-${esc(r.to.toLowerCase())}">${esc(r.from)}–${esc(r.to)}</a></li>`)
      .join('');
    blocks.push(`<h3>Other routes to ${esc(dest)}</h3><ul>${items}</ul>`);
  }
  if (blocks.length === 0) return '';
  return `<aside class="cross-refs">${blocks.join('')}</aside>`;
}

function _crossRefsForAircraftRoute(meta) {
  const orig = meta.fromIata;
  const dest = meta.toIata;
  const slug = meta.slug;
  const label = meta.aircraftLabel || slug;
  if (!orig || !dest || !slug) return '';
  return `<aside class="cross-refs">
    <h3>Related pages</h3>
    <ul>
      <li><a href="/routes/${esc(orig.toLowerCase())}-${esc(dest.toLowerCase())}">All flights ${esc(orig)}–${esc(dest)}</a></li>
      <li><a href="/aircraft/${esc(slug)}">${esc(label)} overview</a></li>
    </ul>
  </aside>`;
}

function _renderCrossRefs(meta, db) {
  if (!meta || !meta.kind) return '';
  switch (meta.kind) {
    case 'aircraft':         return _crossRefsForFamily(meta);
    case 'aircraft-variant': return _crossRefsForVariant(meta);
    case 'aircraft-airlines':
    case 'aircraft-routes':
    case 'aircraft-safety':
    case 'aircraft-specs':   return _crossRefsForAircraftSubpage(meta);
    case 'route':            return _crossRefsForRoute(meta, db);
    case 'aircraft-route':   return _crossRefsForAircraftRoute(meta);
    // safety-* in next task
    default: return '';
  }
}

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
