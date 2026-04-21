/**
 * Server-side per-route SEO metadata.
 *
 * The React client is a SPA — Googlebot renders JS, but Bing, Yandex,
 * LinkedIn, Slack, Telegram, and several AI answer engines do not. So
 * before handing back index.html to any route (other than /api/*), we
 * compute the correct <title>, <meta name="description">, canonical,
 * og:* tags, and an inline H1/hero fallback, and inject them into the
 * HTML. Bots see a page that actually describes /aircraft/boeing-737
 * instead of a generic landing screen.
 *
 * Known paths:
 *   /                               — home
 *   /by-aircraft                    — by-aircraft tool
 *   /map                            — interactive route map
 *   /aircraft/:slug                 — aircraft family landing
 *   /routes/:from-:to               — city-pair landing (IATA, lowercase)
 *
 * Unknown paths fall back to the home metadata (this also covers verify
 * links, which the fallback additionally marks as noindex via a separate
 * layer in server/src/index.js).
 */
const { getFamilyBySlug, getFamilyList } = require('../models/aircraftFamilies');
const openFlightsService = require('./openFlightsService');
const { AIRCRAFT_FAQ, ROUTE_FAQ, interpolate } = require('../content/landingFaq');

const BASE = 'https://himaxym.com';
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c])
);

// Default home metadata — matches client/index.html defaults. If those
// change, keep these in sync (they're injected as overrides).
const HOME = {
  title: 'FlightFinder — Search Flights by Aircraft Type | Boeing, Airbus & More',
  description: 'Search flights worldwide filtered by aircraft type. Find routes operated by Boeing 737, Airbus A320, turboprops, wide-body jets and more. The only flight search built around the plane, not just the price.',
  canonical: `${BASE}/`,
  h1: 'Find flights by aircraft type',
  subtitle: 'Search routes worldwide, filtered by aircraft model — Boeing 737, Airbus A320, turboprops, wide-body jets and more.',
  ogType: 'website',
  kind: 'home',
};

const BY_AIRCRAFT = {
  title: 'Search Flights by Aircraft Type — FlightFinder',
  description: 'Pick an aircraft model (Boeing 787, Airbus A350, A380, Boeing 737 MAX and more) and see every route that plane flies worldwide — then book the one you want.',
  canonical: `${BASE}/by-aircraft`,
  h1: 'Search flights by aircraft',
  subtitle: 'Pick an aircraft model — Boeing 787, Airbus A350, A380, A320, Boeing 737 and more — and we show you every route it flies worldwide.',
  ogType: 'website',
  kind: 'by-aircraft',
};

const MAP = {
  title: 'Interactive Flight Route Map — FlightFinder',
  description: 'Explore global flight routes on an interactive map. Click any airport to see its destinations, or draw a radius to find every airport within 100 km.',
  canonical: `${BASE}/map`,
  h1: 'Global flight route map',
  subtitle: 'Click any airport to see where you can fly from there, or draw a radius to find every airport within a region.',
  ogType: 'website',
  kind: 'map',
};

// Slugs we know about — any /aircraft/:other falls through to 404-style
// metadata (noindex, home canonical) so we don't let garbage URLs into
// the index via open-ended routing.
const KNOWN_SLUGS = new Set(getFamilyList().map((f) => f.slug));

/** /aircraft/:slug */
function aircraftMeta(slug) {
  if (!KNOWN_SLUGS.has(slug)) return notFoundMeta();
  const fam = getFamilyBySlug(slug);
  const label = fam?.family?.label || fam?.name || slug;
  const manufacturer = fam?.family?.manufacturer || '';
  return {
    title: `${label} flights and routes — which airlines fly it, where, and when | FlightFinder`,
    description: `Find every route operated by the ${label}. See which airlines fly the ${manufacturer} ${fam?.name || ''} fleet, on what city pairs, and book the next available flight.`,
    canonical: `${BASE}/aircraft/${slug}`,
    h1: `${label} — flights, routes and airlines`,
    subtitle: `Every city pair operated by the ${label} worldwide. Pick a route to book the next available flight on this aircraft.`,
    robots: 'index, follow',
    ogType: 'article',
    kind: 'aircraft',
    slug,
    aircraftLabel: label,
    aircraftManufacturer: manufacturer,
  };
}

