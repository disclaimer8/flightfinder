'use strict';
const { db } = require('./db');

const stmts = {
  upsert: db.prepare(`
    INSERT INTO flight_observations
      (dep_iata, arr_iata, airline_iata, flight_number, aircraft_icao,
       scheduled_dep, actual_dep, scheduled_arr, actual_arr,
       delay_minutes, status, observed_at)
    VALUES
      (@dep_iata, @arr_iata, @airline_iata, @flight_number, @aircraft_icao,
       @scheduled_dep, @actual_dep, @scheduled_arr, @actual_arr,
       @delay_minutes, @status, @observed_at)
    ON CONFLICT(airline_iata, flight_number, scheduled_dep) DO UPDATE SET
      actual_dep     = excluded.actual_dep,
      actual_arr     = excluded.actual_arr,
      delay_minutes  = excluded.delay_minutes,
      status         = excluded.status,
      aircraft_icao  = COALESCE(excluded.aircraft_icao, flight_observations.aircraft_icao),
      observed_at    = excluded.observed_at
  `),
  byExactFlight: db.prepare(`
    SELECT delay_minutes FROM flight_observations
     WHERE airline_iata = ? AND flight_number = ?
       AND observed_at > ? AND status = 'completed' AND delay_minutes IS NOT NULL
  `),
  byRouteAirline: db.prepare(`
    SELECT delay_minutes FROM flight_observations
     WHERE dep_iata = ? AND arr_iata = ? AND airline_iata = ?
       AND observed_at > ? AND status = 'completed' AND delay_minutes IS NOT NULL
  `),
  topRoutes: db.prepare(`
    SELECT dep_iata, arr_iata, COUNT(*) AS n
      FROM observed_routes
     WHERE seen_at > ?
     GROUP BY dep_iata, arr_iata
     ORDER BY n DESC
     LIMIT ?
  `),
};

module.exports = {
  upsertObservation(row) { stmts.upsert.run(row); },
  getByExactFlight(airline, flightNumber, sinceMs) {
    return stmts.byExactFlight.all(airline, flightNumber, sinceMs);
  },
  getByRouteAirline(dep, arr, airline, sinceMs) {
    return stmts.byRouteAirline.all(dep, arr, airline, sinceMs);
  },
  getTopRoutes(sinceMs, limit = 30) {
    return stmts.topRoutes.all(sinceMs, limit);
  },
};
