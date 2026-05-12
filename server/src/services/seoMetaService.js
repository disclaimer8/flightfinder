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
const { getVariantBySlug, getVariantsByFamilySlug } = require('../models/aircraftVariants');
const openFlightsService = require('./openFlightsService');
const aircraftRouteService = require('./aircraftRouteService');
const { AIRCRAFT_FAQ, ROUTE_FAQ, interpolate } = require('../content/landingFaq');
const safety = require('../models/safetyEvents');
const db = require('../models/db');
const { colorBand, topNotable } = require('./safetyRating');
const { buildEventSlug, parseEventIdFromSlug } = require('../utils/eventSlug');

function _safeDb(fn, fallback = []) {
  try { return fn(db); }
  catch { return fallback; }
}

const fr24Cache = require('./fr24CacheService');

function _safeFr24(fn) {
  try { return fn(fr24Cache); }
  catch { return null; }
}

// Sort alphabetically so /routes/JFK-LHR and /routes/LHR-JFK collapse to the
// same fr24 cache key — direction is irrelevant for the derived stats we cache,
// and the refresh writer applies the same canonicalization on write.
function _canonicalPair(a, b) {
  const [x, y] = [a, b].map((s) => String(s || '').toUpperCase()).sort();
  return `${x}-${y}`;
}

const BASE = 'https://himaxym.com';
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c])
);

// Normalise aircraftFamilies.js per-family record for SEO bake builders.
// Builders read range_km/capacity/engines/mtow_kg; the source uses different
// field names (maxRange, etc.) and not all fields are populated for every
// family — those become undefined, builders gracefully omit them.
function _bakeFamilyFields(fam) {
  if (!fam || !fam.family) return null;
  const f = fam.family;
  return {
    range_km:     f.maxRange || f.range_km,
    capacity:     f.capacity,
    engines:      f.engines,
    mtow_kg:      f.mtow || f.mtow_kg,
    manufacturer: f.manufacturer,
  };
}

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

const SEARCH = {
  title: 'Flight Search — FlightFinder',
  description: 'Search flights by route and date. Filter results by aircraft type, airlines, and stops. See the safety record of every operator and aircraft before you book.',
  canonical: `${BASE}/search`,
  h1: 'Flight search',
  subtitle: 'Pick origin, destination, and date — then refine by aircraft, airline, and safety.',
  ogType: 'website',
  kind: 'search',
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
  const icaoList = fam ? fam.icaoList : [];
  const family   = _bakeFamilyFields(fam);
  // Safety enrichment — fatal events power the colorBand + topEvents the bake
  // pipeline renders into the static fallback. Wrapped in try/catch so a DB
  // hiccup degrades to no badge instead of breaking the whole page resolve.
  const fatalEvents = _safeDb((d) => d.getFatalEventsByIcaoList(icaoList));
  const variants = getVariantsByFamilySlug(slug);
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
    icaoList,
    family,
    colorBand: colorBand(fatalEvents),
    topEvents: topNotable(fatalEvents, 5),
    variants,
    fr24Stats: _safeFr24((c) => c.get(`family:${slug}`)),
  };
}

/** /aircraft/:slug/airlines */
function aircraftAirlinesMeta(slug) {
  const fam = getFamilyBySlug(slug);
  if (!fam) return notFoundMeta();
  const label = fam.family?.label || fam.name || slug;
  const icaoList = fam.icaoList;
  const family   = _bakeFamilyFields(fam);
  return {
    title: `Airlines that operate the ${label} | FlightFinder`,
    description: `Airlines worldwide operating the ${label}: route count per carrier, model variants flown, last observed dates. Sourced from open ADS-B data, refreshed nightly.`,
    canonical: `${BASE}/aircraft/${slug}/airlines`,
    h1: `Airlines that operate the ${label}`,
    subtitle: `Operators of the ${label} worldwide`,
    robots: 'index, follow',
    ogType: 'article',
    ogImage: `${BASE}/og/aircraft-default.png`,
    kind: 'aircraft-airlines',
    slug,
    aircraftLabel: label,
    icaoList,
    family,
  };
}

