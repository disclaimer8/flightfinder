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

// Replace the body between a tag-open prefix and its closing tag, using
// only linear indexOf/slice so there's no regex backtracking surface.
// Returns the input unchanged when either marker is missing.
function replaceTagBody(html, openPrefix, closeTag, newBody) {
  const openStart = html.indexOf(openPrefix);
  if (openStart < 0) return html;
  const openEnd = html.indexOf('>', openStart + openPrefix.length);
  if (openEnd < 0) return html;
  const closeStart = html.indexOf(closeTag, openEnd + 1);
  if (closeStart < 0) return html;
  return html.slice(0, openEnd + 1) + newBody + html.slice(closeStart);
}

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
  description: 'Pick an aircraft model (Boeing 787, Airbus A350, A380, Boeing 737 MAX and more) and see every route that plane flies worldwide.',
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
//
// Looked up live per call (not memoised at module load) so families
// added by hot config reload immediately become indexable instead of
// quietly returning notFoundMeta until the next pm2 restart.
function knownSlugs() {
  return new Set(getFamilyList().map((f) => f.slug));
}

/** /aircraft/:slug */
function aircraftMeta(slug) {
  if (!knownSlugs().has(slug)) return notFoundMeta();
  const fam = getFamilyBySlug(slug);
  const label = fam?.family?.label || fam?.name || slug;
  const manufacturer = fam?.family?.manufacturer || '';
  return {
    title: `${label} flights, routes and safety record | FlightFinder`,
    description: `Every route operated by the ${label}: airlines, city pairs, and recent safety events for the ${manufacturer} ${fam?.name || ''} fleet. Live schedule data.`,
    canonical: `${BASE}/aircraft/${slug}`,
    h1: `${label} — flights, routes and airlines`,
    subtitle: `Every city pair operated by the ${label} worldwide. Live schedule data, recent safety events, and operator details.`,
    robots: 'index, follow',
    ogType: 'article',
    // Generic "search by aircraft" share image — per-family PNGs would
    // need 20+ assets and per-launch refresh. The default conveys the
    // value prop ("search by aircraft type") well enough for social cards.
    ogImage: `${BASE}/og/aircraft-default.png`,
    ogImageAlt: `${label} flights and routes on FlightFinder`,
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

  // Subscription pivot routes — indexable SPA pages with per-route meta so
  // Google doesn't dedupe them with the home title (they share an index.html
  // shell, but each surface needs a unique <title> + description).
  if (pathname === '/pricing' || pathname === '/pricing/') {
    return {
      title: 'FlightFinder Pro — $4.99/mo, $39/yr, or $99 lifetime',
      description: 'Unlock the enriched flight card (livery, on-time stats, CO₂, amenities), delay predictions, and My Trips with web-push alerts. Cancel anytime. Lifetime is capped at 500 founders.',
      canonical: `${BASE}/pricing`,
      h1: 'Choose your plan',
      subtitle: 'Unlock enriched flight data, delay predictions, and My Trips.',
      robots: 'index, follow',
      ogType: 'website',
      kind: 'pricing',
    };
  }
  if (pathname === '/trips' || pathname === '/trips/') {
    return { ...HOME, kind: 'trips', canonical: `${BASE}/trips`, robots: 'noindex, follow' };
  }
  if (pathname === '/subscribe/return') {
    return { ...HOME, kind: 'subscribe', canonical: `${BASE}/pricing`, robots: 'noindex, nofollow' };
  }
  if (pathname === '/legal/terms' || pathname === '/legal/terms/') {
    return {
      title: 'Terms of Service | FlightFinder',
      description: 'FlightFinder terms of service — subscription tiers, billing and tax handling, refunds, cancellation, EU 14-day right of withdrawal, acceptable use, and termination policy.',
      canonical: `${BASE}/legal/terms`,
      h1: 'Terms of Service',
      subtitle: 'How FlightFinder works — billing, refunds, acceptable use.',
      robots: 'index, follow',
      ogType: 'article',
      kind: 'legal',
    };
  }
  if (pathname === '/legal/privacy' || pathname === '/legal/privacy/') {
    return {
      title: 'Privacy Policy | FlightFinder',
      description: 'FlightFinder privacy policy — what we collect, how we use it, what we share, and your rights under GDPR and CCPA. Stripe handles payment data; we do not store card numbers.',
      canonical: `${BASE}/legal/privacy`,
      h1: 'Privacy Policy',
      subtitle: 'What we collect, how we use it, and your rights.',
      robots: 'index, follow',
      ogType: 'article',
      kind: 'legal',
    };
  }
  if (pathname === '/legal/attributions' || pathname === '/legal/attributions/') {
    return {
      title: 'Data sources and attributions | FlightFinder',
      description: 'FlightFinder uses public aviation datasets — adsb.lol (ADS-B observed routes), AeroDataBox and Travelpayouts (schedules and fares), Wikidata, NTSB, OpenFlights, OurAirports, and OpenWeather.',
      canonical: `${BASE}/legal/attributions`,
      h1: 'Data sources and attributions',
      subtitle: 'Open and licensed datasets that power FlightFinder.',
      robots: 'index, follow',
      ogType: 'article',
      kind: 'legal',
    };
  }

  if (pathname === '/safety/feed' || pathname === '/safety/feed/') {
    return {
      title: 'NTSB recent aviation accidents — daily feed (United States) | FlightFinder',
      description: 'Daily updated feed of recent U.S. aviation accidents and incidents from the official NTSB CAROL database. Filter by severity. Cross-references aircraft type and operator.',
      canonical: `${BASE}/safety/feed`,
      h1: 'NTSB recent aviation accidents and incidents',
      subtitle: 'Daily updated feed from the official U.S. National Transportation Safety Board database',
      robots: 'index, follow',
      ogType: 'website',
      ogImage: `${BASE}/og/safety-feed.png`,
      ogImageAlt: 'NTSB recent aviation accidents feed',
      kind: 'safety-feed',
    };
  }

  if (pathname === '/safety/global' || pathname === '/safety/global/') {
    return {
      // 62 chars — fits Google mobile SERP without truncation, leads with
      // the number-of-records signal that wins keyword matches.
      title: 'Aviation accident database — 35,000+ records worldwide since 1962',
      description: 'Searchable global aviation accident database: 35,000+ records since 1962 from NTSB, Aviation Safety Network, B3A, Wikidata. Interactive map and rankings by aircraft and operator.',
      canonical: `${BASE}/safety/global`,
      h1: 'Global aviation safety',
      subtitle: 'Historical accidents worldwide',
      robots: 'index, follow',
      ogType: 'website',
      ogImage: `${BASE}/og/safety-global.png`,
      ogImageAlt: 'Global aviation safety database — interactive accident map',
      kind: 'safety-global',
    };
  }

  const safetyEventMatch = /^\/safety\/events\/([^/?#]+)\/?$/.exec(pathname);
  if (safetyEventMatch) {
    const id = safetyEventMatch[1];
    if (!/^\d+$/.test(id)) return notFoundMeta();
    return {
      title: 'Aviation safety event — NTSB record | FlightFinder',
      description: 'Detailed view of an NTSB aviation accident or incident report.',
      canonical: `${BASE}/safety/events/${id}`,
      h1: 'Aviation safety event',
      subtitle: 'NTSB record',
      // noindex until each event has unique narrative content — currently
      // they're thin NTSB record dumps (date, severity, registration). Bing
      // and Google flag thin content as a quality signal at the domain
      // level, so it's better to keep them out of the index until we add
      // value-add commentary or related-events context. follow stays on
      // so PageRank still flows out to /safety/feed and /aircraft/:slug.
      robots: 'noindex, follow',
      ogType: 'article',
      kind: 'safety-event',
      eventId: id,
    };
  }

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
    // Vehicle schema — schema.org has no Aircraft type, but Vehicle is
    // ingested cleanly by Google entity panels and Bing knowledge cards.
    graph.push({
      '@type': 'Vehicle',
      name: meta.aircraftLabel,
      ...(meta.aircraftManufacturer ? {
        manufacturer: { '@type': 'Organization', name: meta.aircraftManufacturer },
      } : {}),
      vehicleConfiguration: 'Commercial aircraft',
      url: meta.canonical,
    });
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
  } else if (meta.kind === 'safety-global') {
    graph.push({
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: `${BASE}/` },
        { '@type': 'ListItem', position: 2, name: 'Safety', item: `${BASE}/safety/global` },
        { '@type': 'ListItem', position: 3, name: 'Global aviation safety', item: meta.canonical },
      ],
    });
    // Dataset schema — gateway to Google Dataset Search. The dataset is
    // facts (date/operator/aircraft/fatalities) aggregated from public
    // sources; the aggregation itself is the publishable artefact.
    graph.push({
      '@type': 'Dataset',
      name: 'Global aviation accident records (1980–present)',
      description: 'Worldwide aviation accident dataset aggregated from the Aviation Safety Network, the Bureau of Aircraft Accidents Archives (B3A), and Wikidata. Approximately 5,200 records since 1980 with aircraft type, operator, location, fatalities and source URL where known. Updated weekly.',
      url: meta.canonical,
      keywords: [
        'aviation safety',
        'aircraft accidents',
        'plane crashes',
        'aviation incidents',
        'flight safety',
        'aircraft type safety records',
      ],
      isAccessibleForFree: true,
      creator: { '@type': 'Organization', name: 'FlightFinder', url: BASE },
      temporalCoverage: '1980-01-01/..',
      spatialCoverage: { '@type': 'Place', name: 'Worldwide' },
      distribution: [
        {
          '@type': 'DataDownload',
          encodingFormat: 'application/json',
          contentUrl: `${BASE}/api/safety/global/accidents`,
        },
      ],
    });
  } else if (meta.kind === 'safety-feed') {
    graph.push({
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: `${BASE}/` },
        { '@type': 'ListItem', position: 2, name: 'Safety', item: `${BASE}/safety/global` },
        { '@type': 'ListItem', position: 3, name: 'NTSB feed', item: meta.canonical },
      ],
    });
    graph.push({
      '@type': 'Dataset',
      name: 'NTSB recent aviation accidents and incidents',
      description: 'Recent U.S. aviation accidents and incidents from the official National Transportation Safety Board (NTSB) CAROL database. Updated daily.',
      url: meta.canonical,
      keywords: ['NTSB', 'aviation accidents', 'aviation incidents', 'aviation safety', 'United States'],
      isAccessibleForFree: true,
      creator: { '@type': 'Organization', name: 'FlightFinder', url: BASE },
      spatialCoverage: { '@type': 'Country', name: 'United States' },
    });
  } else if (meta.kind === 'pricing') {
    graph.push({
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: `${BASE}/` },
        { '@type': 'ListItem', position: 2, name: 'Pricing', item: meta.canonical },
      ],
    });
    // Product + per-tier Offer schema — opens pricing snippets in SERP and
    // is required for Google Merchant validation if we ever ingest into Shopping.
    graph.push({
      '@type': 'Product',
      name: 'FlightFinder Pro',
      description: 'Pro subscription unlocks enriched flight cards (livery, on-time stats, CO₂, amenities), delay predictions, and My Trips with push alerts.',
      brand: { '@type': 'Organization', name: 'FlightFinder', url: BASE },
      url: meta.canonical,
      offers: [
        {
          '@type': 'Offer',
          name: 'Pro Monthly',
          price: '4.99',
          priceCurrency: 'USD',
          priceSpecification: {
            '@type': 'UnitPriceSpecification',
            price: '4.99',
            priceCurrency: 'USD',
            billingDuration: 'P1M',
          },
          availability: 'https://schema.org/InStock',
          url: `${BASE}/pricing`,
        },
        {
          '@type': 'Offer',
          name: 'Pro Annual',
          price: '39',
          priceCurrency: 'USD',
          priceSpecification: {
            '@type': 'UnitPriceSpecification',
            price: '39',
            priceCurrency: 'USD',
            billingDuration: 'P1Y',
          },
          availability: 'https://schema.org/InStock',
          url: `${BASE}/pricing`,
        },
        {
          '@type': 'Offer',
          name: 'Pro Lifetime',
          price: '99',
          priceCurrency: 'USD',
          availability: 'https://schema.org/LimitedAvailability',
          // Lifetime is a one-time payment — no priceSpecification needed,
          // schema.org defaults a plain Offer to one-time billing.
          url: `${BASE}/pricing`,
          eligibleQuantity: { '@type': 'QuantitativeValue', maxValue: 500 },
        },
      ],
    });
  } else if (meta.kind === 'by-aircraft') {
    graph.push({
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: `${BASE}/` },
        { '@type': 'ListItem', position: 2, name: 'By aircraft', item: meta.canonical },
      ],
    });
    // ItemList — every aircraft family we ship a landing page for. Helps
    // Google understand the index page is a curated list, not a thin shell.
    const families = getFamilyList();
    if (families.length > 0) {
      graph.push({
        '@type': 'ItemList',
        name: 'Aircraft families with dedicated landing pages',
        numberOfItems: families.length,
        itemListElement: families.map((fam, i) => ({
          '@type': 'ListItem',
          position: i + 1,
          url: `${BASE}/aircraft/${fam.slug}`,
          name: fam.family?.label || fam.name || fam.slug,
        })),
      });
    }
  } else if (meta.kind === 'legal') {
    graph.push({
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: `${BASE}/` },
        { '@type': 'ListItem', position: 2, name: 'Legal', item: meta.canonical },
      ],
    });
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
            text: 'Search and schedule data are free. Pro ($4.99/month, $39/year, or $99 one-time lifetime) unlocks the enriched flight card — on-time stats, CO₂ per passenger, amenities, live gate & weather — plus My Trips with push alerts.',
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
  // Per-route OG / Twitter image. Falls back to the homepage banner when
  // the route doesn't ship its own image. Set meta.ogImage in the
  // resolver to override; meta.ogImageAlt for accessibility text.
  if (meta.ogImage) {
    const imgUrl = meta.ogImage;
    const imgAlt = meta.ogImageAlt || meta.title;
    out = out.replace(
      /<meta\s+property="og:image"\s+content="[^"]*"\s*\/?>/i,
      `<meta property="og:image" content="${esc(imgUrl)}" />`
    );
    out = out.replace(
      /<meta\s+property="og:image:alt"\s+content="[^"]*"\s*\/?>/i,
      `<meta property="og:image:alt" content="${esc(imgAlt)}" />`
    );
    out = out.replace(
      /<meta\s+name="twitter:image"\s+content="[^"]*"\s*\/?>/i,
      `<meta name="twitter:image" content="${esc(imgUrl)}" />`
    );
    out = out.replace(
      /<meta\s+name="twitter:image:alt"\s+content="[^"]*"\s*\/?>/i,
      `<meta name="twitter:image:alt" content="${esc(imgAlt)}" />`
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
  // Swap H1 + subtitle inside the static #root fallback. The marker
  // prefixes are the exact substrings used in client/index.html — if they
  // change there, update both places (tests in smoke-test catch the
  // regression). Uses indexOf/slice instead of regex to avoid the
  // polynomial-backtracking pattern flagged by CodeQL js/polynomial-redos
  // on `[^"]*"[^>]*>` when scanning arbitrary HTML.
  out = replaceTagBody(out, '<h1 style="font-size:clamp(32px,6vw,56px)', '</h1>', esc(meta.h1));
  out = replaceTagBody(out, '<p style="font-size:clamp(16px,2.2vw,20px)', '</p>',  esc(meta.subtitle));
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

module.exports = { resolve, inject, structuredData, esc };
