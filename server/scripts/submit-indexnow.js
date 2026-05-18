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

function classifyResponse(status) {
  if (status === 200 || status === 202) {
    return { ok: true, recoverable: true, exitCode: 0, label: 'ok' };
  }
  if (status === 422) {
    return { ok: false, recoverable: true, exitCode: 0, label: 'duplicate' };
  }
  if (status === 429) {
    return { ok: false, recoverable: true, exitCode: 0, label: 'rate-limited' };
  }
  if (status >= 500 && status < 600) {
    return { ok: false, recoverable: true, exitCode: 0, label: 'server-error' };
  }
  return { ok: false, recoverable: false, exitCode: 1, label: 'client-error' };
}

async function submitUrls(urls, key, opts = {}) {
  if (!Array.isArray(urls) || urls.length === 0) {
    throw new Error('submitUrls: empty urlList');
  }
  if (!key || typeof key !== 'string') {
    throw new Error('submitUrls: missing key');
  }
  const fetchFn = opts.fetch || globalThis.fetch;
  const body = {
    host: HOST,
    key,
    keyLocation: `${BASE}/${key}.txt`,
    urlList: urls,
  };
  const res = await fetchFn('https://api.indexnow.org/indexnow', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text };
}

module.exports = { buildUrlSet, filterIndexable, classifyResponse, submitUrls };

if (require.main === module) {
  console.error('submit-indexnow: script-mode not yet implemented');
  process.exit(1);
}
