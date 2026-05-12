'use strict';

// Dynamic OG image routes mounted at /og. Coexists with the static /og/*.png
// files served by client/public/og/ — Express tries this router first (mounted
// before express.static), so unknown paths fall through to the static handler.

const express = require('express');
const router  = express.Router();
const accidentOgImage = require('../services/accidentOgImage');

router.get('/accident/:slug.png', async (req, res) => {
  const slug = req.params.slug;
  if (!slug || slug.length > 120) return res.status(400).send('');
  try {
    const png = await accidentOgImage.buildOgImagePng(slug);
    if (!png) return res.status(404).send('');
    res.set('Content-Type', 'image/png');
    // 24h browser cache + 7d CF edge cache. PNG content is deterministic per
    // slug (sidecar facts + narrative are stable post-ingest) so immutable
    // is honest. If we ever change the template, we can bump a version path.
    res.set('Cache-Control', 'public, max-age=86400, s-maxage=604800, immutable');
    res.send(png);
  } catch (err) {
    console.error('[og-image] render failed for', slug, err.message);
    res.status(500).send('');
  }
});

module.exports = router;
