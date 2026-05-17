'use strict';

const express = require('express');
const { buildAboutTeamPage } = require('../services/aboutTeamPage');

const router = express.Router();

router.get('/about/team', (_req, res) => {
  res.type('html').send(buildAboutTeamPage());
});

module.exports = router;
