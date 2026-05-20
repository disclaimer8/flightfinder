'use strict';

/**
 * Compute "degree" (number of distinct route entries touching this airport)
 * for every IATA in the routes list. Duplicates count — caller can dedupe
 * the routes list first if needed.
 *
 * @param {Array<{dep:{iata}, arr:{iata}}>} routes
 * @returns {Map<string, number>}
 */
export function computeDegree(routes) {
  const degree = new Map();
  if (!Array.isArray(routes)) return degree;
  for (const r of routes) {
    if (!r?.dep?.iata || !r?.arr?.iata) continue;
    degree.set(r.dep.iata, (degree.get(r.dep.iata) || 0) + 1);
    degree.set(r.arr.iata, (degree.get(r.arr.iata) || 0) + 1);
  }
  return degree;
}

/**
 * Visibility culling: at low zoom show only top hubs.
 *
 *   zoom <= 3   → top 200 by degree
 *   zoom 4-5    → top 1000 by degree
 *   zoom >= 6   → all
 *
 * Input airports MUST already carry a `degree` field (use enrichAirportsWithDegree).
 *
 * @param {Array<{iata, degree}>} airports
 * @param {number} zoom
 * @returns {Array}
 */
export function filterByZoom(airports, zoom) {
  if (!Array.isArray(airports)) return [];
  const sorted = [...airports].sort((a, b) => (b.degree || 0) - (a.degree || 0));
  if (zoom <= 3) return sorted.slice(0, 200);
  if (zoom <= 5) return sorted.slice(0, 1000);
  return sorted;
}

/**
 * Convenience: enrich an airport list with degree from a routes list.
 *
 * @param {Array} airports
 * @param {Array} routes
 * @returns {Array}
 */
export function enrichAirportsWithDegree(airports, routes) {
  const degree = computeDegree(routes);
  return (airports || []).map(a => ({ ...a, degree: degree.get(a.iata) || 0 }));
}

/**
 * Filter routes for rendering.
 *
 * Server already filters by airline/aircraft at fetch time, so this is mainly
 * a visibility-cull against the currently-visible airport set (zoom-driven).
 *
 * @param {Array} routes
 * @param {{airline:string|null, aircraft:string|null}} _filters  (reserved for future client-side use)
 * @param {Set<string>=} visibleIatas  if provided, only routes whose dep AND arr are in this set pass
 * @returns {Array}
 */
export function filterRoutes(routes, _filters, visibleIatas) {
  if (!Array.isArray(routes)) return [];
  if (!visibleIatas) return routes;
  return routes.filter(r => visibleIatas.has(r.dep?.iata) && visibleIatas.has(r.arr?.iata));
}

/**
 * Return up to K top destinations from `origin`, sorted by route count.
 * Considers both r.dep.iata===origin (counts arr) and r.arr.iata===origin (counts dep)
 * since `observed_routes` is unordered.
 *
 * @param {Array} routes
 * @param {string} origin  IATA
 * @param {number} k
 * @returns {Array<{iata:string, count:number}>}
 */
export function topDestinations(routes, origin, k) {
  if (!Array.isArray(routes) || !origin) return [];
  const counts = new Map();
  for (const r of routes) {
    if (r?.dep?.iata === origin && r?.arr?.iata) {
      counts.set(r.arr.iata, (counts.get(r.arr.iata) || 0) + 1);
    } else if (r?.arr?.iata === origin && r?.dep?.iata) {
      counts.set(r.dep.iata, (counts.get(r.dep.iata) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([iata, count]) => ({ iata, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, k);
}
