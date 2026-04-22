'use strict';

const fs = require('fs');
const path = require('path');
const model = require('../models/amenities');

const SEED_PATH = path.resolve(__dirname, '../../data/airline-amenities.json');

function loadSeedIntoDb() {
  if (!fs.existsSync(SEED_PATH)) {
    console.warn('[amenities] seed file not found:', SEED_PATH);
    return { loaded: 0 };
  }
  const rows = JSON.parse(fs.readFileSync(SEED_PATH, 'utf-8'));
  let loaded = 0;
  for (const r of rows) {
    model.upsert({
      airlineIata: r.iata,
      icaoTypeHint: r.type || '',
      wifi: r.wifi, power: r.power, entertainment: r.entertainment, meal: r.meal,
    });
    loaded++;
  }
  console.log(`[amenities] seeded ${loaded} airlines from ${path.basename(SEED_PATH)}`);
  return { loaded };
}

function getAmenities(airlineIata, icaoType) {
  if (!airlineIata) return null;
  return model.findForAirlineType(airlineIata, icaoType);
}

module.exports = { loadSeedIntoDb, getAmenities };
