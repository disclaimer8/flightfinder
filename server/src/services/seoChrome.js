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

function _renderBreadcrumbs(_meta) { return ''; }
function _renderFooter(_db) { return ''; }
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
    esc,
  },
};
