'use strict';

const express = require('express');
const { buildAboutTeamPage } = require('../services/aboutTeamPage');
const { buildMethodologyPage } = require('../services/methodologyPage');

const router = express.Router();

router.get('/about/team', (_req, res) => {
  res.type('html').send(buildAboutTeamPage());
});

router.get('/methodology', (_req, res) => {
  res.type('html').send(buildMethodologyPage());
});

module.exports = router;
