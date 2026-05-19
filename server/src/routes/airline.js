'use strict';

const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/airlineController');

router.get('/:iata', ctrl.getLanding);

module.exports = router;
