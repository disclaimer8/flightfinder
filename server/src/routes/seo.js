/**
 * SEO endpoints — sitemap.xml is generated dynamically from the aircraft
 * family catalogue and the hub-network edge list. That way every new
 * family we add to models/aircraftFamilies.js, and every route that
 * crosses the hub-network threshold, becomes crawlable without a code
 * change.
 */
const express = require('express');
const { getFamilyList } = require('../models/aircraftFamilies');

const router = express.Router();

const BASE = 'https://himaxym.com';
const TODAY = () => new Date().toISOString().slice(0, 10);

const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c])
);

router.get('/sitemap.xml', async (_req, res) => {
  const urls = [
    { loc: `${BASE}/`,              changefreq: 'weekly',  priority: '1.0' },
    { loc: `${BASE}/by-aircraft`,   changefreq: 'weekly',  priority: '0.9' },
    { loc: `${BASE}/map`,           changefreq: 'weekly',  priority: '0.8' },
  ];

  // Aircraft landing pages — /aircraft/:slug for every family we support.
  for (const fam of getFamilyList()) {
    urls.push({
      loc: `${BASE}/aircraft/${fam.slug}`,
      changefreq: 'weekly',
      priority: '0.7',
    });
  }

  // Route landing pages — top 100 hub-network edges. We read the already
  // cached map payload; if the cache is cold or the DB is empty (observed_
  // routes still warming up), we silently skip — the aircraft pages alone
  // carry enough long-tail weight for a first sitemap.
  try {
    const db = require('../models/db');
    const { edges = [] } = db.getHubNetwork?.({ hubLimit: 200, minDests: 5, edgeLimit: 100 }) || {};
    for (const [from, to] of edges) {
      urls.push({
        loc: `${BASE}/routes/${from.toLowerCase()}-${to.toLowerCase()}`,
        changefreq: 'weekly',
        priority: '0.6',
      });
    }
  } catch (err) {
    console.warn('[seo] hub-network edges unavailable for sitemap:', err.message);
  }

  const today = TODAY();
  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls.map((u) =>
      `  <url><loc>${esc(u.loc)}</loc><lastmod>${today}</lastmod><changefreq>${u.changefreq}</changefreq><priority>${u.priority}</priority></url>`
    ),
    '</urlset>',
    '',
  ].join('\n');

  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.send(xml);
});

module.exports = router;
