'use strict';

const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/mapController');
const mapRoutesCtrl = require('../controllers/mapRoutesController');

// GET /api/map/airports        — compact airport list for route map
router.get('/airports',    ctrl.getAirports);

// GET /api/map/routes          — aggregated dep-arr pairs for the interactive map
//                                ?airline=IATA (≤4 chars)&aircraft=ICAO (≤6 chars), 90d window
router.get('/routes',      mapRoutesCtrl.getRoutes);

// GET /api/map/filters         — top-200 airlines + all aircraft types for typeaheads
router.get('/filters',     mapRoutesCtrl.getFilters);

// GET /api/map/hub-network     — undirected edges between top-200 hubs (baseline graph)
router.get('/hub-network', ctrl.getHubNetwork);

// GET /api/map/radius          — airports within drawn radius
router.get('/radius',      ctrl.getAirportsInRadius);

// GET /api/map/flight-dates    — 12-month cheapest dates for a route
router.get('/flight-dates', ctrl.getFlightDates);

// GET /api/map/route-aircraft  — aircraft families observed on a city pair
router.get('/route-aircraft', ctrl.getRouteAircraft);

// GET /api/map/route-operators — operators observed on a city pair (last 90d)
router.get('/route-operators', ctrl.getRouteOperators);

// GET /api/map/route-brief     — hero stats for a city pair (block time, frequency, fare, aircraft mix)
router.get('/route-brief', ctrl.getRouteBrief);

module.exports = router;
