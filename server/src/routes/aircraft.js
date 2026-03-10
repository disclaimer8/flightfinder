const express = require('express');
const router = express.Router();
const aircraftController = require('../controllers/aircraftController');

// GET /api/aircraft
router.get('/', aircraftController.getAllAircraft);

// GET /api/aircraft/:iataCode
router.get('/:iataCode', aircraftController.getAircraftByCode);

// GET /api/aircraft/type/:type (e.g., turboprop, jet, regional)
router.get('/type/:type', aircraftController.getAircraftByType);

module.exports = router;