/** /aircraft/:slug/routes */
function aircraftRoutesMeta(slug) {
  const fam = getFamilyBySlug(slug);
  if (!fam) return notFoundMeta();
  const label = fam.family?.label || fam.name || slug;
  const icaoList = fam.icaoList;
  const family   = _bakeFamilyFields(fam);
  return {
    title: `Top routes flown by the ${label} | FlightFinder`,
    description: `Top 50 city pairs operated by the ${label} worldwide: which airlines fly each route, how many model variants observed. Sourced from open ADS-B data.`,
    canonical: `${BASE}/aircraft/${slug}/routes`,
    h1: `Top routes flown by the ${label}`,
    subtitle: `City pairs the ${label} operates worldwide`,
    robots: 'index, follow',
    ogType: 'article',
    ogImage: `${BASE}/og/aircraft-default.png`,
    kind: 'aircraft-routes',
    slug,
    aircraftLabel: label,
    icaoList,
    family,
  };
}

/** /aircraft/:slug/safety */
function aircraftSafetyMeta(slug) {
  const fam = getFamilyBySlug(slug);
  if (!fam) return notFoundMeta();
  const label = fam.family?.label || fam.name || slug;
  const icaoList = fam.icaoList;
  const family   = _bakeFamilyFields(fam);
  // Use 1980-01-01 as the lower bound (dataset start). sinceMs=0 is epoch
  // which also works, but 1980 matches the documented dataset temporal range
  // and is more explicit about intent.
  let safetyEventCount;
  try {
    const since = Date.parse('1980-01-01T00:00:00Z');
    safetyEventCount = safety.countByAircraftCodes(icaoList, since);
  } catch {
    safetyEventCount = undefined; // builder degrades to null
  }
  // Pull both fatal-only and full event lists for the safety pillar page.
  // Same try/catch degradation pattern as aircraftMeta — DB issues yield empty
  // arrays so colorBand defaults to "green / no record" instead of crashing.
  const fatalEvents = _safeDb((d) => d.getFatalEventsByIcaoList(icaoList));
  const allEvents   = _safeDb((d) => d.getAllEventsByIcaoList(icaoList, 100));
  const variants = getVariantsByFamilySlug(slug);
  return {
    title: `${label} safety record — accidents and incidents | FlightFinder`,
    description: `Aviation safety events involving the ${label}: hull losses, fatal accidents, and serious incidents from NTSB CAROL, Aviation Safety Network, B3A, and Wikidata.`,
    canonical: `${BASE}/aircraft/${slug}/safety`,
    h1: `${label} safety record`,
    subtitle: `Accidents and incidents from public aviation safety datasets`,
    robots: 'index, follow',
    ogType: 'article',
    ogImage: `${BASE}/og/aircraft-default.png`,
    kind: 'aircraft-safety',
    slug,
    aircraftLabel: label,
    icaoList,
    family,
    safetyEventCount,
    colorBand: colorBand(fatalEvents),
    topEvents: topNotable(fatalEvents, 5),
    allEvents,
    variants,
  };
}

/** /aircraft/:slug/specs */
function aircraftSpecsMeta(slug) {
  const fam = getFamilyBySlug(slug);
  if (!fam) return notFoundMeta();
  const label = fam.family?.label || fam.name || slug;
  const icaoList = fam.icaoList;
  const family   = _bakeFamilyFields(fam);
  return {
    title: `${label} specifications — range, capacity, engines | FlightFinder`,
    description: `${label} technical specifications: range, passenger capacity, maximum takeoff weight, wingspan, length, height, max speed, ceiling, engine options, variants.`,
    canonical: `${BASE}/aircraft/${slug}/specs`,
    h1: `${label} specifications`,
    subtitle: `Range, capacity, engines, dimensions`,
    robots: 'index, follow',
    ogType: 'article',
    ogImage: `${BASE}/og/aircraft-default.png`,
    kind: 'aircraft-specs',
    slug,
    aircraftLabel: label,
    icaoList,
    family,
  };
}

