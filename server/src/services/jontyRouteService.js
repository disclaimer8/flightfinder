'use strict';

const jontyDb = require('../models/jontyDb');

function getAirportMeta(iata) {
  const db = jontyDb.getDb();
  return db.prepare(
    `SELECT iata, icao, name, city, country, country_code, continent,
            latitude, longitude, elevation, timezone, display_name
     FROM airports WHERE iata = ?`
  ).get(iata) || null;
}

function getDeparturesFromAirport(iata) {
  const db = jontyDb.getDb();
  const rows = db.prepare(`
    SELECT r.dest_iata,
           a.name AS dest_name, a.city AS dest_city, a.country AS dest_country, a.country_code AS dest_country_code,
           r.km, r.duration_min,
           rc.carrier_iata, rc.carrier_name
    FROM routes r
    LEFT JOIN airports a ON a.iata = r.dest_iata
    LEFT JOIN route_carriers rc ON rc.origin_iata = r.origin_iata AND rc.dest_iata = r.dest_iata
    WHERE r.origin_iata = ?
    ORDER BY r.dest_iata, rc.carrier_iata
  `).all(iata);
  return groupRoutes(rows, 'dest_iata');
}

function getArrivalsToAirport(iata) {
  const db = jontyDb.getDb();
  const rows = db.prepare(`
    SELECT r.origin_iata,
           a.name AS origin_name, a.city AS origin_city, a.country AS origin_country, a.country_code AS origin_country_code,
           r.km, r.duration_min,
           rc.carrier_iata, rc.carrier_name
    FROM routes r
    LEFT JOIN airports a ON a.iata = r.origin_iata
    LEFT JOIN route_carriers rc ON rc.origin_iata = r.origin_iata AND rc.dest_iata = r.dest_iata
    WHERE r.dest_iata = ?
    ORDER BY r.origin_iata, rc.carrier_iata
  `).all(iata);
  return groupRoutes(rows, 'origin_iata');
}

function getAirlineNetwork(carrierIata) {
  const db = jontyDb.getDb();
  return db.prepare(`
    SELECT rc.origin_iata, rc.dest_iata, rc.carrier_name,
           ao.city AS origin_city, ao.country AS origin_country,
           ad.city AS dest_city, ad.country AS dest_country,
           r.km, r.duration_min
    FROM route_carriers rc
    JOIN routes r ON r.origin_iata = rc.origin_iata AND r.dest_iata = rc.dest_iata
    LEFT JOIN airports ao ON ao.iata = rc.origin_iata
    LEFT JOIN airports ad ON ad.iata = rc.dest_iata
    WHERE rc.carrier_iata = ?
    ORDER BY rc.origin_iata, rc.dest_iata
  `).all(carrierIata);
}

// Lightweight name+count query for airlineMeta (Path B I2 follow-up).
// Returns { carrier_name, routeCount } for the dominant name of the carrier,
// or null if jonty has no rows for it. Uses leftmost prefix of the composite
// index idx_route_carriers_carrier(carrier_iata, origin_iata) — nearly free
// vs the full 4-table JOIN in getAirlineNetwork().
function getCarrierMeta(carrierIata) {
  const db = jontyDb.getDb();
  return db.prepare(`
    SELECT carrier_name, COUNT(*) AS routeCount
    FROM route_carriers
    WHERE carrier_iata = ?
      AND carrier_name IS NOT NULL
      AND carrier_name != ''
    GROUP BY carrier_name
    ORDER BY routeCount DESC
    LIMIT 1
  `).get(carrierIata) || null;
}

// Lightweight destinations-only query for alliance bake (Wave 3a C2/I1 fix).
// Returns distinct (origin_iata, dest_iata) pairs for the carrier. Uses the
// composite index idx_route_carriers_carrier(carrier_iata, origin_iata) from
// B3 — far cheaper than the 4-table JOIN in getAirlineNetwork().
function getCarrierDestinations(carrierIata) {
  const db = jontyDb.getDb();
  return db.prepare(`
    SELECT DISTINCT origin_iata, dest_iata
    FROM route_carriers
    WHERE carrier_iata = ?
  `).all(carrierIata);
}

