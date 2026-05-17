'use strict';

const express = require('express');
const ctrl    = require('../controllers/airportsController');

const router = express.Router();

router.get('/',      ctrl.listAirports);
router.get('/:iata', ctrl.getAirport);

module.exports = router;
