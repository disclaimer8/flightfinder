// server/src/services/seoUrlEnumerator.js
const { getFamilyList } = require('../models/aircraftFamilies');
const { getAllVariants } = require('../models/aircraftVariants');

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

  return [...set];
}

module.exports = { enumerateSeoUrls, STATIC_PATHS };
