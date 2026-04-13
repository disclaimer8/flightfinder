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
const icaoMap = new Map(); // ICAO → IATA
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
    if (f[5] && f[5].length === 4) {
      icaoMap.set(f[5].toUpperCase(), iata);
    }
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

// routes.dat columns:
// 0:airline 1:airlineId 2:src 3:srcId 4:dst 5:dstId 6:codeshare 7:stops 8:equipment
// We only keep direct routes (stops=0) between airports with valid 3-letter IATA codes.
const routesMap = new Map(); // src IATA -> Set<dst IATA>
try {
  parseCSV(path.join(__dirname, '../data/routes.dat')).forEach(f => {
    const src   = f[2];
    const dst   = f[4];
    const stops = parseInt(f[7], 10);
    if (
      src && src.length === 3 && /^[A-Z]{3}$/.test(src) &&
      dst && dst.length === 3 && /^[A-Z]{3}$/.test(dst) &&
      stops === 0
    ) {
      if (!routesMap.has(src)) routesMap.set(src, new Set());
      routesMap.get(src).add(dst);
    }
  });
} catch (e) {
  console.warn('[openflights] routes.dat not found or could not be parsed:', e.message);
}

console.log(`[openflights] Loaded ${airportsMap.size} airports, ${airlinesMap.size} airlines, ${routesMap.size} route origins`);

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

/** Get direct destination IATA codes from an origin airport */
exports.getDirectDestinations = (iata) => {
  const set = routesMap.get(iata?.toUpperCase());
  return set ? Array.from(set) : [];
};

/** Resolve an ICAO 4-letter code to an IATA 3-letter code */
exports.getAirportByIcao = (icao) => {
  if (!icao || icao.length !== 4) return null;
  const iata = icaoMap.get(icao.toUpperCase());
  return iata ? airportsMap.get(iata) : null;
};
