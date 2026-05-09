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
const { enumerateSeoUrls } = require('../services/seoUrlEnumerator');

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
    // Aircraft pillar subpages (/aircraft/{slug}/{sub}).
    if (p.startsWith('/aircraft/'))
                                 return { loc, changefreq: 'monthly', priority: '0.6', lastmod: deployDay };
    if (p.startsWith('/routes/')) return { loc, changefreq: 'weekly',  priority: '0.6', lastmod: today };
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
