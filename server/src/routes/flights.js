const express    = require('express');
const router     = express.Router();
const controller = require('../controllers/flightController');
const acController = require('../controllers/aircraftSearchController');
const validate   = require('../middleware/validate');

// GET /api/flights?departure=LIS&arrival=NYC&date=...
router.get('/',              validate.searchQuery,  controller.searchFlights);

// GET /api/flights/filter-options
router.get('/filter-options',                       controller.getFilterOptions);

// GET /api/flights/explore?departure=LIS&date=...&aircraftType=wide-body
router.get('/explore',       validate.exploreQuery, controller.exploreDestinations);

// GET /api/flights/aircraft-search/stream  (SSE)
router.get('/aircraft-search/stream', validate.aircraftSearchQuery, acController.streamAircraftSearch);

// GET /api/flights/cheap-calendar?departure=LHR&arrival=JFK&month=2026-05
router.get('/cheap-calendar', validate.cheapCalendarQuery, controller.getCheapCalendar);

// GET /api/flights/scheduled-aircraft?departure=LHR&arrival=JFK&date=2026-05-01
router.get('/scheduled-aircraft', validate.scheduledAircraftQuery, controller.getScheduledAircraft);

// POST /api/flights/book
router.post('/book',         validate.bookBody,     controller.bookFlight);

module.exports = router;