/** /routes/:from-:to   (e.g. lhr-jfk) */
function routeMeta(pair) {
  const m = /^([a-z]{3})-([a-z]{3})$/.exec(pair || '');
  if (!m) return notFoundMeta();
  const fromIata = m[1].toUpperCase();
  const toIata   = m[2].toUpperCase();
  const fromAp   = openFlightsService.getAirport(fromIata);
  const toAp     = openFlightsService.getAirport(toIata);
  const fromName = fromAp?.city || fromAp?.name || fromIata;
  const toName   = toAp?.city   || toAp?.name   || toIata;
  return {
    title: `${fromName} to ${toName} flights (${fromIata} → ${toIata}) — airlines, aircraft, cheapest dates | FlightFinder`,
    description: `Compare flights from ${fromName} (${fromIata}) to ${toName} (${toIata}): which airlines operate the route, which aircraft types they fly, and the cheapest upcoming dates.`,
    canonical: `${BASE}/routes/${pair}`,
    h1: `${fromName} to ${toName} flights`,
    subtitle: `Direct and connecting flights from ${fromName} (${fromIata}) to ${toName} (${toIata}). Compare airlines, aircraft, and fares.`,
    robots: 'index, follow',
    ogType: 'article',
    kind: 'route',
    pair,
    fromIata,
    toIata,
    fromName,
    toName,
  };
}

function notFoundMeta() {
  return {
    ...HOME,
    robots: 'noindex, follow',
    kind: 'not-found',
  };
}

/**
 * Resolve metadata for a given request path.
 * @param {string} pathname — URL pathname (no query)
 * @returns {{title,description,canonical,h1,subtitle,robots}}
 */
function resolve(pathname) {
  if (!pathname || pathname === '/' || pathname === '') return HOME;
  if (pathname === '/by-aircraft' || pathname === '/by-aircraft/') return BY_AIRCRAFT;
  if (pathname === '/map' || pathname === '/map/') return MAP;

  const acMatch = /^\/aircraft\/([^/?#]+)\/?$/.exec(pathname);
  if (acMatch) return aircraftMeta(acMatch[1].toLowerCase());

  const rtMatch = /^\/routes\/([^/?#]+)\/?$/.exec(pathname);
  if (rtMatch) return routeMeta(rtMatch[1].toLowerCase());

  // Anything else (/foo, /aircraft, /routes without a slug, typos) is an
  // unknown URL — return 404-style metadata so the server can set the real
  // HTTP status and we don't index every bot-fuzzed URL as duplicate-home.
  return notFoundMeta();
}

/**
 * Build per-route structured data (schema.org, JSON-LD). The base
 * index.html already ships a WebSite + SoftwareApplication graph; this
 * returns an ADDITIONAL graph that gets injected right before </head>:
 *
 *   - BreadcrumbList — on /aircraft/:slug and /routes/:pair
 *   - FAQPage       — on home (Q&A content is also visible in the static
 *                     fallback, so this satisfies Google's requirement
 *                     that FAQ schema mirrors visible content)
 *
 * Returns null when there's no extra graph to inject (e.g. /by-aircraft,
 * /map, not-found), letting the caller skip the script tag entirely.
 */
function structuredData(meta) {
  const graph = [];
  if (meta.kind === 'aircraft') {
    graph.push({
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: `${BASE}/` },
        { '@type': 'ListItem', position: 2, name: 'By aircraft', item: `${BASE}/by-aircraft` },
        { '@type': 'ListItem', position: 3, name: meta.aircraftLabel, item: meta.canonical },
      ],
    });
    // FAQPage mirrors the visible FAQ block on the landing page — must
    // stay in sync with client/src/content/landingCopy.js so Google
    // doesn't flag it.
    const faq = AIRCRAFT_FAQ[meta.slug];
    if (Array.isArray(faq) && faq.length > 0) {
      graph.push({
        '@type': 'FAQPage',
        mainEntity: faq.map((qa) => ({
          '@type': 'Question',
          name: qa.q,
          acceptedAnswer: { '@type': 'Answer', text: qa.a },
        })),
      });
    }
  } else if (meta.kind === 'route') {
    graph.push({
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: `${BASE}/` },
        { '@type': 'ListItem', position: 2, name: 'Routes', item: `${BASE}/` },
        {
          '@type': 'ListItem',
          position: 3,
          name: `${meta.fromName} to ${meta.toName}`,
          item: meta.canonical,
        },
      ],
    });
    // Route FAQ is templated — substitute city/IATA values. Only emit
    // the schema when we have real city names (if getAirport returned
    // null we'd be echoing IATA codes and the FAQ reads awkwardly).
    const from = { city: meta.fromName, iata: meta.fromIata };
    const to   = { city: meta.toName,   iata: meta.toIata };
    if (Array.isArray(ROUTE_FAQ) && ROUTE_FAQ.length > 0) {
      graph.push({
        '@type': 'FAQPage',
        mainEntity: ROUTE_FAQ.map((qa) => ({
          '@type': 'Question',
          name: interpolate(qa.q, from, to),
          acceptedAnswer: {
            '@type': 'Answer',
            text: interpolate(qa.a, from, to),
          },
        })),
      });
    }
  } else if (meta.kind === 'home') {
    graph.push({
      '@type': 'FAQPage',
      mainEntity: [
        {
          '@type': 'Question',
          name: 'How do I search flights by aircraft type on FlightFinder?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Pick an aircraft model — Boeing 737, Airbus A320, A380, Boeing 787 Dreamliner and more — enter your origin airport, and FlightFinder shows every route that plane flies from there with live fares.',
          },
        },
        {
          '@type': 'Question',
          name: 'Which aircraft types can I filter by?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'We support Boeing 737/747/757/767/777/787, the full Airbus A220/A319/A320/A321/A330/A340/A350/A380 family, Embraer E170/E175/E190/E195, Bombardier CRJ and Dash 8, and the ATR 42/72 turboprops.',
          },
        },
        {
          '@type': 'Question',
          name: 'Is FlightFinder free to use?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Yes. FlightFinder is free. We surface live fares and route data from multiple providers; when you book, you are redirected to the airline or partner that owns the inventory.',
          },
        },
        {
          '@type': 'Question',
          name: 'Where does the route data come from?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Live schedules come from Amadeus, AeroDataBox and Travelpayouts. Observed routes (which aircraft actually flew a given city pair) are crowdsourced from adsb.lol ADS-B data under the Open Database License.',
          },
        },
      ],
    });
  }
  if (graph.length === 0) return null;
  return { '@context': 'https://schema.org', '@graph': graph };
}

