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

function filterIndexable(paths) {
  let seoMeta;
  try { seoMeta = require('../src/services/seoMetaService'); }
  catch { return paths; }
  return paths.filter((p) => {
    let meta;
    try { meta = seoMeta.resolve(p); } catch { return true; }
    if (!meta) return true;
    if (typeof meta.robots === 'string' && /noindex/i.test(meta.robots)) return false;
    return true;
  });
}

module.exports = { buildUrlSet, filterIndexable };

if (require.main === module) {
  console.error('submit-indexnow: script-mode not yet implemented');
  process.exit(1);
}
