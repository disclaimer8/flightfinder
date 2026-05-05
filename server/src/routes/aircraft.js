const express = require('express');
const router = express.Router();
const aircraftController = require('../controllers/aircraftController');
const acSearchController = require('../controllers/aircraftSearchController');
const validate = require('../middleware/validate');

// GET /api/aircraft
router.get('/', aircraftController.getAllAircraft);

// GET /api/aircraft/families  — list of searchable aircraft families for UI
router.get('/families', (req, res) => {
  const { getFamilyList } = require('../models/aircraftFamilies');
  res.json({ success: true, families: getFamilyList() });
});

// GET /api/aircraft/index-stats — per-family route/operator/safety counts for AircraftIndex
router.get('/index-stats', aircraftController.getIndexStats);

// GET /api/aircraft/airports/search?q=London&limit=8
router.get('/airports/search', acSearchController.searchAirports);

// GET /api/aircraft/routes?family=a380&origins=PRG,VIE — map-as-output backend
router.get('/routes', validate.aircraftRoutesQuery, aircraftController.getAircraftRoutes);

// GET /api/aircraft/type/:type (must come before /:iataCode)
router.get('/type/:type', aircraftController.getAircraftByType);

// GET /api/aircraft/:iataCode
router.get('/:iataCode', aircraftController.getAircraftByCode);

module.exports = router;
