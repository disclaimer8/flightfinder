// server/src/services/seoUrlEnumerator.js
const { getFamilyList } = require('../models/aircraftFamilies');
const { getAllVariants } = require('../models/aircraftVariants');

const BASE = 'https://himaxym.com';

const STATIC_PATHS = [
  '/',
  '/by-aircraft',
  '/map',
  '/safety/global',
  '/safety/feed',
  '/pricing',
  '/about',
];

/**
 * Canonical list of indexable site paths. Single source of truth — both
 * /sitemap.xml and seoContentCache iterate this list. Adding a new
 * indexable URL means adding it here.
 *
 * @param {object} [opts]
 * @param {object} [opts.db] — db module override for testing; defaults to ../models/db
 * @returns {string[]} deduplicated paths starting with '/'
 */
function enumerateSeoUrls(opts = {}) {
  const db = opts.db || require('../models/db');
  const set = new Set(STATIC_PATHS);

  // /aircraft/{slug} per family
  for (const fam of getFamilyList()) {
    set.add(`/aircraft/${fam.slug}`);
    // Subpages — kept here so cache and sitemap stay aligned.
    set.add(`/aircraft/${fam.slug}/airlines`);
    set.add(`/aircraft/${fam.slug}/routes`);
    set.add(`/aircraft/${fam.slug}/safety`);
    set.add(`/aircraft/${fam.slug}/specs`);
  }

  // Variant landing pages — one per entry in aircraftVariants.js
  for (const v of getAllVariants()) {
    set.add(`/aircraft/${v.familySlug}/variants/${v.slug}`);
  }

  // Top hub-network route pages — same call shape used by routes/seo.js
  try {
    const { edges = [] } = db.getHubNetwork?.({
      hubLimit: 200, minDests: 15, edgeLimit: 100,
    }) || {};
    for (const [a, b] of edges) {
      // Each direction is a distinct indexable URL — users search both
      // "A to B" and "B to A" with different intents, and bRoute queries
      // the directional table observed_routes(dep_iata, arr_iata).
      set.add(`/routes/${a.toLowerCase()}-${b.toLowerCase()}`);
      set.add(`/routes/${b.toLowerCase()}-${a.toLowerCase()}`);
    }
  } catch (err) {
    // DB cold or empty — sitemap tolerates this; static paths still ship.
    // Log so a non-cold-start failure (schema migration, broken prepared
    // statement) is visible in operational logs.
    console.warn('[seoUrlEnumerator] hub-network edges unavailable:', err.message);
  }

  // Aircraft × Route programmatic grid — same listQualifying call used by
  // sitemap (routes/seo.js). Cache.warm must include these or spaFallback
  // returns an unbaked React shell → Google flags Soft 404. Cap at 10K
  // to match sitemap. ~10K extra warm operations per cycle — small SQL.
  try {
    const combos = require('./aircraftRouteService').listQualifying({ limit: 10000 });
    for (const c of combos) {
      set.add(`/routes/${c.from_iata.toLowerCase()}-${c.to_iata.toLowerCase()}/${c.slug}`);
    }
  } catch (err) {
    console.warn('[seoUrlEnumerator] aircraft-route combos unavailable:', err.message);
  }

  // /airport/{iata} for top airports by observed activity. Source for the
  // amadeus_cache pre-warm (airport_direct_dest endpoint).
  try {
    const airports = db.getTopAirportsByObservedActivity?.({ limit: 200 }) ?? [];
    for (const a of airports) {
      if (a?.iata) set.add(`/airport/${String(a.iata).toLowerCase()}`);
    }
  } catch (err) {
    console.warn('[seoUrlEnumerator] top airports unavailable:', err.message);
  }

  // /airline/{iata} for top airlines by observed flight count.
  try {
    const airlines = db.getTopAirlinesByObservedActivity?.({ limit: 100 }) ?? [];
    for (const al of airlines) {
      if (al?.iata) set.add(`/airline/${String(al.iata).toLowerCase()}`);
    }
  } catch (err) {
    console.warn('[seoUrlEnumerator] top airlines unavailable:', err.message);
  }

  // NOTE: /accidents/{slug} pages (~22K) are deliberately NOT pre-warmed —
  // baking that many entries synchronously during boot blocks the event loop
  // long enough that PM2's wait_ready + the deploy.yml health check both
  // time out (verified empirically: 9-min deploy lockup). Bots get the
  // baked <head> (title, description, canonical, JSON-LD Event with
  // ISO startDate) which is enough for rich SERP results; body content
  // hydrates via React CSR + /api/accidents fetch. A future TTL'd lazy-bake
  // in seoContentCache.get() can promote these on-demand.

  return [...set];
}

/**
 * Returns sitemap entries for all valid airline × aircraft matrix pages.
 * Uses listValidCombinations with default 90-day window and minPairs:5.
 *
 * @returns {Array<{loc, priority, changefreq, lastmod}>}
 */