/** /aircraft/:family/variants/:variant */
function aircraftVariantMeta(familySlug, variantSlug) {
  const fam = getFamilyBySlug(familySlug);
  const v = getVariantBySlug(familySlug, variantSlug);
  if (!fam || !v) return notFoundMeta();

  const fatalEvents = _safeDb((d) => d.getFatalEventsByIcaoList([v.icao]));
  const allEvents   = _safeDb((d) => d.getAllEventsByIcaoList([v.icao], 100));

  return {
    title: `${v.fullName} — flights, routes and safety record | FlightFinder`,
    description: `${v.shortName} (${v.icao}) operators, top routes, full specifications, and complete safety record from public datasets. Part of the ${fam.family.label} family.`,
    canonical: `${BASE}/aircraft/${familySlug}/variants/${variantSlug}`,
    h1: `${v.shortName} — flights, routes and operators`,
    subtitle: v.description.split('. ')[0] + '.',
    robots: 'index, follow',
    ogType: 'website',
    kind: 'aircraft-variant',

    variant: v,
    family: { ...fam.family, name: fam.name, slug: familySlug },
    icaoList: [v.icao],
    colorBand: colorBand(fatalEvents),
    topEvents: topNotable(fatalEvents, 5),
    allEvents,
    fr24Stats: _safeFr24((c) => c.get(`variant:${v.icao}`)),
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
    fr24Stats: _safeFr24((c) => c.get(`route:${_canonicalPair(fromIata, toIata)}`)),
  };
}

/** /routes/:pair/:slug  (e.g. lhr-jfk/boeing-787) */
function aircraftRouteMeta(pair, slug) {
  const m = /^([a-z]{3})-([a-z]{3})$/.exec(pair);
  if (!m) return notFoundMeta();
  const fromIata = m[1].toUpperCase();
  const toIata   = m[2].toUpperCase();
  const fromAp   = openFlightsService.getAirport(fromIata);
  const toAp     = openFlightsService.getAirport(toIata);
  if (!fromAp || !toAp) return notFoundMeta();

  const fam = getFamilyBySlug(slug);
  if (!fam) return notFoundMeta();
  const aircraftLabel = fam.family?.label || fam.name || slug;

  const qualifies = aircraftRouteService.isQualifying(fromIata, toIata, slug);
  const fromName = fromAp.city || fromAp.name || fromIata;
  const toName   = toAp.city   || toAp.name   || toIata;
  const canonical = `${BASE}/routes/${pair}/${slug}`;

  return {
    title: `${fromName} to ${toName} on the ${aircraftLabel} (${fromIata} → ${toIata}) — flights and operators | FlightFinder`,
    description: `Flights from ${fromName} (${fromIata}) to ${toName} (${toIata}) operated by the ${aircraftLabel}: which airlines, model variants observed, and recent observations from open ADS-B data.`,
    canonical,
    h1: `${fromName} to ${toName} on the ${aircraftLabel}`,
    subtitle: `${fromIata} → ${toIata} · operated by the ${aircraftLabel}`,
    robots: qualifies ? 'index, follow' : 'noindex, follow',
    ogType: 'article',
    kind: 'aircraft-route',
    pair,
    slug,
    fromIata,
    toIata,
    fromName,
    toName,
    aircraftLabel,
  };
}

function notFoundMeta() {
  return {
    ...HOME,
    robots: 'noindex, follow',
    kind: 'not-found',
  };
}

function airportMeta(iata) {
  const upper = iata.toUpperCase();
  return {
    title: `${upper} airport — direct destinations, airlines, top routes | FlightFinder`,
    description: `${upper} airport: which cities have direct flights, which airlines operate them, and which destinations travellers favour. Sourced from Amadeus booked/traveled aggregates and open ADS-B observations.`,
    canonical: `${BASE}/airport/${iata}`,
    h1: `${upper} airport — flights and destinations`,
    subtitle: `Direct destinations, top airlines, and traffic patterns for ${upper}.`,
    robots: 'index, follow',
    ogType: 'website',
    kind: 'airport',
    iata: upper,
  };
}

