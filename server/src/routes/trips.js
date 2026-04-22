'use strict';
const express = require('express');
const requireAuth = require('../middleware/requireAuth');
const requireTier = require('../middleware/entitlement');
const controller  = require('../controllers/tripsController');

const router = express.Router();

// All trip routes require auth. Creation additionally requires Pro.
router.use(requireAuth);

router.get('/',              controller.list);
router.get('/:id',           controller.get);
router.get('/:id/status',    controller.getStatus);
router.delete('/:id',        controller.remove);
router.post('/',             requireTier('pro'), controller.create);

module.exports = router;
