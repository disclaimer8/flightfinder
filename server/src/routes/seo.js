/**
 * SEO endpoints — sitemap.xml is generated dynamically from the aircraft
 * family catalogue and the hub-network edge list. That way every new
 * family we add to models/aircraftFamilies.js, and every route that
 * crosses the hub-network threshold, becomes crawlable without a code
 * change.
 */
const fs = require('fs');
const path = require('path');
const express = require('express');
const { enumerateSeoUrls, enumerateAirlineAircraftMatrix } = require('../services/seoUrlEnumerator');

const router = express.Router();

const BASE = 'https://himaxym.com';
const TODAY = () => new Date().toISOString().slice(0, 10);

// Code-deploy lastmod for static surfaces — uses the mtime of THIS file as
// a proxy for "last meaningful site update". Less honest than per-URL real
// timestamps, but more truthful than emitting today's date for every URL
// (Google ignores uniform `<lastmod>` values as a low-trust signal).
function deployLastmod() {
  try {
    return fs.statSync(__filename).mtime.toISOString().slice(0, 10);
  } catch {
    return TODAY();
  }
}

// Aircraft families catalogue lastmod — mtime of the model file. When the
// catalogue changes (new family added), aircraft URLs all get a fresh
// lastmod, which is the actual semantic event we want crawlers to notice.
function aircraftCatalogueLastmod() {
  try {
    return fs.statSync(path.join(__dirname, '..', 'models', 'aircraftFamilies.js'))
      .mtime.toISOString().slice(0, 10);
  } catch {
    return deployLastmod();
  }
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c])
);

