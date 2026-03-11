const fs = require('fs');
const path = require('path');

// Parse OpenFlights CSV (fields may be quoted, \N = null)
function parseCSV(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return raw.split('\n').filter(Boolean).map(line => {
    const fields = [];
    let cur = '';
    let inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { inQuote = !inQuote; continue; }
      if (ch === ',' && !inQuote) { fields.push(cur === '\\N' ? null : cur); cur = ''; continue; }
      cur += ch;
    }
    fields.push(cur === '\\N' ? null : cur);
    return fields;
  });
}

// airports.dat columns:
// 0:id 1:name 2:city 3:country 4:iata 5:icao 6:lat 7:lon 8:alt 9:tz 10:dst 11:tzdb 12:type 13:source
const airportsMap = new Map();
parseCSV(path.join(__dirname, '../data/airports.dat')).forEach(f => {
  const iata = f[4];
  if (iata && iata.length === 3) {
    airportsMap.set(iata, {
      iata,
      name: f[1],
      city: f[2],
      country: f[3],
      icao: f[5],
      lat: parseFloat(f[6]),
      lon: parseFloat(f[7]),
      timezone: f[11],
    });
  }
});

// airlines.dat columns:
// 0:id 1:name 2:alias 3:iata 4:icao 5:callsign 6:country 7:active
const airlinesMap = new Map();
parseCSV(path.join(__dirname, '../data/airlines.dat')).forEach(f => {
  const iata = f[3];
  if (iata && iata.length >= 2 && f[7] === 'Y') {
    airlinesMap.set(iata, {
      iata,
      name: f[1],
      icao: f[4],
      country: f[6],
    });
  }
});

console.log(`[openflights] Loaded ${airportsMap.size} airports, ${airlinesMap.size} airlines`);

/** Look up an airport by IATA code */
exports.getAirport = (iata) => airportsMap.get(iata?.toUpperCase()) || null;

/** Look up an airline by IATA code */
exports.getAirline = (iata) => airlinesMap.get(iata?.toUpperCase()) || null;

/** Validate that an IATA airport code exists */
exports.isValidAirport = (iata) => airportsMap.has(iata?.toUpperCase());

/** Get city name for an airport code */
exports.getCity = (iata) => airportsMap.get(iata?.toUpperCase())?.city || iata;

/** Get country for an airport code */
exports.getCountry = (iata) => airportsMap.get(iata?.toUpperCase())?.country || null;

/** Get all airports as array (for search UI) */
exports.getAllAirports = () => Array.from(airportsMap.values());
