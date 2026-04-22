'use strict';

const fs = require('fs');
const path = require('path');
const { defineDataSource } = require('./dataSource');

// Expected layout: server/data/mictronics-fleet.json — array of
//   { icao24: "abc123", registration: "G-STBA", icaoType: "B738",
//     operatorIata: "BA", buildYear: 2010 }
// File is downloaded by a seed script (not included in repo). If absent,
// isEnabled() returns false and the bootstrap worker logs 'disabled'.
const FLEET_JSON_PATH = path.resolve(__dirname, '../../data/mictronics-fleet.json');

function isEnabled() {
  return fs.existsSync(FLEET_JSON_PATH);
}

async function* streamEntries() {
  if (!isEnabled()) return;
  // Large JSON but shape is flat — a single JSON.parse is OK for a 50-100MB file on a 1GB box.
  // If file exceeds practical memory, switch to streaming JSON parser in a follow-up.
  const rows = JSON.parse(fs.readFileSync(FLEET_JSON_PATH, 'utf-8'));
  for (const r of rows) yield r;
}

module.exports = defineDataSource({
  name: 'mictronics',
  isEnabled,
  fetch: streamEntries,
});
