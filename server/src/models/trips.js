'use strict';
const { db } = require('./db');

const stmts = {
  create: db.prepare(`
    INSERT INTO user_trips
      (user_id, airline_iata, flight_number, dep_iata, arr_iata, scheduled_dep, scheduled_arr, note, alerts_enabled, created_at)
    VALUES (@user_id, @airline_iata, @flight_number, @dep_iata, @arr_iata, @scheduled_dep, @scheduled_arr, @note, @alerts_enabled, @now)
  `),
  listByUser: db.prepare(`
    SELECT * FROM user_trips WHERE user_id = ? ORDER BY scheduled_dep ASC
  `),
  getOwned: db.prepare(`
    SELECT * FROM user_trips WHERE id = ? AND user_id = ?
  `),
  deleteOwned: db.prepare(`
    DELETE FROM user_trips WHERE id = ? AND user_id = ?
  `),
  listUpcomingWithAlerts: db.prepare(`
    SELECT * FROM user_trips
     WHERE alerts_enabled = 1 AND scheduled_dep > ? AND scheduled_dep < ?
  `),
};

module.exports = {
  create(row) {
    const info = stmts.create.run({ now: Date.now(), alerts_enabled: 1, note: null, ...row });
    return info.lastInsertRowid;
  },
  listByUser(userId)  { return stmts.listByUser.all(userId); },
  getOwned(tripId, userId) { return stmts.getOwned.get(tripId, userId); },
  deleteOwned(tripId, userId) {
    const info = stmts.deleteOwned.run(tripId, userId);
    return info.changes === 1;
  },
  listUpcomingWithAlerts(fromMs, toMs) { return stmts.listUpcomingWithAlerts.all(fromMs, toMs); },
};
