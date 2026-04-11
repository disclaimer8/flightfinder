'use strict';

const openFlights    = require('../services/openFlightsService');
const geocoding      = require('../services/geocodingService');
const amadeusService = require('../services/amadeusService');
const cacheService   = require('../services/cacheService');

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

  // Primary: OpenFlights routes.dat — works for every airport
  const destinations = openFlights.getDirectDestinations(code);

  if (!destinations.length) {
    return res.status(404).json({ error: 'No routes found for this airport code' });
  }

  // Best-effort: try Amadeus for price overlay (fails silently for most airports in test env)
  const prices = {};
  try {
    const data = await amadeusService.flightDestinations(code);
    for (const d of data) {
      if (d.destination && d.price?.total) {
        prices[d.destination] = parseFloat(d.price.total);
      }
    }
  } catch {
    // Amadeus not configured or origin not in test dataset — routes still shown without prices
  }

  const result = { origin: code, destinations, prices };
  cacheService.set(cacheKey, result, 3600); // 1 h — route topology rarely changes
  res.json(result);
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
    res.status(502).json({ error: 'Failed to fetch flight dates', detail: err.message });
  }
};
