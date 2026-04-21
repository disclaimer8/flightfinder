'use strict';

const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/mapController');

// GET /api/map/airports        — compact airport list for route map
router.get('/airports',    ctrl.getAirports);

// GET /api/map/routes          — top destinations from an origin
router.get('/routes',      ctrl.getRoutes);

// GET /api/map/hub-network     — undirected edges between top-200 hubs (baseline graph)
router.get('/hub-network', ctrl.getHubNetwork);

// GET /api/map/radius          — airports within drawn radius
router.get('/radius',      ctrl.getAirportsInRadius);

// GET /api/map/flight-dates    — 12-month cheapest dates for a route
router.get('/flight-dates', ctrl.getFlightDates);

// GET /api/map/route-aircraft  — aircraft families observed on a city pair
router.get('/route-aircraft', ctrl.getRouteAircraft);

module.exports = router;
