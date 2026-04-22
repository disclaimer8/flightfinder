'use strict';
const { db } = require('./db');

const stmts = {
  upsert: db.prepare(`
    INSERT INTO push_tokens (user_id, endpoint, p256dh, auth, created_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(endpoint) DO UPDATE SET
      user_id = excluded.user_id,
      p256dh  = excluded.p256dh,
      auth    = excluded.auth
  `),
  listByUser: db.prepare('SELECT * FROM push_tokens WHERE user_id = ?'),
  removeEndpoint: db.prepare('DELETE FROM push_tokens WHERE endpoint = ?'),
};

module.exports = {
  upsert(userId, { endpoint, keys }) {
    stmts.upsert.run(userId, endpoint, keys.p256dh, keys.auth, Date.now());
  },
  listByUser(userId) { return stmts.listByUser.all(userId); },
  remove(endpoint) { stmts.removeEndpoint.run(endpoint); },
};
