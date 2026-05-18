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
  if (status === 403) {
    // SiteVerificationNotCompleted — transient race on first POST before
    // Bing has fetched /${KEY}.txt. Self-resolves within minutes; next
    // cron retries and succeeds. Treat as recoverable to avoid noise.
    return { ok: false, recoverable: true, exitCode: 0, label: 'verification-pending' };
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

const SEO_PATH_PATTERNS = [
  /^server\/src\/services\/seo/i,
  /^server\/src\/services\/.*Builder\.js$/i,
  /^server\/src\/services\/jonty/i,
  /^server\/src\/services\/openFlightsService/i,
  /^server\/src\/services\/allianceBuilder\.js$/i,
  /^server\/src\/services\/countryBuilder\.js$/i,
  /^server\/src\/routes\/seo\.js$/i,
  /^server\/src\/data\//i,
  /^server\/scripts\/sync-jonty\.js$/i,
];

function shouldSubmitOnDeploy(changedPaths) {
  if (!Array.isArray(changedPaths) || changedPaths.length === 0) return false;
  return changedPaths.some((p) => SEO_PATH_PATTERNS.some((rx) => rx.test(p)));
}

module.exports = { buildUrlSet, filterIndexable, classifyResponse, submitUrls, shouldSubmitOnDeploy };

async function main(argv = process.argv.slice(2)) {
  const mode = (argv.find((a) => a.startsWith('--mode='))?.split('=')[1]) || 'dry-run';

  const key = process.env.INDEXNOW_KEY;
  if (!key) {
    console.error('[indexnow] INDEXNOW_KEY env not set; exit 1');
    return 1;
  }
  if (!/^[a-f0-9]{16,128}$/i.test(key)) {
    console.error('[indexnow] INDEXNOW_KEY malformed (must be 16-128 hex chars); exit 1');
    return 1;
  }

  if (mode === 'deploy') {
    let changedPaths = [];
    try {
      const { execSync } = require('child_process');
      const out = execSync('git diff --name-only HEAD~1 HEAD', { encoding: 'utf8' });
      changedPaths = out.split('\n').filter(Boolean);
    } catch (err) {
      console.warn('[indexnow] git diff failed; proceeding with submission:', err.message);
    }
    if (changedPaths.length && !shouldSubmitOnDeploy(changedPaths)) {
      console.log(`[indexnow] mode=deploy skip — no SEO-affecting files in HEAD~1..HEAD (${changedPaths.length} files changed)`);
      return 0;
    }
  }

  let paths;
  try {
    const enumerator = require('../src/services/seoUrlEnumerator');
    paths = enumerator.enumerateSeoUrls();
  } catch (err) {
    console.error('[indexnow] enumerator failed:', err.message);
    return 1;
  }

  try {
    const e = require('../src/services/seoUrlEnumerator');
    if (typeof e.enumerateAccidents === 'function') {
      paths.push(...e.enumerateAccidents().map(x => typeof x === 'string' ? x : x.loc?.replace('https://himaxym.com','')).filter(Boolean));
    }
    if (typeof e.enumerateAirlineAircraftMatrix === 'function') {
      paths.push(...e.enumerateAirlineAircraftMatrix().map(x => typeof x === 'string' ? x : x.loc?.replace('https://himaxym.com','')).filter(Boolean));
    }
    if (typeof e.enumerateRouteMatrix === 'function') {
      paths.push(...e.enumerateRouteMatrix().map(x => typeof x === 'string' ? x : x.loc?.replace('https://himaxym.com','')).filter(Boolean));
    }
    if (typeof e.enumerateAirportLandingUrls === 'function') paths.push(...e.enumerateAirportLandingUrls());
    if (typeof e.enumerateAirlineNetworkUrls === 'function') paths.push(...e.enumerateAirlineNetworkUrls());
    if (typeof e.enumerateAirlineAirportUrls === 'function') paths.push(...e.enumerateAirlineAirportUrls());
    if (typeof e.enumerateAllianceUrls === 'function') paths.push(...e.enumerateAllianceUrls());
    if (typeof e.enumerateCountryUrls === 'function') paths.push(...e.enumerateCountryUrls());
    if (typeof e.enumerateSafetyEvents === 'function') paths.push(...e.enumerateSafetyEvents());
  } catch (err) {
    console.warn('[indexnow] supplemental enumerators failed (continuing):', err.message);
  }

  const filtered = filterIndexable(paths);
  const urls = buildUrlSet(filtered);

  if (urls.length === 0) {
    console.error('[indexnow] no URLs to submit; exit 1');
    return 1;
  }

  if (mode === 'dry-run') {
    console.log(`[indexnow] mode=dry-run count=${urls.length}`);
    console.log('[indexnow] first 20:');
    urls.slice(0, 20).forEach((u) => console.log(`  ${u}`));
    return 0;
  }

  const BATCH_SIZE = 10000;
  const batches = [];
  for (let i = 0; i < urls.length; i += BATCH_SIZE) {
    batches.push(urls.slice(i, i + BATCH_SIZE));
  }

  let worstExitCode = 0;
  const ts = new Date().toISOString();
  console.log(`[${ts}] [indexnow] mode=${mode} total=${urls.length} batches=${batches.length}`);

  for (let b = 0; b < batches.length; b++) {
    const batch = batches[b];
    let result;
    try {
      result = await submitUrls(batch, key);
    } catch (err) {
      console.error(`[indexnow] batch ${b + 1}/${batches.length} threw: ${err.message}`);
      continue; // network error on one batch — try the next
    }
    const cls = classifyResponse(result.status);
    console.log(`[indexnow] batch ${b + 1}/${batches.length} count=${batch.length} status=${result.status} ${cls.label} ok=${cls.ok}`);
    if (!cls.ok) {
      const snippet = (result.body || '').slice(0, 500);
      console.log(`[indexnow] batch ${b + 1} response body (first 500 chars): ${snippet}`);
    }
    // Worst exit code wins (so misconfig in any batch surfaces; recoverable
    // failures are dominated by any success)
    if (cls.exitCode > worstExitCode) worstExitCode = cls.exitCode;
  }

  return worstExitCode;
}

module.exports.main = main;

if (require.main === module) {
  main().then((code) => process.exit(code)).catch((err) => {
    console.error('[indexnow] uncaught:', err);
    process.exit(1);
  });
}
