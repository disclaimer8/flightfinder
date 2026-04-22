'use strict';
const { db } = require('./db');

const stmts = {
  upsert: db.prepare(`
    INSERT INTO airline_amenities (airline_iata, icao_type_hint, wifi, power, entertainment, meal, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(airline_iata, icao_type_hint) DO UPDATE SET
      wifi          = excluded.wifi,
      power         = excluded.power,
      entertainment = excluded.entertainment,
      meal          = excluded.meal,
      updated_at    = excluded.updated_at
  `),
  // Prefer a row with exact-matching icao_type_hint; fall back to the airline-wide row (hint = '').
  findForAirlineType: db.prepare(`
    SELECT wifi, power, entertainment, meal
      FROM airline_amenities
     WHERE airline_iata = ?
       AND (icao_type_hint = ? OR icao_type_hint = '')
     ORDER BY (icao_type_hint = ?) DESC
     LIMIT 1
  `),
};

module.exports = {
  upsert({ airlineIata, icaoTypeHint, wifi, power, entertainment, meal }) {
    stmts.upsert.run(
      airlineIata, icaoTypeHint || '',
      wifi ? 1 : 0, power ? 1 : 0, entertainment ? 1 : 0, meal ? 1 : 0,
      Date.now()
    );
  },
  findForAirlineType(airlineIata, icaoType) {
    const hint = icaoType || '';
    const row = stmts.findForAirlineType.get(airlineIata, hint, hint);
    if (!row) return null;
    return { wifi: !!row.wifi, power: !!row.power, entertainment: !!row.entertainment, meal: !!row.meal };
  },
};
