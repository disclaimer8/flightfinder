'use strict';

const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/airlineAircraftController');

router.get('/:iata/aircraft/:icao/routes', ctrl.getRoutes);

module.exports = router;
