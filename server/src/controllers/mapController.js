'use strict';

const openFlights    = require('../services/openFlightsService');
const geocoding      = require('../services/geocodingService');
const amadeusService = require('../services/amadeusService');
const cacheService   = require('../services/cacheService');
const routesService  = require('../services/routesService');
const db             = require('../models/db');

// ─── GET /api/map/airports ───────────────────────────────────────────────────
// Returns all known airports in compact format to minimise payload.
// Format: { pts:[IATA,...], crd:[lat,lng,...], names:[...], cities:[...], countries:[...] }
// The client rebuilds a lookup from this — ~5× smaller than an array of objects.

exports.getAirports = (_req, res) => {
  const cacheKey = 'map:airports:compact';
  const cached   = cacheService.get(cacheKey);
  if (cached) return res.json(cached);

  const all     = openFlights.getAllAirports().filter(a => a.lat && a.lon);
  const pts      = [];
  const crd      = [];
  const names    = [];
  const cities   = [];
  const countries = [];

  for (const a of all) {
    pts.push(a.iata);
    crd.push(a.lat, a.lon);
    names.push(a.name   || '');
    cities.push(a.city  || '');
    countries.push(a.country || '');
  }

  const result = { pts, crd, names, cities, countries, count: pts.length };
  cacheService.set(cacheKey, result, 3600); // 1 h — airport list rarely changes
  res.json(result);
};

// ─── GET /api/map/routes?origin=LHR ─────────────────────────────────────────
// Returns direct destinations from an origin airport.
// Source: OpenFlights routes.dat (all airports, offline).
// Prices: Amadeus Flight Inspiration Search (best-effort, only major hubs in test env).

exports.getRoutes = async (req, res) => {
  const { origin } = req.query;
  if (!origin || !/^[A-Za-z]{3}$/.test(origin)) {
    return res.status(400).json({ error: 'origin: valid IATA code required' });
  }
  const code     = origin.toUpperCase();
  const cacheKey = `map:routes:${code}`;
  const cached   = cacheService.get(cacheKey);
  if (cached) return res.json(cached);

  try {
    const result = await routesService.getRoutes(code);
    if (!result.destinations.length) {
      return res.status(404).json({ error: 'No routes found for this airport code' });
    }
    cacheService.set(cacheKey, result, 3600); // 1 h
    res.json(result);
  } catch (err) {
    console.error('[map] getRoutes error:', err.message);
    res.status(502).json({ error: 'Failed to fetch routes' });
  }
};

// ─── GET /api/map/hub-network ───────────────────────────────────────────────
// Returns a global "hub network" — undirected edges between top-200 hubs based on
// observed_routes. The client RouteMap renders this as a faint backbone behind the
// airport dots; on airport click the backbone dims and the selected origin's routes
// draw brightly on top.
//
// Shape: { edges: [[depIata, arrIata], ...], count, generatedAt }
// Cached for 1h under `map:hub-network:v1`; dataset is append-only + bounded.

exports.getHubNetwork = async (_req, res) => {
  try {
    const { data } = await cacheService.getOrFetch(
      'map:hub-network:v2',
      async () => {
        // minDests kept low (5) while observed_routes is still warming up.
        // Raise to 15-20 once adsb.lol + AirLabs have backfilled ~2 weeks.
        const { edges } = db.getHubNetwork({ hubLimit: 200, minDests: 5, edgeLimit: 3000 });
        // Defensive validation — drop any edge whose endpoints are not 3-letter uppercase
        // IATAs known to the airports dataset. Guards the client against stray rows.
        const clean = [];
        for (const [a, b] of edges) {
          if (
            typeof a === 'string' && typeof b === 'string' &&
            a.length === 3 && b.length === 3 &&
            a === a.toUpperCase() && b === b.toUpperCase() &&
            openFlights.isValidAirport(a) && openFlights.isValidAirport(b)
          ) {
            clean.push([a, b]);
          }
        }
        return {
          edges: clean,
          count: clean.length,
          generatedAt: new Date().toISOString(),
        };
      },
      3600, // 1 hour
    );
    res.json(data);
  } catch (err) {
    console.error('[map] getHubNetwork error:', err.message);
    res.status(500).json({ error: 'Failed to build hub network' });
  }
};

// ─── GET /api/map/radius?lat=51.5&lon=-0.1&radius=500 ───────────────────────
// Returns airports within radius km of a point — used by the map's
// "Draw Radius" feature to highlight airports in a drawn circle.

