const { db } = require('./db');

const stmts = {
  get:    db.prepare('SELECT payload_json, fetched_at, expires_at FROM amadeus_cache WHERE endpoint = ? AND key = ?'),
  put:    db.prepare(`INSERT INTO amadeus_cache(endpoint, key, payload_json, fetched_at, expires_at)
                     VALUES (?, ?, ?, ?, ?)
                     ON CONFLICT(endpoint, key) DO UPDATE SET
                       payload_json = excluded.payload_json,
                       fetched_at   = excluded.fetched_at,
                       expires_at   = excluded.expires_at`),
  stale:  db.prepare(`SELECT key, payload_json, fetched_at, expires_at FROM amadeus_cache
                      WHERE endpoint = ? AND expires_at < ?
                      ORDER BY expires_at ASC
                      LIMIT ?`),
  getBudget: db.prepare('SELECT calls, errors FROM amadeus_budget WHERE day_utc = ?'),
  putBudget: db.prepare(`INSERT INTO amadeus_budget(day_utc, calls, errors)
                         VALUES (?, ?, ?)
                         ON CONFLICT(day_utc) DO UPDATE SET
                           calls  = amadeus_budget.calls  + excluded.calls,
                           errors = amadeus_budget.errors + excluded.errors`),
};

function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

function get(endpoint, key) {
  const row = stmts.get.get(endpoint, key);
  if (!row) return null;
  let payload;
  try { payload = JSON.parse(row.payload_json); }
  catch { return null; }
  return {
    payload,
    fetchedAt: row.fetched_at,
    expiresAt: row.expires_at,
    fresh: Date.now() < row.expires_at,
  };
}

function put(endpoint, key, payload, ttlMs) {
  const now = Date.now();
  stmts.put.run(endpoint, key, JSON.stringify(payload), now, now + ttlMs);
}

function getStale(endpoint, limit) {
  const rows = stmts.stale.all(endpoint, Date.now(), limit);
  return rows.map(r => ({
    key: r.key,
    payload: (() => { try { return JSON.parse(r.payload_json); } catch { return null; } })(),
    fetchedAt: r.fetched_at,
    expiresAt: r.expires_at,
  }));
}

function todayBudget() {
  const row = stmts.getBudget.get(todayUtc());
  return { calls: row?.calls ?? 0, errors: row?.errors ?? 0 };
}

function incrementBudget(callsDelta = 0, errorsDelta = 0) {
  stmts.putBudget.run(todayUtc(), callsDelta, errorsDelta);
}

module.exports = { get, put, getStale, todayBudget, incrementBudget };
