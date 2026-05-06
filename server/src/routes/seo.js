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
const { getFamilyList } = require('../models/aircraftFamilies');

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

  const urls = [
    { loc: `${BASE}/`,              changefreq: 'weekly',  priority: '1.0', lastmod: deployDay },
    { loc: `${BASE}/by-aircraft`,   changefreq: 'weekly',  priority: '0.9', lastmod: aircraftDay },
    { loc: `${BASE}/map`,           changefreq: 'weekly',  priority: '0.8', lastmod: deployDay },
    { loc: `${BASE}/safety/global`, changefreq: 'weekly',  priority: '0.8', lastmod: today },
    { loc: `${BASE}/safety/feed`,   changefreq: 'daily',   priority: '0.7', lastmod: today },
    { loc: `${BASE}/pricing`,       changefreq: 'monthly', priority: '0.6', lastmod: deployDay },
  ];

  // Aircraft landing pages — /aircraft/:slug for every family we support.
  // Lastmod tracks the catalogue file so a new family triggers a fresh
  // crawl invitation across all aircraft URLs.
  for (const fam of getFamilyList()) {
    urls.push({
      loc: `${BASE}/aircraft/${fam.slug}`,
      changefreq: 'weekly',
      priority: '0.7',
      lastmod: aircraftDay,
    });
  }

  // Route landing pages — top 100 hub-network edges. We read the already
  // cached map payload; if the cache is cold or the DB is empty (observed_
  // routes still warming up), we silently skip — the aircraft pages alone
  // carry enough long-tail weight for a first sitemap.
  try {
    const db = require('../models/db');
    const { edges = [] } = db.getHubNetwork?.({ hubLimit: 200, minDests: 15, edgeLimit: 100 }) || {};
    for (const [from, to] of edges) {
      urls.push({
        loc: `${BASE}/routes/${from.toLowerCase()}-${to.toLowerCase()}`,
        changefreq: 'weekly',
        priority: '0.6',
        lastmod: today,
      });
    }
  } catch (err) {
    console.warn('[seo] hub-network edges unavailable for sitemap:', err.message);
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
