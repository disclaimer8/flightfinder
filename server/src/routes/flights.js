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

// POST /api/flights/book
router.post('/book',         validate.bookBody,     controller.bookFlight);

module.exports = router;
