'use strict';

const HOST = 'himaxym.com';
const BASE = `https://${HOST}`;

function buildUrlSet(paths) {
  if (!Array.isArray(paths) || paths.length === 0) return [];
  const seen = new Set();
  const out = [];
  for (const p of paths) {
    if (typeof p !== 'string' || !p.startsWith('/')) continue;
    if (p.includes('?') || p.includes('#')) continue;
    const lower = p.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    out.push(`${BASE}${lower}`);
  }
  return out;
}

module.exports = { buildUrlSet };

if (require.main === module) {
  console.error('submit-indexnow: script-mode not yet implemented');
  process.exit(1);
}
