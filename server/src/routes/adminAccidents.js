'use strict';
const express = require('express');
const router  = express.Router();
const svc     = require('../services/accidentNarrativeService');

router.get('/accident-narratives-stats', (req, res) => {
  const adminToken = process.env.ADMIN_TOKEN;
  if (!adminToken) return res.status(503).json({ success: false, message: 'Admin endpoint disabled' });
  const provided = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (provided !== adminToken) return res.status(401).json({ success: false, message: 'Unauthorized' });

  const s = svc.stats();
  res.json({
    total: s.total,
    indexable: s.indexable,
    score_distribution: {
      '0-29':  s['0-29'],
      '30-49': s['30-49'],
      '50-69': s['50-69'],
      '70-89': s['70-89'],
      '90-100': s['90-100'],
    },
    by_source: s.by_source,
  });
});

module.exports = router;
