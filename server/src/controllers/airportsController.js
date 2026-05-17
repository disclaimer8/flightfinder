'use strict';

const jontyDb = require('../models/jontyDb');

const IATA_RE    = /^[A-Z0-9]{3}$/;
const COUNTRY_RE = /^[A-Z]{2}$/;

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function isJontyMissing(err) {
  return err && typeof err.message === 'string' &&
    err.message.includes('jonty.db not present');
}

// ---------------------------------------------------------------------------
// GET /api/airports/:iata
// ---------------------------------------------------------------------------

function getAirport(req, res) {
  const iata = String(req.params.iata || '').toUpperCase();

  if (!IATA_RE.test(iata)) {
    return res.status(400).json({ success: false, message: 'Invalid IATA' });
  }

  let db;
  try {
    db = jontyDb.getDb();
  } catch (err) {
    if (isJontyMissing(err)) {
      return res.status(503).json({ success: false, message: 'Airport data not available' });
    }
    throw err;
  }

  const airport = db.prepare(
    'SELECT iata, icao, name, city, country, country_code, continent, ' +
    'latitude, longitude, elevation, timezone, display_name ' +
    'FROM airports WHERE iata = ?'
  ).get(iata);

  if (!airport) {
    return res.status(404).json({ success: false, message: 'Airport not found' });
  }

  // Single JOIN query — no N+1: fetch all routes + carriers for this origin
  // in one pass, then group in JS.
  const rows = db.prepare(`
    SELECT r.dest_iata, r.km, r.duration_min,
           rc.carrier_iata, rc.carrier_name
    FROM   routes r
    LEFT   JOIN route_carriers rc
           ON rc.origin_iata = r.origin_iata AND rc.dest_iata = r.dest_iata
    WHERE  r.origin_iata = ?
    ORDER  BY r.dest_iata, rc.carrier_iata
  `).all(iata);

  // Group into { dest_iata → { km, duration_min, carriers[] } }
  const routeMap = new Map();
  for (const row of rows) {
    if (!routeMap.has(row.dest_iata)) {
      routeMap.set(row.dest_iata, {
        dest_iata: row.dest_iata,
        km: row.km,
        duration_min: row.duration_min,
        carriers: [],
      });
    }
    if (row.carrier_iata) {
      routeMap.get(row.dest_iata).carriers.push({
        iata: row.carrier_iata,
        name: row.carrier_name,
      });
    }
  }

  const routes = Array.from(routeMap.values());

  return res.json({ success: true, airport, routes });
}

// ---------------------------------------------------------------------------
// GET /api/airports
// ---------------------------------------------------------------------------

function listAirports(req, res) {
  let db;
  try {
    db = jontyDb.getDb();
  } catch (err) {
    if (isJontyMissing(err)) {
      return res.status(503).json({ success: false, message: 'Airport data not available' });
    }
    throw err;
  }

  // country filter — silently ignore if invalid (permissive)
  const rawCountry = String(req.query.country || '').toUpperCase();
  const country    = COUNTRY_RE.test(rawCountry) ? rawCountry : null;

  // limit / offset — integers, clamped
  let limit  = parseInt(req.query.limit, 10);
  let offset = parseInt(req.query.offset, 10);
  if (!Number.isFinite(limit)  || limit  < 1)   limit  = 100;
  if (!Number.isFinite(offset) || offset < 0)   offset = 0;
  if (limit > 500) limit = 500;

  const where  = country ? 'WHERE country_code = ?' : '';
  const params = country ? [country] : [];

  const total = db.prepare(
    `SELECT COUNT(*) AS n FROM airports ${where}`
  ).get(...params).n;

  const airports = db.prepare(
    `SELECT iata, name, city, country, country_code
     FROM airports ${where}
     ORDER BY iata
     LIMIT ? OFFSET ?`
  ).all(...params, limit, offset);

  return res.json({ success: true, total, limit, offset, airports });
}

module.exports = { getAirport, listAirports };
