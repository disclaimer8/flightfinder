'use strict';

const SITE = 'https://himaxym.com';

function escapeHtml(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Lowercased "ord-lhr" slug for /routes/:slug URLs. Callers should supply
// valid IATA codes; no null handling — caller's responsibility.
function routeSlug(origin, dest) {
  return `${String(origin).toLowerCase()}-${String(dest).toLowerCase()}`;
}

// Singular/plural grammar — never render "1 routes" or "1 airports".
function routeLabel(n) {
  return `${n} ${n === 1 ? 'route' : 'routes'}`;
}

function airportLabel(n) {
  return `${n} ${n === 1 ? 'airport' : 'airports'}`;
}

module.exports = { SITE, escapeHtml, routeSlug, routeLabel, airportLabel };