function getAirlinesFromAirport(iata) {
  const db = jontyDb.getDb();
  return db.prepare(`
    SELECT rc.carrier_iata AS iata, rc.carrier_name AS name, COUNT(*) AS route_count
    FROM route_carriers rc
    WHERE rc.origin_iata = ?
    GROUP BY rc.carrier_iata, rc.carrier_name
    ORDER BY route_count DESC, rc.carrier_iata ASC
  `).all(iata);
}

function listAirportsByCountry(countryCode) {
  const db = jontyDb.getDb();
  return db.prepare(`
    SELECT iata, name, city, country
    FROM airports WHERE country_code = ?
    ORDER BY iata
  `).all(countryCode);
}

// Aggregate stats for /country/:cc landing page (Wave 3b).
// Returns null when the country has no airports in jonty. All queries hit
// idx_airports_country (sync-jonty.js SCHEMA) and the composite
// idx_route_carriers_carrier(carrier_iata, origin_iata) from Wave 2 B3 for
// cheap per-country aggregation.
function getCountryStats(countryCode) {
  if (!countryCode) return null;
  const cc = String(countryCode).toUpperCase();
  const db = jontyDb.getDb();

  const airportCountRow = db.prepare(
    `SELECT COUNT(*) AS c FROM airports WHERE country_code = ?`
  ).get(cc);
  if (!airportCountRow || airportCountRow.c === 0) return null;

  const routeCountRow = db.prepare(`
    SELECT COUNT(*) AS c FROM route_carriers rc
    JOIN airports a ON a.iata = rc.origin_iata
    WHERE a.country_code = ?
  `).get(cc);

  const topAirports = db.prepare(`
    SELECT rc.origin_iata AS iata, a.name AS name, a.city AS city, COUNT(*) AS routeCount
    FROM route_carriers rc
    JOIN airports a ON a.iata = rc.origin_iata
    WHERE a.country_code = ?
    GROUP BY rc.origin_iata
    ORDER BY routeCount DESC, rc.origin_iata
    LIMIT 10
  `).all(cc);

  const topAirlines = db.prepare(`
    SELECT rc.carrier_iata AS iata, rc.carrier_name AS name, COUNT(*) AS routeCount
    FROM route_carriers rc
    JOIN airports a ON a.iata = rc.origin_iata
    WHERE a.country_code = ?
    GROUP BY rc.carrier_iata
    ORDER BY routeCount DESC, rc.carrier_iata
    LIMIT 10
  `).all(cc);

  const popularRoutes = db.prepare(`
    SELECT rc.origin_iata AS origin, rc.dest_iata AS dest, COUNT(DISTINCT rc.carrier_iata) AS carrierCount
    FROM route_carriers rc
    JOIN airports a ON a.iata = rc.origin_iata
    WHERE a.country_code = ?
    GROUP BY rc.origin_iata, rc.dest_iata
    ORDER BY carrierCount DESC, rc.origin_iata, rc.dest_iata
    LIMIT 10
  `).all(cc);

  return {
    code: cc,
    airportCount: airportCountRow.c,
    routeCount: routeCountRow ? routeCountRow.c : 0,
    topAirports,
    topAirlines,
    popularRoutes,
  };
}

// Helper — group flat JOIN rows into {route, carriers[]}
function groupRoutes(flatRows, keyField) {
  const map = new Map();
  for (const r of flatRows) {
    if (!map.has(r[keyField])) {
      const base = { ...r, carriers: [] };
      delete base.carrier_iata;
      delete base.carrier_name;
      map.set(r[keyField], base);
    }
    if (r.carrier_iata) {
      map.get(r[keyField]).carriers.push({ iata: r.carrier_iata, name: r.carrier_name });
    }
  }
  return Array.from(map.values());
}

module.exports = {
  getAirportMeta,
  getDeparturesFromAirport,
  getArrivalsToAirport,
  getAirlineNetwork,
  getCarrierMeta,
  getCarrierDestinations,
  getAirlinesFromAirport,
  listAirportsByCountry,
  getCountryStats,
};
