'use strict';

const express = require('express');
const { db } = require('../models/db');
const adsblolWorker = require('../workers/adsblolWorker');
const router = express.Router();

router.get('/', (req, res) => {
  const adminToken = process.env.ADMIN_TOKEN;
  if (!adminToken) return res.status(503).json({ success: false, message: 'Admin endpoint disabled' });
  const provided = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (provided !== adminToken) return res.status(401).json({ success: false, message: 'Unauthorized' });

  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const weekMs = 7 * dayMs;
  const monthMs = 30 * dayMs;

  const observationsTotal = db.prepare('SELECT COUNT(*) AS c FROM flight_observations').get().c;
  const observationsLast24h = db.prepare(
    'SELECT COUNT(*) AS c FROM flight_observations WHERE observed_at > ?',
  ).get(now - dayMs).c;
  const oldestObservation = db.prepare(
    'SELECT MIN(observed_at) AS t FROM flight_observations',
  ).get().t;
  const newestObservation = db.prepare(
    'SELECT MAX(observed_at) AS t FROM flight_observations',
  ).get().t;

  const observedRoutesTotal   = db.prepare('SELECT COUNT(*) AS c FROM observed_routes').get().c;
  const observedRoutesLast24h = db.prepare('SELECT COUNT(*) AS c FROM observed_routes WHERE seen_at > ?').get(now - dayMs).c;
  const observedRoutesLast7d  = db.prepare('SELECT COUNT(*) AS c FROM observed_routes WHERE seen_at > ?').get(now - weekMs).c;
  const observedRoutesLast30d = db.prepare('SELECT COUNT(*) AS c FROM observed_routes WHERE seen_at > ?').get(now - monthMs).c;
  const observedRoutesNewest  = db.prepare('SELECT MAX(seen_at) AS t FROM observed_routes').get().t;
  const observedRoutesOldest  = db.prepare('SELECT MIN(seen_at) AS t FROM observed_routes').get().t;

  const fleetTotal = db.prepare('SELECT COUNT(*) AS c FROM aircraft_fleet').get().c;
  const fleetWithBuildYear = db.prepare(
    'SELECT COUNT(*) AS c FROM aircraft_fleet WHERE build_year IS NOT NULL',
  ).get().c;

  const cacheTotal    = db.prepare('SELECT COUNT(*) AS c FROM adsbdb_callsign_cache').get().c;
  const cacheResolved = db.prepare('SELECT COUNT(*) AS c FROM adsbdb_callsign_cache WHERE dep_iata IS NOT NULL').get().c;
  const cacheNegative = db.prepare('SELECT COUNT(*) AS c FROM adsbdb_callsign_cache WHERE dep_iata IS NULL').get().c;

  res.json({
    success: true,
    flags: {
      ingestEnabled:      process.env.INGEST_ENABLED === '1',
      fleetBootstrap:     process.env.FLEET_BOOTSTRAP === '1',
      adsblolEnabled:     process.env.ADSBLOL_ENABLED === '1',
      adsbdbEnabled:      process.env.ADSBDB_ENABLED !== '0',
      ourairportsRefresh: process.env.OURAIRPORTS_REFRESH === '1',
      ingestTopRoutes:    Number(process.env.INGEST_TOP_ROUTES || 30),
    },
    observations: {
      total:     observationsTotal,
      last24h:   observationsLast24h,
      oldest_at: oldestObservation,
      newest_at: newestObservation,
    },
    observedRoutes: {
      total:           observedRoutesTotal,
      last24h:         observedRoutesLast24h,
      last7d:          observedRoutesLast7d,
      last30d:         observedRoutesLast30d,
      oldest_seen_at:  observedRoutesOldest,
      newest_seen_at:  observedRoutesNewest,
    },
    adsblolLastCycle: adsblolWorker.getLastCycle(),
    adsbdbCache: {
      total:    cacheTotal,
      resolved: cacheResolved,
      negative: cacheNegative,
    },
    fleet: {
      total:         fleetTotal,
      withBuildYear: fleetWithBuildYear,
    },
  });
});

module.exports = router;
