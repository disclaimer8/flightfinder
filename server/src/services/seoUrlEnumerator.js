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
    for (const [from, to] of edges) {
      set.add(`/routes/${from.toLowerCase()}-${to.toLowerCase()}`);
    }
  } catch {
    // DB cold or empty — sitemap also tolerates this; static paths still ship.
  }

  return [...set];
}

module.exports = { enumerateSeoUrls, STATIC_PATHS };