router.get('/sitemap.xml', async (_req, res) => {
  const deployDay   = deployLastmod();
  const aircraftDay = aircraftCatalogueLastmod();
  const today       = TODAY();

  // Per-pair route lastmod from real ADS-B observation timestamps. Lets each
  // /routes/{a}-{b} URL ship its actual last-observed date instead of every
  // route claiming `today`, which Google treats as a low-trust signal.
  let routeLastSeen = new Map();
  try {
    routeLastSeen = require('../models/db').getRouteLastSeenMap();
  } catch (err) {
    console.warn('[seo] routeLastSeenMap unavailable, falling back to today:', err.message);
  }
  function routeLastmod(p) {
    // Path shape: /routes/AAA-BBB or /routes/AAA-BBB/{aircraft-slug}
    const m = p.match(/^\/routes\/([a-z]{3})-([a-z]{3})(\/|$)/i);
    if (!m) return today;
    const pair = `${m[1].toUpperCase()}-${m[2].toUpperCase()}`;
    const epoch = routeLastSeen.get(pair);
    return Number.isFinite(epoch) ? new Date(epoch).toISOString().slice(0, 10) : today;
  }

  // Canonical path list — single source of truth shared with seoContentCache.
  // Aircraft subpages (/aircraft/{slug}/airlines etc.) and hub-network routes
  // are included by enumerateSeoUrls so both the sitemap and future cache
  // stay in sync without separate maintenance.
  const paths = enumerateSeoUrls();
  const urls = paths.map((p) => {
    const loc = `${BASE}${p}`;
    if (p === '/')               return { loc, changefreq: 'weekly',  priority: '1.0', lastmod: deployDay };
    if (p === '/by-aircraft')    return { loc, changefreq: 'weekly',  priority: '0.9', lastmod: aircraftDay };
    if (p === '/map')            return { loc, changefreq: 'weekly',  priority: '0.8', lastmod: deployDay };
    if (p === '/safety/global')  return { loc, changefreq: 'weekly',  priority: '0.8', lastmod: today };
    if (p === '/safety/feed')    return { loc, changefreq: 'daily',   priority: '0.7', lastmod: today };
    if (p === '/pricing')        return { loc, changefreq: 'monthly', priority: '0.6', lastmod: deployDay };
    if (p === '/about')          return { loc, changefreq: 'monthly', priority: '0.5', lastmod: deployDay };
    // Aircraft family landing pages (/aircraft/{slug} — no trailing subpage segment).
    if (/^\/aircraft\/[^/]+$/.test(p))
                                 return { loc, changefreq: 'weekly',  priority: '0.7', lastmod: aircraftDay };
    // Aircraft variant pages (/aircraft/{family}/variants/{variant}).
    if (/^\/aircraft\/[^/]+\/variants\/[^/]+$/.test(p))
                                 return { loc, changefreq: 'weekly',  priority: '0.6', lastmod: aircraftDay };
    // Aircraft pillar subpages (/aircraft/{slug}/{sub}).
    if (p.startsWith('/aircraft/'))
                                 return { loc, changefreq: 'monthly', priority: '0.6', lastmod: deployDay };
    if (p.startsWith('/routes/')) return { loc, changefreq: 'weekly',  priority: '0.6', lastmod: routeLastmod(p) };
    if (p.startsWith('/airport/')) return { loc, changefreq: 'monthly', priority: '0.6', lastmod: today };
    if (p.startsWith('/airline/')) return { loc, changefreq: 'monthly', priority: '0.6', lastmod: today };
    return { loc, changefreq: 'weekly', priority: '0.5', lastmod: today };
  });

  // Indexable safety events — fatal/hull_loss with narrative or ≥3 related events.
  // Capped at 500 for sitemap hygiene; excess events still get unique meta when accessed.
  try {
    const safetyModel = require('../models/safetyEvents');
    const { buildEventSlug } = require('../utils/eventSlug');
    const indexable = safetyModel.listIndexable({ limit: 500 });
    for (const ev of indexable) {
      urls.push({
        loc: `${BASE}/safety/events/${buildEventSlug(ev)}`,
        changefreq: 'monthly',
        priority: '0.5',
        lastmod: new Date(ev.updated_at || ev.occurred_at).toISOString().slice(0, 10),
      });
    }
    if (indexable.length > 0) {
      console.log(`[seo] ${indexable.length} indexable safety events added to sitemap`);
    }
  } catch (err) {
    console.warn('[seo] indexable safety events unavailable for sitemap:', err.message);
  }

  // Aircraft × Route programmatic grid — qualifying combos in last 90d + editorial whitelist.
  // Capped at 10K for sitemap hygiene.
  try {
    const aircraftRouteSvc = require('../services/aircraftRouteService');
    const combos = aircraftRouteSvc.listQualifying({ limit: 10000 });
    for (const c of combos) {
      urls.push({
        loc: `${BASE}/routes/${c.from_iata}-${c.to_iata}/${c.slug}`,
        changefreq: 'weekly',
        priority: '0.5',
        lastmod: today,
      });
    }
  } catch (err) {
    console.warn('[seo] aircraft-route grid unavailable for sitemap:', err.message);
  }

  // Airline × Aircraft matrix pages — (airline, aircraft) combos with >= 5 routes.
  try {
    const matrixEntries = enumerateAirlineAircraftMatrix();
    urls.push(...matrixEntries);
    if (process.env.NODE_ENV !== 'test' && matrixEntries.length > 0) {
      console.log(`[seo] ${matrixEntries.length} airline-aircraft matrix pages added to sitemap`);
    }
  } catch (err) {
    console.warn('[seo] airline-aircraft matrix unavailable for sitemap:', err.message);
  }

  // /routes/{from}-{to} pairs meeting enrichment threshold (>=3 operators OR >=2 aircraft).
  try {
    const { enumerateRouteMatrix } = require('../services/seoUrlEnumerator');
    const routeEntries = enumerateRouteMatrix();
    urls.push(...routeEntries);
    if (process.env.NODE_ENV !== 'test' && routeEntries.length > 0) {
      console.log(`[seo] ${routeEntries.length} enriched route pairs added to sitemap`);
    }
  } catch (err) {
    console.warn('[seo] enriched route pairs unavailable for sitemap:', err.message);
  }

  // Accident narrative pages — indexable=1 rows from accident_narratives.
  try {
    const enumerator = require('../services/seoUrlEnumerator');
    if (typeof enumerator.enumerateAccidents === 'function') {
      const accidentEntries = enumerator.enumerateAccidents();
      urls.push(...accidentEntries);
      if (process.env.NODE_ENV !== 'test') {
        console.log(`[seo] ${accidentEntries.length} accident pages added to sitemap`);
      }
    }
  } catch (err) {
    console.warn('[seo] enumerateAccidents unavailable for sitemap:', err.message);
  }

  // Phase 1 SEO landing pages (jonty.db-backed) — /flights-from, /flights-to,
  // /airline/:iata, /airline/:iata/from/:airport.
  // Memory `seo-bake-invariants`: every URL here must build via buildAsync.
  // Coupling guarded by builderEnumeratorCoupling.test.js.
  try {
    const p1 = require('../services/seoUrlEnumerator');
    const lc = (u) => u.toLowerCase(); // canonical FF URLs are lowercase
    const airportLandings = p1.enumerateAirportLandingUrls();
    for (const u of airportLandings) {
      urls.push({ loc: `${BASE}${lc(u)}`, changefreq: 'weekly', priority: '0.6', lastmod: today });
    }
    const airlineNets = p1.enumerateAirlineNetworkUrls();
    for (const u of airlineNets) {
      urls.push({ loc: `${BASE}${lc(u)}`, changefreq: 'weekly', priority: '0.6', lastmod: today });
    }
    const airlineAirports = p1.enumerateAirlineAirportUrls().slice(0, 30000);
    for (const u of airlineAirports) {
      urls.push({ loc: `${BASE}${lc(u)}`, changefreq: 'weekly', priority: '0.5', lastmod: today });
    }
    const alliances = p1.enumerateAllianceUrls();
    for (const u of alliances) {
      urls.push({ loc: `${BASE}${lc(u)}`, changefreq: 'weekly', priority: '0.5', lastmod: today });
    }
    if (process.env.NODE_ENV !== 'test') {
      console.log(`[seo] P1 sitemap: +${airportLandings.length} airport-landing, +${airlineNets.length} airline-network, +${airlineAirports.length} airline-airport, +${alliances.length} alliance`);
    }
  } catch (err) {
    console.warn('[seo] P1 sitemap enumerators unavailable:', err.message);
  }

  // Dedupe by lowercase loc to handle overlap between enumerateSeoUrls() top-100
  // airlines and the new P1 enumerateAirlineNetworkUrls (both emit /airline/:iata).
  // Keep first occurrence (sitemap order = priority hint to crawlers).
  {
    const seen = new Set();
    const deduped = [];
    for (const u of urls) {
      const k = u.loc.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      deduped.push(u);
    }
    urls.length = 0;
    urls.push(...deduped);
  }

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls.map((u) =>
      `  <url><loc>${esc(u.loc)}</loc><lastmod>${u.lastmod}</lastmod><changefreq>${u.changefreq}</changefreq><priority>${u.priority}</priority></url>`
    ),
    '</urlset>',
    '',
  ].join('\n');

  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.send(xml);
});

module.exports = router;
