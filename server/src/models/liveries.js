'use strict';
const { db } = require('./db');

const stmts = {
  upsert: db.prepare(`
    INSERT INTO airline_liveries (airline_iata, icao_type, image_url, attribution, fetched_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(airline_iata, icao_type) DO UPDATE SET
      image_url   = excluded.image_url,
      attribution = excluded.attribution,
      fetched_at  = excluded.fetched_at
  `),
  get: db.prepare(`SELECT image_url, attribution, fetched_at
                     FROM airline_liveries
                    WHERE airline_iata = ? AND icao_type = ?`),
};

module.exports = {
  upsert({ airlineIata, icaoType, imageUrl, attribution }) {
    stmts.upsert.run(airlineIata, icaoType, imageUrl, attribution || null, Date.now());
  },
  get(airlineIata, icaoType) { return stmts.get.get(airlineIata, icaoType); },
};
