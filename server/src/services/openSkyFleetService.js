'use strict';

const fs = require('fs');
const path = require('path');
const { defineDataSource } = require('./dataSource');

// Download once with:
//   curl -o server/data/opensky-aircraft.csv \
//     https://opensky-network.org/datasets/metadata/aircraftDatabase.csv
// This is free for research; commercial/operational use requires a written
// agreement with OpenSky. We use it only to enrich our own fleet table with
// build-year data — not to redistribute the CSV itself.
const DEFAULT_PATH = path.resolve(
  __dirname, '../../data',
  process.env.OPENSKY_FLEET_FILE || 'opensky-aircraft.csv',
);

function isEnabled() { return fs.existsSync(DEFAULT_PATH); }

function parseLine(line) {
  const out = [];
  let cur = '';
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; continue; }
    if (ch === '"') { inQuote = !inQuote; continue; }
    if (ch === ',' && !inQuote) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out;
}

async function* streamEntries() {
  if (!isEnabled()) return;
  const raw = fs.readFileSync(DEFAULT_PATH, 'utf8');
  const lines = raw.split(/\r?\n/).filter(Boolean);
  if (!lines.length) return;
  const header = parseLine(lines[0]);
  const idx = {
    icao24:       header.indexOf('icao24'),
    registration: header.indexOf('registration'),
    typecode:     header.indexOf('typecode'),
    operator:     header.indexOf('operatoricao') >= 0 ? header.indexOf('operatoricao') : header.indexOf('operator'),
    built:        header.indexOf('built'),
  };
  for (let i = 1; i < lines.length; i++) {
    const f = parseLine(lines[i]);
    const icao24 = (f[idx.icao24] || '').trim().toLowerCase();
    if (!icao24) continue;
    const buildYear = parseInt((f[idx.built] || '').slice(0, 4), 10);
    yield {
      icao24,
      registration: (f[idx.registration] || '').trim() || null,
      icaoType:     (f[idx.typecode] || '').trim() || null,
      operatorIata: null, // OpenSky stores ICAO/name, not IATA — Mictronics covers this field
      buildYear:    Number.isFinite(buildYear) ? buildYear : null,
    };
  }
}

module.exports = defineDataSource({
  name: 'opensky-fleet',
  isEnabled,
  fetch: streamEntries,
});