function enumerateAirlineAircraftMatrix() {
  try {
    const combos = require('./airlineAircraftService').listValidCombinations({ minPairs: 5 });
    const today = new Date().toISOString().slice(0, 10);
    return combos.map(c => ({
      // Lowercase to match canonical emitted by airlineAircraftMeta —
      // sitemap loc and canonical disagreeing on case is a soft SEO smell.
      loc:        `${BASE}/airline/${String(c.iata).toLowerCase()}/aircraft/${String(c.icao_aircraft).toLowerCase()}`,
      priority:   '0.5',
      changefreq: 'weekly',
      lastmod:    today,
    }));
  } catch (err) {
    console.warn('[seoUrlEnumerator] airline-aircraft matrix unavailable:', err.message);
    return [];
  }
}

/**
 * Returns sitemap entries for all valid route pairs meeting the threshold
 * (≥3 distinct operators OR ≥2 distinct aircraft types over 90 days).
 * Mirrors the pattern of enumerateAirlineAircraftMatrix.
 *
 * @returns {Array<{loc, priority, changefreq, lastmod}>}
 */
function enumerateRouteMatrix() {
  try {
    const routeService = require('./routeService');
    const pairs = routeService.listValidRoutePairs({ minOperators: 3, minAircraft: 2 });
    const today = new Date().toISOString().slice(0, 10);
    return pairs.map(p => ({
      loc:        `${BASE}/routes/${p.from.toLowerCase()}-${p.to.toLowerCase()}`,
      priority:   '0.5',
      changefreq: 'weekly',
      lastmod:    today,
    }));
  } catch (err) {
    console.warn('[seoUrlEnumerator] route-matrix unavailable:', err.message);
    return [];
  }
}

function enumerateAccidents() {
  const { db } = require('../models/db');
  const rows = db.prepare(`
    SELECT slug, updated_at FROM accident_narratives
    WHERE indexable = 1
    ORDER BY updated_at DESC
    LIMIT 50000
  `).all();
  const BASE = 'https://himaxym.com';
  return rows.map(r => ({
    loc:        `${BASE}/accidents/${r.slug}`,
    lastmod:    new Date((r.updated_at || 0) * 1000).toISOString().slice(0, 10),
    changefreq: 'monthly',
    priority:   '0.6',
  }));
}

function enumerateSafetyEvents() {
  try {
    const safetyModel = require('../models/safetyEvents');
    const { buildEventSlug } = require('../utils/eventSlug');
    const indexable = safetyModel.listIndexable({ limit: 500 });
    return indexable.map((ev) => `/safety/events/${buildEventSlug(ev)}`);
  } catch {
    return [];
  }
}

// Phase 1 SEO landing pages — jonty.db-backed enumerators.
// Memory `lazy-bake-regex-sync` & `seo-bake-invariants`: every URL these
// emit MUST resolve via seoMeta and build via seoContentBuilders.buildAsync.
// Task 15 has a coupling cross-check test that enforces this contract.
function enumerateAirportLandingUrls() {
  const stage = require('./seoP1Stage');
  const db = require('../models/jontyDb').getDb();
  const allIatas = db.prepare(`SELECT iata FROM airports ORDER BY iata`).all().map(r => r.iata);
  const iatas = stage.filterAirports(allIatas);
  const out = [];
  for (const iata of iatas) {
    out.push(`/flights-from/${iata}`);
    out.push(`/flights-to/${iata}`);
  }
  return out;
}

function enumerateAirlineNetworkUrls() {
  const db = require('../models/jontyDb').getDb();
  return db.prepare(`SELECT DISTINCT carrier_iata FROM route_carriers ORDER BY carrier_iata`)
    .all()
    .map(r => `/airline/${r.carrier_iata}`);
}

function enumerateAirlineAirportUrls() {
  const stage = require('./seoP1Stage');
  const db = require('../models/jontyDb').getDb();
  const rows = db.prepare(`SELECT DISTINCT carrier_iata, origin_iata FROM route_carriers ORDER BY carrier_iata, origin_iata`).all();
  return rows
    .filter(r => stage.shouldEnumerate(r.origin_iata))
    .map(r => `/airline/${r.carrier_iata}/from/${r.origin_iata}`);
}

function enumerateAllianceUrls() {
  const alliances = require('../data/alliances.json');
  return Object.keys(alliances).map(slug => `/alliance/${slug}`);
}

// Wave 3b: one URL per distinct ISO 3166-1 alpha-2 country_code in jonty.
// Hits idx_airports_country (sync-jonty.js SCHEMA) for cheap DISTINCT.
function enumerateCountryUrls() {
  const db = require('../models/jontyDb').getDb();
  return db.prepare(`SELECT DISTINCT country_code FROM airports WHERE country_code IS NOT NULL ORDER BY country_code`)
    .all()
    .map(r => `/country/${r.country_code}`);
}

module.exports = {
  enumerateSeoUrls,
  enumerateAccidents,
  enumerateSafetyEvents,
  enumerateAirlineAircraftMatrix,
  enumerateRouteMatrix,
  STATIC_PATHS,
  // Phase 1:
  enumerateAirportLandingUrls,
  enumerateAirlineNetworkUrls,
  enumerateAirlineAirportUrls,
  // Phase 2 Wave 3a:
  enumerateAllianceUrls,
  // Phase 2 Wave 3b:
  enumerateCountryUrls,
};
