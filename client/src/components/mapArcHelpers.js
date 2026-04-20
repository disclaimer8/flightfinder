// Shared map helpers for geodesic-arc canvas layers.
// Extracted from RouteMap.jsx so sibling components (AircraftRouteMap, etc.)
// can reuse the same great-circle maths without duplicating ~60 lines.

// ── Haversine great-circle distance (km) ────────────────────────────────────
export function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) *
    Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Great-circle intermediate points (for geodesic arcs) ────────────────────
export function geodesicPoints(lat1, lon1, lat2, lon2, steps = 80) {
  const rad = x => x * Math.PI / 180;
  const deg = x => x * 180 / Math.PI;
  const φ1 = rad(lat1), λ1 = rad(lon1);
  const φ2 = rad(lat2), λ2 = rad(lon2);
  const d = 2 * Math.asin(Math.sqrt(
    Math.sin((φ2 - φ1) / 2) ** 2 +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin((λ2 - λ1) / 2) ** 2
  ));
  if (d < 0.001) return [[lat1, lon1], [lat2, lon2]];
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const f = i / steps;
    const A = Math.sin((1 - f) * d) / Math.sin(d);
    const B = Math.sin(f * d) / Math.sin(d);
    const x = A * Math.cos(φ1) * Math.cos(λ1) + B * Math.cos(φ2) * Math.cos(λ2);
    const y = A * Math.cos(φ1) * Math.sin(λ1) + B * Math.cos(φ2) * Math.sin(λ2);
    const z = A * Math.sin(φ1) + B * Math.sin(φ2);
    pts.push([deg(Math.atan2(z, Math.sqrt(x ** 2 + y ** 2))), deg(Math.atan2(y, x))]);
  }
  return pts;
}

// 10-colour palette for distinguishing origins. Chosen to stay readable on
// a dark (#0d0d1a) basemap — avoid near-black and near-white.
export const ORIGIN_PALETTE = [
  '#6c8eff', // periwinkle blue
  '#34d399', // emerald
  '#f472b6', // pink
  '#fbbf24', // amber
  '#a78bfa', // violet
  '#fb923c', // orange
  '#22d3ee', // cyan
  '#f87171', // coral red
  '#4ade80', // green
  '#e879f9', // fuchsia
];
