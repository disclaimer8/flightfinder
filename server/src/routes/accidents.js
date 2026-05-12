'use strict';
const express = require('express');
const router  = express.Router();
const svc     = require('../services/accidentNarrativeService');

const LOW_THRESHOLD      = 30;
const INDEXABLE_THRESHOLD = 50;

// List — must come before /:slug to avoid being caught by the catch-all
router.get('/', (req, res) => {
  const limit  = Math.min(parseInt(req.query.limit, 10) || 50, 200);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
  const rows = svc.listIndexable({ limit, offset });
  res.json({ data: rows, limit, offset });
});

// Bulk slug lookup — RecentSafetyEvents + /safety/global table use this to
// rewrite external "Source" links to internal /accidents/{slug} when an
// indexable narrative exists. Path is BEFORE /:slug to avoid catch-all.
// Query: ?ids=1,2,3,4,5 (CSV of sidecar accident_ids).
router.get('/slugs', (req, res) => {
  const raw = String(req.query.ids || '').trim();
  if (!raw) return res.json({});
  const ids = raw.split(',').map(s => s.trim()).filter(Boolean);
  res.set('Cache-Control', 'public, max-age=300');
  res.json(svc.slugsForIds(ids));
});

// Specific by numeric id — must come before /:slug
router.get('/by-id/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad id' });
  const data = svc.getById(id);
  if (!data) return res.status(404).json({ error: 'not found' });
  res.json(data);
});

// Catch-all slug — must come last
router.get('/:slug', (req, res) => {
  const slug = req.params.slug;
  if (!slug || slug.length > 120) return res.status(400).json({ error: 'bad slug' });

  const data = svc.getBySlug(slug);
  if (!data) return res.status(404).json({ error: 'not found' });

  if (data.quality_score < LOW_THRESHOLD) {
    res.set('Location', '/safety/global');
    return res.status(410).json({ error: 'gone', redirect: '/safety/global' });
  }

  res.json({
    ...data,
    noindex: data.quality_score < INDEXABLE_THRESHOLD,
  });
});

module.exports = router;