/**
 * Apply resolved metadata to the raw index.html string. Returns a new
 * string; input is not mutated. Replaces:
 *   - <title>…</title>
 *   - <meta name="description" …>
 *   - <link rel="canonical" …>
 *   - <meta property="og:url|og:title|og:description|og:type" …>
 *   - <meta name="twitter:title|twitter:description" …>
 *   - (optionally) <meta name="robots" …>
 *   - <h1> and <p class="hero-subtitle"> inside the static #root fallback
 *   - Adds a <script type="application/ld+json"> with per-route graph
 *     (BreadcrumbList / FAQPage) right before </head>.
 */
function inject(html, meta) {
  let out = html;
  out = out.replace(/<title>[^<]*<\/title>/i, `<title>${esc(meta.title)}</title>`);
  out = out.replace(
    /<meta\s+name="description"\s+content="[^"]*"\s*\/?>/i,
    `<meta name="description" content="${esc(meta.description)}" />`
  );
  out = out.replace(
    /<link\s+rel="canonical"\s+href="[^"]*"\s*\/?>/i,
    `<link rel="canonical" href="${esc(meta.canonical)}" />`
  );
  out = out.replace(
    /<meta\s+property="og:url"\s+content="[^"]*"\s*\/?>/i,
    `<meta property="og:url" content="${esc(meta.canonical)}" />`
  );
  out = out.replace(
    /<meta\s+property="og:title"\s+content="[^"]*"\s*\/?>/i,
    `<meta property="og:title" content="${esc(meta.title)}" />`
  );
  out = out.replace(
    /<meta\s+property="og:description"\s+content="[^"]*"\s*\/?>/i,
    `<meta property="og:description" content="${esc(meta.description)}" />`
  );
  if (meta.ogType) {
    out = out.replace(
      /<meta\s+property="og:type"\s+content="[^"]*"\s*\/?>/i,
      `<meta property="og:type" content="${esc(meta.ogType)}" />`
    );
  }
  out = out.replace(
    /<meta\s+name="twitter:title"\s+content="[^"]*"\s*\/?>/i,
    `<meta name="twitter:title" content="${esc(meta.title)}" />`
  );
  out = out.replace(
    /<meta\s+name="twitter:description"\s+content="[^"]*"\s*\/?>/i,
    `<meta name="twitter:description" content="${esc(meta.description)}" />`
  );
  if (meta.robots) {
    out = out.replace(
      /<meta\s+name="robots"\s+content="[^"]*"\s*\/?>/i,
      `<meta name="robots" content="${esc(meta.robots)}" />`
    );
  }
  // Swap H1 + subtitle inside the static #root fallback. The selectors are
  // the exact substrings used in client/index.html — if they change there,
  // update both places (tests in smoke-test catch the regression).
  out = out.replace(
    /(<h1 style="font-size:clamp\(32px,6vw,56px\)[^"]*"[^>]*>)[^<]*(<\/h1>)/,
    `$1${esc(meta.h1)}$2`
  );
  out = out.replace(
    /(<p style="font-size:clamp\(16px,2\.2vw,20px\)[^"]*"[^>]*>)[^<]*(<\/p>)/,
    `$1${esc(meta.subtitle)}$2`
  );
  const sd = structuredData(meta);
  if (sd) {
    // JSON.stringify output is already safe inside a <script> tag as long
    // as we escape the one sequence that can break out: </
    const json = JSON.stringify(sd).replace(/<\/(script)/gi, '<\\/$1');
    const tag  = `<script type="application/ld+json">${json}</script>\n  </head>`;
    out = out.replace(/<\/head>/i, tag);
  }
  return out;
}

module.exports = { resolve, inject, structuredData };