exports.getAirportsInRadius = (req, res) => {
  const lat    = parseFloat(req.query.lat);
  const lon    = parseFloat(req.query.lon);
  const radius = Math.min(parseInt(req.query.radius, 10) || 300, 3000);

  if (isNaN(lat) || isNaN(lon)) {
    return res.status(400).json({ error: 'lat and lon required' });
  }

  const airports = geocoding.nearbyAirports(lat, lon, radius, 100);
  res.json({ airports, center: { lat, lon }, radius });
};

// ─── GET /api/map/flight-dates?origin=LHR&destination=JFK ───────────────────
// Returns cheapest available dates for the next ~11 months.
// Used by the ValidityCalendar component to show a 12-month price heatmap.

// ─── GET /api/map/route-aircraft?dep=LHR&arr=JFK ─────────────────────────────
// Returns up to 6 aircraft families observed on the route in the last 90 days
// with links back to the corresponding /aircraft/:slug landing page. Used by
// RouteLandingPage for cross-linking and by search-results UI for badges.
// Response shape: { dep, arr, windowDays, families: [{slug, label, icaoTypes, count}] }
exports.getRouteAircraft = (req, res) => {
  const dep = String(req.query.dep || '').toUpperCase();
  const arr = String(req.query.arr || '').toUpperCase();
  if (!/^[A-Z]{3}$/.test(dep) || !/^[A-Z]{3}$/.test(arr) || dep === arr) {
    return res.status(400).json({ success: false, message: 'dep and arr IATA codes required (3 letters, distinct)' });
  }
  const windowDays = 90;
  const cacheKey = `map:route-aircraft:${dep}:${arr}:${windowDays}`;
  const cached = cacheService.get(cacheKey);
  if (cached) return res.json(cached);

  try {
    const { families: famDict } = require('../models/aircraftFamilies');
    const { getFamilyList } = require('../models/aircraftFamilies');
    const sinceMs = Date.now() - windowDays * 86400000;
    const rows = db.observedAircraftByRoute(dep, arr, sinceMs) || [];
    // Bucket ICAO types → family slug using the existing families dictionary.
    const icaoToFamily = new Map();
    const list = getFamilyList();
    for (const fam of list) {
      const famData = famDict[fam.name];
      if (!famData) continue;
      for (const code of famData.codes) {
        if (!icaoToFamily.has(code)) icaoToFamily.set(code, fam);
      }
    }
    const bySlug = new Map();
    for (const r of rows) {
      const icao = (r.aircraft_icao || '').toUpperCase();
      const fam = icaoToFamily.get(icao);
      if (!fam) continue;
      const cur = bySlug.get(fam.slug) || { slug: fam.slug, label: fam.label, icaoTypes: new Set(), count: 0 };
      cur.icaoTypes.add(icao);
      cur.count += 1;
      bySlug.set(fam.slug, cur);
    }
    const families = [...bySlug.values()]
      .map(f => ({ slug: f.slug, label: f.label, icaoTypes: [...f.icaoTypes].sort(), count: f.count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);
    const result = { dep, arr, windowDays, families };
    cacheService.set(cacheKey, result, 1800); // 30 min
    res.json(result);
  } catch (err) {
    console.error('[route-aircraft] failed:', err.message);
    res.status(500).json({ success: false, message: 'failed to load route aircraft' });
  }
};

exports.getFlightDates = async (req, res) => {
  const { origin, destination } = req.query;
  if (
    !origin || !destination ||
    !/^[A-Za-z]{3}$/.test(origin) ||
    !/^[A-Za-z]{3}$/.test(destination)
  ) {
    return res.status(400).json({ error: 'origin and destination IATA codes required' });
  }
  const orig = origin.toUpperCase();
  const dest = destination.toUpperCase();

  const cacheKey = `map:flight-dates:${orig}:${dest}`;
  const cached   = cacheService.get(cacheKey);
  if (cached) return res.json(cached);

  try {
    const data     = await amadeusService.flightDates(orig, dest);
    const calendar = data.map(d => ({
      date:       d.departureDate,
      returnDate: d.returnDate || null,
      price:      d.price?.total ? parseFloat(d.price.total) : null,
    }));

    const result = { origin: orig, destination: dest, calendar };
    cacheService.set(cacheKey, result, 1800);
    res.json(result);
  } catch (err) {
    // Amadeus not configured or unavailable — return empty calendar instead of an error
    // so the UI shows a graceful "no data" state rather than a red error message.
    if (err.message === 'Amadeus API is not configured' || err.response?.status === 401) {
      return res.json({ origin: orig, destination: dest, calendar: [] });
    }
    res.status(502).json({ error: 'Failed to fetch flight dates', detail: err.message });
  }
};
