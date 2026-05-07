// Google Analytics 4 init + SPA pageview tracking. The default
// gtag('config', ...) only fires on initial load — single-page-app
// route changes (pushState/replaceState/popstate) need explicit
// page_view events so GA sees /search, /map, /aircraft/:slug etc.
window.dataLayer = window.dataLayer || [];
function gtag() { dataLayer.push(arguments); }
gtag('js', new Date());

// `send_page_view: false` disables the auto pageview from gtag('config'),
// so we own the timing. We fire one immediately for the initial load,
// then again on every history change.
gtag('config', 'G-ZW8Y3YLN7S', { send_page_view: false });

function sendPageview() {
  gtag('event', 'page_view', {
    page_path: location.pathname + location.search,
    page_location: location.href,
    page_title: document.title,
  });
}

// Initial pageview after gtag is wired
sendPageview();

// Patch pushState + replaceState so React Router's history-driven
// navigations are visible to GA. The patch keeps the original semantics
// (returns the result, preserves the call signature) and dispatches a
// custom event that we listen to below.
['pushState', 'replaceState'].forEach((m) => {
  const original = history[m];
  history[m] = function (...args) {
    const result = original.apply(this, args);
    window.dispatchEvent(new Event('locationchange'));
    return result;
  };
});

// popstate fires for back/forward; locationchange (custom) fires for
// programmatic navigations after the patch above.
window.addEventListener('popstate', sendPageview);
window.addEventListener('locationchange', sendPageview);
