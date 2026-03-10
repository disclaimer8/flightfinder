const express = require('express');
const router = express.Router();
const flightController = require('../controllers/flightController');

// GET /api/flights?departure=LIS&arrival=NYC&aircraftType=B737
router.get('/', flightController.searchFlights);

// GET /api/flights/filter-options
router.get('/filter-options', flightController.getFilterOptions);

module.exports = router;
