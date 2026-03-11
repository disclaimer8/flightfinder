const express = require('express');
const router = express.Router();
const flightController = require('../controllers/flightController');

// GET /api/flights?departure=LIS&arrival=NYC&aircraftType=B737
router.get('/', flightController.searchFlights);

// GET /api/flights/filter-options
router.get('/filter-options', flightController.getFilterOptions);

// GET /api/flights/explore?departure=LIS&date=2026-03-15&aircraftType=wide-body
router.get('/explore', flightController.exploreDestinations);

module.exports = router;
