// server/src/services/seoUrlEnumerator.js
const { getFamilyList } = require('../models/aircraftFamilies');

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

  return [...set];
}

module.exports = { enumerateSeoUrls, STATIC_PATHS };
