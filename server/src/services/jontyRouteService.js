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
  getAirlinesFromAirport,
  listAirportsByCountry,
};
