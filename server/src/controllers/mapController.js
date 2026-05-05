'use strict';

const openFlights    = require('../services/openFlightsService');
const geocoding      = require('../services/geocodingService');
const amadeusService = require('../services/amadeusService');
const cacheService   = require('../services/cacheService');
const routesService  = require('../services/routesService');
const db             = require('../models/db');
const safety         = require('../models/safetyEvents');
const travelpayouts  = require('../services/travelpayoutsService');
const { families: famDict, getFamilyList } = require('../models/aircraftFamilies');

// ─── Helpers ────────────────────────────────────────────────────────────────

function haversineNm(lat1, lon1, lat2, lon2) {
  const toRad = d => (d * Math.PI) / 180;
  const R = 3440.065;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function computeAircraftMix(rows) {
  const list = getFamilyList();
  const icaoToFamily = new Map();
  for (const fam of list) {
    const fd = famDict[fam.name] || {};
    if (!fd.codes) continue;
    for (const code of fd.codes) {
      if (!icaoToFamily.has(code)) icaoToFamily.set(code, fam);
    }
  }
  const counts = new Map();
  for (const r of rows) {
    const icao = (r.aircraft_icao || '').toUpperCase();
    const fam = icaoToFamily.get(icao);
    if (!fam) continue;
    counts.set(fam.slug, (counts.get(fam.slug) || 0) + 1);
  }
  const total = [...counts.values()].reduce((s, n) => s + n, 0);
  if (total === 0) return [];
  return [...counts.entries()]
    .map(([slug, count]) => {
      const fam = list.find(f => f.slug === slug);
      return { slug, label: fam?.label ?? slug, count, share: count / total };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
}

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
      'map:hub-network:v3',
      async () => {
        // observed_routes has 3.85M tuples + 4011 airports after Plan 7e
        // historical bootstrap (2026-04-24). Raised minDests 5 → 15 to clamp
        // the network to genuine commercial hubs and drop GA-only airports
        // that crept in via business-jet ADS-B traffic.
        const { edges } = db.getHubNetwork({ hubLimit: 200, minDests: 15, edgeLimit: 3000 });
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

// ─── GET /api/map/route-operators?dep=LHR&arr=JFK ────────────────────────────
// Returns up to 5 operators observed on the route in the last 90 days,
// each enriched with airline name (via openFlightsService) and 90-day safety
// event count (via safety.countByOperator). Used by RouteLandingPage to
// surface "Operators on this route" with safety summary.
//
// Response shape:
//   {
//     success, dep, arr, windowDays,
//     operators: [{ iata, icao, name, count, safetyCount90d }]
//   }
exports.getRouteOperators = (req, res) => {
  const dep = String(req.query.dep || '').toUpperCase();
  const arr = String(req.query.arr || '').toUpperCase();
  if (!/^[A-Z]{3}$/.test(dep) || !/^[A-Z]{3}$/.test(arr) || dep === arr) {
    return res.status(400).json({
      success: false,
      message: 'dep and arr IATA codes required (3 letters, distinct)',
    });
  }

  const windowDays = 90;
  const cacheKey = `map:route-operators:${dep}:${arr}:${windowDays}`;
  const cached = cacheService.get(cacheKey);
  if (cached) return res.json(cached);

  try {
    const sinceMs = Date.now() - windowDays * 86400000;
    const rows = db.observedOperatorsByRoute(dep, arr, sinceMs, 5) || [];

    const operators = rows.map(r => {
      const iata = r.airline_iata;
      const meta = openFlights.getAirline(iata) || {};
      const safetyCount = safety.countByOperator({
        iata,
        icao: meta.icao || null,
        sinceMs,
      });
      // countByOperator returns { fatal, hull_loss, serious_incident, incident, minor, unknown, total }
      const safetyCount90d = (typeof safetyCount === 'number')
        ? safetyCount
        : (safetyCount?.total ?? 0);
      return {
        iata,
        icao: meta.icao || null,
        name: meta.name || null,
        count: r.count,
        safetyCount90d,
      };
    });

    const payload = { success: true, dep, arr, windowDays, operators };
    cacheService.set(cacheKey, payload, 30 * 60 * 1000);
    res.json(payload);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── GET /api/map/route-brief?dep=LHR&arr=JFK ────────────────────────────────
// Returns hero-stat data for /routes/<pair>: typical block time (great-circle
// distance estimate), daily frequency (last 7 days), best-effort cheapest fare
// (Travelpayouts, 1.5s timeout), and top-5 aircraft-mix breakdown.
exports.getRouteBrief = async (req, res) => {
  const dep = String(req.query.dep || '').toUpperCase();
  const arr = String(req.query.arr || '').toUpperCase();
  if (!/^[A-Z]{3}$/.test(dep) || !/^[A-Z]{3}$/.test(arr) || dep === arr) {
    return res.status(400).json({
      success: false,
      message: 'dep and arr IATA codes required (3 letters, distinct)',
    });
  }

  const cacheKey = `map:route-brief:${dep}:${arr}`;
  const cached = cacheService.get(cacheKey);
  if (cached) return res.json(cached);

  try {
    const depAirport = openFlights.getAirport(dep);
    const arrAirport = openFlights.getAirport(arr);
    let blockTimeMinutes = null;
    if (depAirport?.lat != null && arrAirport?.lat != null) {
      const distNm = haversineNm(depAirport.lat, depAirport.lon, arrAirport.lat, arrAirport.lon);
      blockTimeMinutes = Math.round(distNm * 0.014 + 30);
    }

    const sinceMs7d = Date.now() - 7 * 86400000;
    const flights7d = db.countDistinctFlightsByRoute(dep, arr, sinceMs7d);
    const frequencyDaily = flights7d > 0 ? Math.round(flights7d / 7) : null;

    const sinceMs90d = Date.now() - 90 * 86400000;
    const mixRaw = db.observedAircraftByRoute(dep, arr, sinceMs90d) || [];
    const aircraftMix = computeAircraftMix(mixRaw);

    let cheapestFare = null;
    if (typeof travelpayouts.isConfigured === 'function' && travelpayouts.isConfigured()) {
      try {
        const result = await Promise.race([
          travelpayouts.getCheapest({ origin: dep, destination: arr, currency: 'usd' }),
          new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 1500)),
        ]);
        // getCheapest returns { price: String, currency: String, ... } or null
        if (result && result.price != null) {
          const amount = parseFloat(result.price);
          if (!isNaN(amount)) {
            cheapestFare = { amount, currency: result.currency || 'USD' };
          }
        }
      } catch {
        // best-effort: leave null
      }
    }

    const payload = {
      success: true,
      dep, arr, windowDays: 90,
      blockTimeMinutes,
      frequencyDaily,
      cheapestFare,
      aircraftMix,
    };
    cacheService.set(cacheKey, payload, 30 * 60 * 1000);
    res.json(payload);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
