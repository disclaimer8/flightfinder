'use strict';

const express = require('express');
const { db } = require('../models/db');
const router = express.Router();

// Ops-only status endpoint. Gated by ADMIN_TOKEN header like /auth/admin/*.
// Returns ingestion progress counters so we can verify the delay worker is
// collecting data without needing SSH to the box.
router.get('/', (req, res) => {
  const adminToken = process.env.ADMIN_TOKEN;
  if (!adminToken) return res.status(503).json({ success: false, message: 'Admin endpoint disabled' });
  const provided = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (provided !== adminToken) return res.status(401).json({ success: false, message: 'Unauthorized' });

  const observationsTotal = db.prepare('SELECT COUNT(*) AS c FROM flight_observations').get().c;
  const observationsLast24h = db.prepare(
    'SELECT COUNT(*) AS c FROM flight_observations WHERE observed_at > ?',
  ).get(Date.now() - 24 * 60 * 60 * 1000).c;
  const oldestObservation = db.prepare(
    'SELECT MIN(observed_at) AS t FROM flight_observations',
  ).get().t;
  const newestObservation = db.prepare(
    'SELECT MAX(observed_at) AS t FROM flight_observations',
  ).get().t;
  const observedRoutesTotal = db.prepare('SELECT COUNT(*) AS c FROM observed_routes').get().c;
  const observedRoutesLast30d = db.prepare(
    'SELECT COUNT(*) AS c FROM observed_routes WHERE seen_at > ?',
  ).get(Date.now() - 30 * 24 * 60 * 60 * 1000).c;
  const fleetTotal = db.prepare('SELECT COUNT(*) AS c FROM aircraft_fleet').get().c;
  const fleetWithBuildYear = db.prepare(
    'SELECT COUNT(*) AS c FROM aircraft_fleet WHERE build_year IS NOT NULL',
  ).get().c;

  res.json({
    success: true,
    flags: {
      ingestEnabled:     process.env.INGEST_ENABLED === '1',
      fleetBootstrap:    process.env.FLEET_BOOTSTRAP === '1',
      adsblolEnabled:    process.env.ADSBLOL_ENABLED === '1',
      ourairportsRefresh: process.env.OURAIRPORTS_REFRESH === '1',
      ingestTopRoutes:   Number(process.env.INGEST_TOP_ROUTES || 30),
    },
    observations: {
      total:       observationsTotal,
      last24h:     observationsLast24h,
      oldest_at:   oldestObservation,
      newest_at:   newestObservation,
    },
    observedRoutes: {
      total:    observedRoutesTotal,
      last30d:  observedRoutesLast30d,
    },
    fleet: {
      total:            fleetTotal,
      withBuildYear:    fleetWithBuildYear,
    },
  });
});

module.exports = router;