function airlineMeta(iata) {
  const upper = iata.toUpperCase();
  return {
    title: `${upper} airline — routes, fleet, destinations | FlightFinder`,
    description: `${upper} airline network: destinations served, observed aircraft families, and top operated routes. Cross-referenced with open ADS-B and Amadeus reference data.`,
    canonical: `${BASE}/airline/${iata}`,
    h1: `${upper} — destinations and fleet`,
    subtitle: `Routes, aircraft, and top destinations operated by ${upper}.`,
    robots: 'index, follow',
    ogType: 'website',
    kind: 'airline',
    iata: upper,
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
  if (pathname === '/search' || pathname === '/search/') return SEARCH;

  const acAirlinesMatch = /^\/aircraft\/([^/?#]+)\/airlines\/?$/.exec(pathname);
  if (acAirlinesMatch) return aircraftAirlinesMeta(acAirlinesMatch[1].toLowerCase());

  const acRoutesPillarMatch = /^\/aircraft\/([^/?#]+)\/routes\/?$/.exec(pathname);
  if (acRoutesPillarMatch) return aircraftRoutesMeta(acRoutesPillarMatch[1].toLowerCase());

  const acSafetyMatch = /^\/aircraft\/([^/?#]+)\/safety\/?$/.exec(pathname);
  if (acSafetyMatch) return aircraftSafetyMeta(acSafetyMatch[1].toLowerCase());

  const acSpecsMatch = /^\/aircraft\/([^/?#]+)\/specs\/?$/.exec(pathname);
  if (acSpecsMatch) return aircraftSpecsMeta(acSpecsMatch[1].toLowerCase());

  // Variant landing must match BEFORE the bare /aircraft/:slug catch-all,
  // otherwise the /:slug regex wins and 'boeing-787' resolves to family meta
  // while '/variants/787-9' falls through as 404.
  const acVariantMatch = /^\/aircraft\/([^/?#]+)\/variants\/([^/?#]+)\/?$/
    .exec(pathname);
  if (acVariantMatch) {
    return aircraftVariantMeta(
      acVariantMatch[1].toLowerCase(),
      acVariantMatch[2].toLowerCase(),
    );
  }

  const acMatch = /^\/aircraft\/([^/?#]+)\/?$/.exec(pathname);
  if (acMatch) return aircraftMeta(acMatch[1].toLowerCase());

  const airportMatch = /^\/airport\/([a-z]{3})\/?$/i.exec(pathname);
  if (airportMatch) return airportMeta(airportMatch[1].toLowerCase());

  const airlineMatch = /^\/airline\/([a-z0-9]{2,3})\/?$/i.exec(pathname);
  if (airlineMatch) return airlineMeta(airlineMatch[1].toLowerCase());

  const rtMatch = /^\/routes\/([^/?#]+)\/?$/.exec(pathname);
  if (rtMatch) return routeMeta(rtMatch[1].toLowerCase());

  const acRtMatch = /^\/routes\/([a-z]{3}-[a-z]{3})\/([^/?#]+)\/?$/i.exec(pathname);
  if (acRtMatch) {
    return aircraftRouteMeta(acRtMatch[1].toLowerCase(), acRtMatch[2].toLowerCase());
  }

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

  if (pathname === '/about' || pathname === '/about/') {
    return {
      title: 'About FlightFinder — flight search built around aircraft type',
      description: 'FlightFinder is a flight search engine optimized for aircraft type, with a global aviation safety database aggregated from NTSB, Wikidata, B3A and ADS-B sources.',
      canonical: `${BASE}/about`,
      h1: 'About FlightFinder',
      subtitle: 'Flight search built around aircraft type, with public aviation safety data.',
      robots: 'index, follow',
      ogType: 'website',
      kind: 'about',
    };
  }

  if (pathname === '/safety/feed' || pathname === '/safety/feed/') {
    let recentIncidents = [];
    try {
      const raw = safety.getRecent({ limit: 10 }) || [];
      // Map to the shape bSafetyFeed expects: {date, aircraft, summary}.
      // occurred_at is stored as epoch ms — format to YYYY-MM-DD.
      // Many NTSB rows lack narrative; compose a useful summary from
      // operator + location + severity so the feed item is still informative.
      recentIncidents = raw.map((e) => {
        const ms = typeof e.occurred_at === 'number' ? e.occurred_at : Date.parse(e.date || '');
        const date = Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : 'unknown date';

        const aircraft = e.aircraft_icao_type || e.aircraft_type || e.registration || 'unknown aircraft';

        let summary = e.narrative || e.summary;
        if (!summary) {
          const parts = [];
          if (e.severity)         parts.push(e.severity);
          if (e.fatalities > 0)   parts.push(`${e.fatalities} fatal`);
          if (e.operator_name)    parts.push(e.operator_name);
          if (e.location_country) parts.push(e.location_country);
          summary = parts.length ? parts.join(', ') : 'no details';
        }

        return { date, aircraft, summary };
      });
    } catch {
      recentIncidents = []; // builder will return null
    }
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
      recentIncidents,
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
    const slug = safetyEventMatch[1];
    const id = parseEventIdFromSlug(slug);
    if (!id) return notFoundMeta();

    const ev = safety.getById(id);
    if (!ev) return notFoundMeta();

    const canonicalSlug = buildEventSlug(ev);
    const canonical = `${BASE}/safety/events/${canonicalSlug}`;
    const isLegacy = slug !== canonicalSlug;

    // Quality gate — index only fatal/hull_loss with narrative or ≥3 related.
    const isHighSeverity = ev.severity === 'fatal' || ev.hull_loss === 1;
    const hasNarrative = !!(ev.narrative && ev.narrative.length > 50);
    const relatedCount = safety.getRelatedEventsCount(id);
    const indexable = isHighSeverity && (hasNarrative || relatedCount >= 3);

    const date = new Date(ev.occurred_at).toISOString().slice(0, 10);
    const op = ev.operator_name || ev.operator_icao || 'Unknown operator';
    const ac = ev.aircraft_icao_type || 'unknown aircraft';
    const ap = ev.dep_iata || ev.location_country || '';
    const sev = ev.severity === 'fatal' ? 'Fatal' : ev.hull_loss === 1 ? 'Hull loss' : 'Incident';

    return {
      title: `${sev} accident: ${op} ${ac}${ap ? ` at ${ap}` : ''} — ${date} | FlightFinder`,
      description: `${sev} aviation accident on ${date}: ${op} operating a ${ac}${ap ? ` near ${ap}` : ''}. Aggregated from ${ev.source === 'ntsb' ? 'NTSB CAROL' : 'Aviation Safety Network / Wikidata'}.`,
      canonical,
      h1: `${sev} accident: ${op} ${ac}`,
      subtitle: `${date}${ap ? ` · ${ap}` : ''}`,
      robots: indexable ? 'index, follow' : 'noindex, follow',
      redirectFromLegacy: isLegacy ? canonical : null,
      ogType: 'article',
      kind: 'safety-event',
      eventId: id,
      eventData: ev,
    };
  }

  const accidentMatch = /^\/accidents\/([^/?#]+)\/?$/.exec(pathname);
  if (accidentMatch) {
    const accidentSvc = require('./accidentNarrativeService');
    const data = accidentSvc.getBySlug(accidentMatch[1]);
    if (!data || data.indexable !== 1) return notFoundMeta();
    const f = data.facts;
    const escHtml = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
                                        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const title = `${f.date}: ${f.aircraft_model}${f.operator ? ' — ' + f.operator : ''} | FlightFinder`;
    const description = (data.narrative_text || '').slice(0, 250);

    const jsonLd = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'Event',
      name: `${f.date}: ${f.aircraft_model}${f.operator ? ' — ' + f.operator : ''}`,
      startDate: f.date,
      description,
      location: {
        '@type': 'Place',
        name: f.location || 'Unknown',
        geo: f.lat && f.lon
          ? { '@type': 'GeoCoordinates', latitude: f.lat, longitude: f.lon }
          : undefined,
      },
      about: [
        { '@type': 'Vehicle', name: f.aircraft_model },
        f.operator ? { '@type': 'Organization', name: f.operator } : null,
      ].filter(Boolean),
      isAccessibleForFree: true,
      publisher: { '@type': 'Organization', name: 'FlightFinder' },
    }).replace(/</g, '\\u003c');

    return {
      title: escHtml(title),
      description: escHtml(description),
      canonical: `${BASE}/accidents/${accidentMatch[1]}`,
      jsonLd,
      h1: escHtml(`${f.date}: ${f.aircraft_model}${f.operator ? ' — ' + f.operator : ''}`),
      robots: 'index, follow',
      ogType: 'article',
      kind: 'accident',
      slug: accidentMatch[1],
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
function _breadcrumbList(items) {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: it.name,
      ...(it.url ? { item: it.url } : {}),
    })),
  };
}

function structuredData(meta) {
  // Accident pages carry a pre-built Event JSON-LD string on meta.jsonLd
  // (constructed in resolve()). Parse it back to an object so inject() can
  // JSON.stringify it through the normal </script> escaping path.
  if (meta.kind === 'accident' && meta.jsonLd) {
    try { return JSON.parse(meta.jsonLd); } catch { /* fall through */ }
  }
  const graph = [];
  if (meta.kind === 'aircraft-variant') {
    // Variant landing breadcrumb: Home > Aircraft > <Family> > <Variant>.
    // Family slug is taken from meta.family (set by aircraftVariantMeta) and
    // falls back to the variant's own familySlug if family lookup ever fails.
    const familyName = meta.family?.name || meta.family?.label || meta.variant?.familySlug;
    const familySlug = meta.family?.slug || meta.variant?.familySlug;
    const variantName = meta.variant?.shortName || meta.variant?.slug;
    graph.push(_breadcrumbList([
      { name: 'Home', url: `${BASE}/` },
      { name: 'Aircraft', url: `${BASE}/by-aircraft` },
      { name: familyName, url: `${BASE}/aircraft/${familySlug}` },
      { name: variantName, url: meta.canonical },
    ]));
  } else if (meta.kind === 'aircraft') {
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
    // schema.org has no Aircraft type. Vehicle fits but inherits from Product,
    // which triggers Google's "missing offers/review/aggregateRating" rich-result
    // warning we can't honestly satisfy. Use Thing + Wikidata additionalType
    // (Q197 = airplane) so Knowledge Graph still resolves the entity.
    graph.push({
      '@type': 'Thing',
      name: meta.aircraftLabel,
      additionalType: 'https://www.wikidata.org/wiki/Q197',
      url: meta.canonical,
      ...(meta.aircraftManufacturer ? {
        description: `${meta.aircraftLabel} commercial aircraft, manufactured by ${meta.aircraftManufacturer}.`,
      } : {}),
    });
  } else if (meta.kind === 'route') {
    // Breadcrumb name carries IATA pair so SERP rich result shows the route
    // identifier (e.g. "JFK–LHR") rather than ambiguous city pairs that
    // collide across hubs (multiple airports per metro).
    graph.push({
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: `${BASE}/` },
        { '@type': 'ListItem', position: 2, name: 'Routes', item: `${BASE}/` },
        {
          '@type': 'ListItem',
          position: 3,
          name: `${meta.fromName} (${meta.fromIata}) to ${meta.toName} (${meta.toIata})`,
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
  } else if (meta.kind === 'about') {
    graph.push({
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: `${BASE}/` },
        { '@type': 'ListItem', position: 2, name: 'About', item: meta.canonical },
      ],
    });
    graph.push({
      '@type': 'AboutPage',
      url: meta.canonical,
      name: 'About FlightFinder',
      mainEntity: {
        '@type': 'Organization',
        name: 'FlightFinder',
        url: BASE,
        description: 'Flight search engine built around aircraft type, with a global aviation safety database aggregated from public sources.',
        email: 'support@himaxym.com',
        sameAs: [BASE],
        knowsAbout: [
          'Aviation',
          'Flight schedules',
          'Aircraft types',
          'Aviation safety',
          'ADS-B',
        ],
      },
    });
  } else if (meta.kind === 'aircraft-route') {
    graph.push({
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: `${BASE}/` },
        { '@type': 'ListItem', position: 2, name: 'Routes', item: `${BASE}/` },
        {
          '@type': 'ListItem',
          position: 3,
          name: `${meta.fromName} to ${meta.toName}`,
          item: `${BASE}/routes/${meta.pair}`,
        },
        { '@type': 'ListItem', position: 4, name: meta.aircraftLabel, item: meta.canonical },
      ],
    });
    graph.push({
      '@type': 'FAQPage',
      mainEntity: [
        {
          '@type': 'Question',
          name: `Which airlines fly the ${meta.aircraftLabel} from ${meta.fromIata} to ${meta.toIata}?`,
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'See the operators list on this page — it is compiled from open ADS-B observed-flights data updated nightly. Operators with the most recent observations are listed first.',
          },
        },
        {
          '@type': 'Question',
          name: `How often is the ${meta.aircraftLabel} used on the ${meta.fromIata} to ${meta.toIata} route?`,
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Observed model variants and date ranges are listed below. Aircraft assignments can change seasonally; data refreshes nightly.',
          },
        },
        {
          '@type': 'Question',
          name: `What is the typical schedule for ${meta.aircraftLabel} flights from ${meta.fromName} to ${meta.toName}?`,
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Schedules vary by operator. For live schedules and fares, search by aircraft on the FlightFinder home page.',
          },
        },
        {
          '@type': 'Question',
          name: 'Where does this data come from?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Operator and aircraft observations come from the adsb.lol open ADS-B network under the Open Database License. Data refreshes nightly.',
          },
        },
      ],
    });
  } else if (meta.kind === 'safety-event') {
    const ev = meta.eventData;
    if (ev) {
      graph.push({
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: `${BASE}/` },
          { '@type': 'ListItem', position: 2, name: 'Safety', item: `${BASE}/safety/global` },
          { '@type': 'ListItem', position: 3, name: 'NTSB feed', item: `${BASE}/safety/feed` },
          { '@type': 'ListItem', position: 4, name: meta.h1, item: meta.canonical },
        ],
      });
      graph.push({
        '@type': 'Article',
        headline: meta.title.replace(' | FlightFinder', ''),
        description: meta.description,
        url: meta.canonical,
        datePublished: new Date(ev.occurred_at).toISOString(),
        dateModified: new Date(ev.updated_at || ev.occurred_at).toISOString(),
        author: { '@type': 'Organization', name: 'FlightFinder', url: BASE },
        publisher: {
          '@type': 'Organization',
          name: 'FlightFinder',
          url: BASE,
          logo: { '@type': 'ImageObject', url: `${BASE}/og-image.png` },
        },
        isBasedOn: ev.report_url
          || (ev.source === 'ntsb' && ev.source_event_id
            ? `https://www.ntsb.gov/safety/Pages/safety-overview.aspx?ev=${ev.source_event_id}`
            : ev.source_event_id
              ? `https://www.wikidata.org/wiki/${ev.source_event_id}`
              : undefined),
        mainEntityOfPage: { '@type': 'WebPage', '@id': meta.canonical },
      });
    }
  } else if (
    meta.kind === 'aircraft-airlines'
    || meta.kind === 'aircraft-routes'
    || meta.kind === 'aircraft-safety'
    || meta.kind === 'aircraft-specs'
  ) {
    const subPageName = {
      'aircraft-airlines': 'Airlines',
      'aircraft-routes':   'Routes',
      'aircraft-safety':   'Safety',
      'aircraft-specs':    'Specifications',
    }[meta.kind];
    graph.push({
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home',        item: `${BASE}/` },
        { '@type': 'ListItem', position: 2, name: 'By aircraft', item: `${BASE}/by-aircraft` },
        {
          '@type': 'ListItem',
          position: 3,
          name: meta.aircraftLabel,
          item: `${BASE}/aircraft/${meta.slug}`,
        },
        { '@type': 'ListItem', position: 4, name: subPageName, item: meta.canonical },
      ],
    });
    graph.push({
      '@type': 'Vehicle',
      name: meta.aircraftLabel,
      vehicleConfiguration: 'Commercial aircraft',
      url: meta.canonical,
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
function inject(html, meta, bodyContent = null) {
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
  // Bake real per-route facts into #root for first-pass indexing. The client
  // uses createRoot().render() (not hydrateRoot), which wipes #root on mount,
  // so this section is invisible to JS-enabled users after hydration.
  // Idempotent: skip if a previous inject already ran on this html.
  // Match start tag specifically — substring 'data-seo-bake="true"' alone
  // also matches the CSS selector in client/index.html which would otherwise
  // silently disable bake in prod.
  if (bodyContent && !out.includes('<section data-seo-bake="true"')) {
    const subtitleClose = out.indexOf('</p>',
      out.indexOf('<p style="font-size:clamp(16px,2.2vw,20px)'));
    if (subtitleClose !== -1) {
      const insertAt = subtitleClose + '</p>'.length;
      const section  = `<section data-seo-bake="true">${bodyContent}</section>`;
      out = out.slice(0, insertAt) + section + out.slice(insertAt);
    } else {
      // Template no longer contains the subtitle anchor (redesign, minification,
      // style tweak). Surface it operationally — a silent skip would make all
      // baked content disappear from Googlebot responses with no visible signal.
      console.warn('[seoMetaService] bodyContent supplied but subtitle anchor missing — bake section skipped');
    }
  }
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
