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
const airlinesIcaoMap = new Map(); // ICAO → airline record (for reverse lookup when only ICAO provided)
parseCSV(path.join(__dirname, '../data/airlines.dat')).forEach(f => {
  const iata = f[3];
  if (iata && iata.length >= 2 && f[7] === 'Y') {
    const record = {
      iata,
      name: f[1],
      icao: f[4],
      country: f[6],
    };
    airlinesMap.set(iata, record);
    // Also index by ICAO for reverse lookup
    if (f[4]) {
      airlinesIcaoMap.set(f[4].toUpperCase(), record);
    }
  }
});

console.log(`[openflights] Loaded ${airportsMap.size} airports, ${airlinesMap.size} airlines`);

// Plan 6 — prefer OurAirports (nightly fresh) for coords/name/city/country/ICAO.
// OpenFlights is kept as the timezone source because OurAirports doesn't
// carry IANA tz strings, and as a fallback for airports OurAirports doesn't cover.
const ourAirports = require('./ourAirportsService');

/** Look up an airport by IATA code. Merges OurAirports (primary) + OpenFlights (timezone/fallback). */
exports.getAirport = (iata) => {
  const key = iata?.toUpperCase();
  if (!key) return null;
  const of = airportsMap.get(key) || null;
  const oa = ourAirports.isLoaded() ? ourAirports.getAirport(key) : null;
  if (!of && !oa) return null;
  return {
    iata: key,
    icao:    oa?.icao    ?? of?.icao    ?? null,
    name:    oa?.name    ?? of?.name    ?? null,
    city:    oa?.city    ?? of?.city    ?? null,
    country: oa?.country ?? of?.country ?? null,
    lat:     Number.isFinite(oa?.lat) ? oa.lat : (Number.isFinite(of?.lat) ? of.lat : null),
    lon:     Number.isFinite(oa?.lon) ? oa.lon : (Number.isFinite(of?.lon) ? of.lon : null),
    timezone: of?.timezone || null,
  };
};

/** Look up an airline by IATA code */
exports.getAirline = (iata) => airlinesMap.get(iata?.toUpperCase()) || null;

/** Look up an airline by ICAO code */
exports.getAirlineByIcao = (icao) => airlinesIcaoMap.get(icao?.toUpperCase()) || null;

/** Validate that an IATA airport code exists */
exports.isValidAirport = (iata) => airportsMap.has(iata?.toUpperCase());

/** Get city name for an airport code */
exports.getCity = (iata) => airportsMap.get(iata?.toUpperCase())?.city || iata;

/** Get country for an airport code */
exports.getCountry = (iata) => airportsMap.get(iata?.toUpperCase())?.country || null;

/** Get all airports as array (for search UI) */
exports.getAllAirports = () => Array.from(airportsMap.values());

/** Resolve an ICAO 4-letter code to an IATA 3-letter code */
exports.getAirportByIcao = (icao) => {
  if (!icao || icao.length !== 4) return null;
  const iata = icaoMap.get(icao.toUpperCase());
  return iata ? airportsMap.get(iata) : null;
};

/** Convert an ICAO airport code to IATA (e.g. KLAX → LAX). Returns null when not found. */
exports.iataForIcao = (icao) => {
  if (!icao || typeof icao !== 'string') return null;
  return icaoMap.get(icao.toUpperCase()) || null;
};
