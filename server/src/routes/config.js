'use strict';

const express = require('express');
const router = express.Router();

// Cheap, public feature-flag snapshot for the client. Add flags here as
// they're introduced. Client caches this once on mount.
router.get('/client', (_req, res) => {
  res.json({
    success: true,
    flags: {
      enrichedCardEnabled: process.env.ENRICHED_CARD !== '0',
      tripsEnabled:        process.env.TRIPS_ENABLED !== '0',
    },
  });
});

module.exports = router;
