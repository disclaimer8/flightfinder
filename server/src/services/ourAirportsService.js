// server/src/services/ourAirportsService.js
'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_CSV = path.resolve(__dirname, '../../data/ourairports.csv');

// One Map keyed by uppercase IATA. ICAO-only airports are skipped since we
// join downstream by IATA.
let byIata = new Map();

function parseLine(line) {
  // OurAirports CSV is RFC 4180-ish with quoted fields. Airport names
  // occasionally contain commas — hence the quote-aware split.
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

function loadFromCsv(filePath = DEFAULT_CSV) {
  byIata = new Map();
  if (!fs.existsSync(filePath)) return 0;
  const raw = fs.readFileSync(filePath, 'utf8');
  const lines = raw.split(/\r?\n/).filter(Boolean);
  if (!lines.length) return 0;
  const header = parseLine(lines[0]);
  const idx = {
    ident:        header.indexOf('ident'),
    name:         header.indexOf('name'),
    lat:          header.indexOf('latitude_deg'),
    lon:          header.indexOf('longitude_deg'),
    iso_country:  header.indexOf('iso_country'),
    municipality: header.indexOf('municipality'),
    iata:         header.indexOf('iata_code'),
    type:         header.indexOf('type'),
  };
  for (let i = 1; i < lines.length; i++) {
    const f = parseLine(lines[i]);
    const iata = (f[idx.iata] || '').trim().toUpperCase();
    if (!iata || iata.length !== 3) continue;
    // Skip closed airports; they still linger in the dataset with type 'closed'.
    if ((f[idx.type] || '').trim() === 'closed') continue;
    const lat = parseFloat(f[idx.lat]);
    const lon = parseFloat(f[idx.lon]);
    byIata.set(iata, {
      iata,
      icao:    (f[idx.ident] || '').trim() || null,
      name:    f[idx.name] || null,
      city:    f[idx.municipality] || null,
      country: (f[idx.iso_country] || '').trim() || null,
      lat:     Number.isFinite(lat) ? lat : null,
      lon:     Number.isFinite(lon) ? lon : null,
    });
  }
  return byIata.size;
}

function getAirport(iata) {
  if (!iata) return null;
  return byIata.get(String(iata).toUpperCase()) || null;
}

function size() { return byIata.size; }
function isLoaded() { return byIata.size > 0; }

module.exports = { loadFromCsv, getAirport, size, isLoaded };
