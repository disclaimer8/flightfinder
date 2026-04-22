const Database = require('better-sqlite3');
const path = require('path');
const crypto = require('crypto');

const DB_PATH = process.env.NODE_ENV === 'test'
  ? ':memory:'
  : path.join(__dirname, '../../data/app.db');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Schema
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    email         TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at    INTEGER NOT NULL,
    updated_at    INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS refresh_tokens (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash  TEXT UNIQUE NOT NULL,
    expires_at  INTEGER NOT NULL,
    created_at  INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS email_verification_tokens (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash  TEXT UNIQUE NOT NULL,
    expires_at  INTEGER NOT NULL,
    created_at  INTEGER NOT NULL
  );
`);

// Migration: add email_verified to users (existing users are treated as already verified)
try {
  db.exec('ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0');
  db.exec('UPDATE users SET email_verified = 1');
} catch {
  // Column already exists — migration already ran
}

// Migration: subscription tier columns (see spec 2026-04-22-subscription-pivot-design.md)
try { db.exec('ALTER TABLE users ADD COLUMN subscription_tier TEXT NOT NULL DEFAULT "free"'); } catch {}
try { db.exec('ALTER TABLE users ADD COLUMN sub_valid_until INTEGER'); } catch {}
try { db.exec('ALTER TABLE users ADD COLUMN stripe_customer_id TEXT'); } catch {}
try { db.exec('CREATE UNIQUE INDEX idx_users_stripe_cust ON users(stripe_customer_id) WHERE stripe_customer_id IS NOT NULL'); } catch {}

// subscriptions: one row per Stripe subscription (or one-time lifetime charge).
db.exec(`
  CREATE TABLE IF NOT EXISTS subscriptions (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    stripe_sub_id     TEXT UNIQUE,
    stripe_session_id TEXT,
    tier              TEXT NOT NULL,
    status            TEXT NOT NULL,
    period_end        INTEGER,
    trial_end         INTEGER,
    created_at        INTEGER NOT NULL,
    updated_at        INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_subs_user ON subscriptions(user_id);
`);

// Single-row counter for the 500-slot lifetime Founders tier.
db.exec(`
  CREATE TABLE IF NOT EXISTS lifetime_counter (
    id    INTEGER PRIMARY KEY CHECK (id = 1),
    taken INTEGER NOT NULL DEFAULT 0,
    cap   INTEGER NOT NULL DEFAULT 500
  );
`);
db.exec('INSERT OR IGNORE INTO lifetime_counter (id, taken, cap) VALUES (1, 0, 500)');

// Webhook event dedup — Stripe retries are common, event.id is guaranteed unique.
db.exec(`
  CREATE TABLE IF NOT EXISTS webhook_events (
    id          TEXT PRIMARY KEY,
    received_at INTEGER NOT NULL
  );
`);

// observed_routes: append-only store of (dep, arr, aircraft_icao) tuples we've
// actually seen airborne via AirLabs /flights. UNIQUE key means we UPSERT seen_at.
// Bounded by airports × destinations × aircraft_types ≈ tens of thousands of rows.
db.exec(`
  CREATE TABLE IF NOT EXISTS observed_routes (
    dep_iata       TEXT NOT NULL,
    arr_iata       TEXT NOT NULL,
    aircraft_icao  TEXT NOT NULL,
    airline_iata   TEXT,
    seen_at        INTEGER NOT NULL,
    first_seen_at  INTEGER NOT NULL,
    PRIMARY KEY (dep_iata, arr_iata, aircraft_icao)
  );
  CREATE INDEX IF NOT EXISTS idx_observed_dep        ON observed_routes(dep_iata, seen_at);
  CREATE INDEX IF NOT EXISTS idx_observed_dep_arr    ON observed_routes(dep_iata, arr_iata);
  CREATE INDEX IF NOT EXISTS idx_observed_aircraft   ON observed_routes(aircraft_icao, seen_at);
`);

// aircraft_db: static hex (ICAO24) -> aircraft metadata map, bootstrapped from an
// upstream public dataset (Mictronics readsb aircrafts.json, ~500k rows). Used to
// resolve AeroDataBox `modeS` fields into ICAO type codes (B77W, A320, etc.) since
// AeroDataBox itself doesn't return modelCode.
db.exec(`
  CREATE TABLE IF NOT EXISTS aircraft_db (
    hex          TEXT PRIMARY KEY,
    icao_type    TEXT,
    reg          TEXT,
    updated_at   INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_aircraft_db_type ON aircraft_db(icao_type);
`);

// Prepared statements
const stmts = {
  getUserByEmail:    db.prepare('SELECT * FROM users WHERE email = ?'),
  getUserById:       db.prepare('SELECT id, email, email_verified, created_at FROM users WHERE id = ?'),
  createUser:        db.prepare('INSERT INTO users (email, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?)'),
  verifyUserEmail:   db.prepare('UPDATE users SET email_verified = 1, updated_at = ? WHERE id = ?'),
  createRefreshToken: db.prepare('INSERT INTO refresh_tokens (user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?)'),
  getRefreshToken:   db.prepare('SELECT * FROM refresh_tokens WHERE token_hash = ?'),
  deleteRefreshToken: db.prepare('DELETE FROM refresh_tokens WHERE token_hash = ?'),
  deleteExpiredTokens: db.prepare('DELETE FROM refresh_tokens WHERE expires_at < ?'),
  createVerificationToken: db.prepare('INSERT INTO email_verification_tokens (user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?)'),
  getVerificationToken: db.prepare('SELECT * FROM email_verification_tokens WHERE token_hash = ?'),
  deleteVerificationToken: db.prepare('DELETE FROM email_verification_tokens WHERE token_hash = ?'),
  deleteVerificationTokensByUser: db.prepare('DELETE FROM email_verification_tokens WHERE user_id = ?'),
  deleteExpiredVerificationTokens: db.prepare('DELETE FROM email_verification_tokens WHERE expires_at < ?'),

  upsertObservedRoute: db.prepare(`
    INSERT INTO observed_routes (dep_iata, arr_iata, aircraft_icao, airline_iata, seen_at, first_seen_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(dep_iata, arr_iata, aircraft_icao) DO UPDATE SET
      seen_at = excluded.seen_at,
      airline_iata = COALESCE(excluded.airline_iata, observed_routes.airline_iata)
  `),
  observedAircraftByRoute: db.prepare(`
    SELECT aircraft_icao, seen_at FROM observed_routes
    WHERE dep_iata = ? AND arr_iata = ? AND seen_at >= ?
    ORDER BY seen_at DESC
  `),
  observedDestinationsFromDep: db.prepare(`
    SELECT DISTINCT arr_iata FROM observed_routes
    WHERE dep_iata = ? AND seen_at >= ?
  `),
  observedStats: db.prepare(`
    SELECT COUNT(*) AS total,
           COUNT(DISTINCT dep_iata) AS airports,
           COUNT(DISTINCT aircraft_icao) AS aircraft_types,
           MIN(first_seen_at) AS oldest
    FROM observed_routes
  `),

  // Hubs = airports whose distinct-destination count is >= minDests, capped at hubLimit
  // (ordered by popularity desc). Used by GET /api/map/hub-network to draw a baseline graph.
  hubsByDestCount: db.prepare(`
    SELECT dep_iata AS iata, COUNT(DISTINCT arr_iata) AS n
    FROM observed_routes
    GROUP BY dep_iata
    HAVING n >= ?
    ORDER BY n DESC
    LIMIT ?
  `),

  getAircraftByHex: db.prepare('SELECT hex, icao_type, reg FROM aircraft_db WHERE hex = ?'),
  upsertAircraft:   db.prepare(`
    INSERT INTO aircraft_db (hex, icao_type, reg, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(hex) DO UPDATE SET
      icao_type  = excluded.icao_type,
      reg        = excluded.reg,
      updated_at = excluded.updated_at
  `),
  aircraftDbSize:   db.prepare('SELECT COUNT(*) AS n FROM aircraft_db'),
};

// Bulk insert helper — wraps a transaction around N upsertAircraft calls. Used by the
// aircraftDbService bootstrap to land ~500k rows in one go (~1s on a laptop).
const bulkUpsertAircraft = db.transaction((rows) => {
  const now = Date.now();
  for (const r of rows) {
    stmts.upsertAircraft.run(r.hex, r.icaoType || null, r.reg || null, now);
  }
});

function hashToken(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

module.exports = {
  db,
  getUserByEmail:   (email) => stmts.getUserByEmail.get(email),
  getUserById:      (id) => stmts.getUserById.get(id),
  createUser:       (email, passwordHash) => {
    const now = Date.now();
    return stmts.createUser.run(email, passwordHash, now, now);
  },
  verifyUserEmail:  (userId) => stmts.verifyUserEmail.run(Date.now(), userId),
  createRefreshToken: (userId, tokenHash, expiresAt) => {
    return stmts.createRefreshToken.run(userId, tokenHash, expiresAt, Date.now());
  },
  getRefreshToken:  (tokenHash) => stmts.getRefreshToken.get(tokenHash),
  deleteRefreshToken: (tokenHash) => stmts.deleteRefreshToken.run(tokenHash),
  deleteExpiredTokens: () => stmts.deleteExpiredTokens.run(Date.now()),
  createVerificationToken: (userId, tokenHash, expiresAt) => {
    return stmts.createVerificationToken.run(userId, tokenHash, expiresAt, Date.now());
  },
  getVerificationToken: (tokenHash) => stmts.getVerificationToken.get(tokenHash),
  deleteVerificationToken: (tokenHash) => stmts.deleteVerificationToken.run(tokenHash),
  deleteVerificationTokensByUser: (userId) => stmts.deleteVerificationTokensByUser.run(userId),
  deleteExpiredVerificationTokens: () => stmts.deleteExpiredVerificationTokens.run(Date.now()),

  upsertObservedRoute: ({ depIata, arrIata, aircraftIcao, airlineIata }) => {
    const now = Date.now();
    return stmts.upsertObservedRoute.run(depIata, arrIata, aircraftIcao, airlineIata || null, now, now);
  },
  observedAircraftByRoute: (depIata, arrIata, sinceMs) =>
    stmts.observedAircraftByRoute.all(depIata, arrIata, sinceMs),
  observedDestinationsFromDep: (depIata, sinceMs) =>
    stmts.observedDestinationsFromDep.all(depIata, sinceMs).map(r => r.arr_iata),
  observedStats: () => stmts.observedStats.get(),

  /**
   * Build the "hub network" — the backbone of popular inter-hub routes used by the
   * client RouteMap as a faint baseline graph behind airport dots.
   *
   *   1. Hub set  = top `hubLimit` airports by distinct-destination count, with a
   *                 `minDests` floor. Dynamic: changes as observed_routes grows.
   *   2. Edges    = all distinct (dep, arr) pairs in observed_routes where BOTH
   *                 endpoints are in the hub set. Each pair is emitted once in
   *                 lexicographic order (A<Z). Capped at `edgeLimit`, preferring
   *                 higher observation counts.
   *
   * @returns {{ edges: Array<[string,string]>, hubs: string[] }}
   */
  getHubNetwork: ({ hubLimit = 200, minDests = 20, edgeLimit = 3000 } = {}) => {
    const hubRows = stmts.hubsByDestCount.all(minDests, hubLimit);
    const hubs = hubRows.map(r => r.iata);
    if (hubs.length < 2) return { edges: [], hubs };

    // SQLite has a default max of 999 host parameters; 200 hubs × 2 uses = 400, safe.
    const placeholders = hubs.map(() => '?').join(',');
    // For each unordered pair (a<b), total observations in EITHER direction.
    // Using MIN/MAX collapses (A,B) and (B,A) into a single lexicographic pair.
    const sql = `
      SELECT
        CASE WHEN dep_iata < arr_iata THEN dep_iata ELSE arr_iata END AS a,
        CASE WHEN dep_iata < arr_iata THEN arr_iata ELSE dep_iata END AS b,
        COUNT(*) AS obs
      FROM observed_routes
      WHERE dep_iata IN (${placeholders})
        AND arr_iata IN (${placeholders})
        AND dep_iata <> arr_iata
      GROUP BY a, b
      ORDER BY obs DESC, a ASC, b ASC
      LIMIT ?
    `;
    const rows = db.prepare(sql).all(...hubs, ...hubs, edgeLimit);
    const edges = rows.map(r => [r.a, r.b]);
    return { edges, hubs };
  },

  /**
   * Aggregate observed_routes rows for a family + origin set within a time window.
   * Returns rows of { dep, arr, icaoTypes (CSV string), count, lastSeen (ms) }.
   * Frontend contract is defined in controllers/aircraftController.getAircraftRoutes.
   *
   * @param {object} args
   * @param {string[]} args.icaoList  ICAO type codes (e.g. ['A343','A346'])
   * @param {string[]} args.origins   origin IATA codes, already upper-cased
   * @param {number}   args.cutoffMs  unix ms — exclude rows older than this
   */
  getAircraftRoutes: ({ icaoList, origins, cutoffMs }) => {
    if (!icaoList?.length) return [];
    const acPh = icaoList.map(() => '?').join(',');
    const hasOrigins = Array.isArray(origins) && origins.length > 0;
    const originClause = hasOrigins
      ? `AND dep_iata IN (${origins.map(() => '?').join(',')})`
      : '';
    const sql = `
      SELECT dep_iata AS dep,
             arr_iata AS arr,
             GROUP_CONCAT(DISTINCT aircraft_icao) AS icaoTypes,
             COUNT(*) AS count,
             MAX(seen_at) AS lastSeen
      FROM observed_routes
      WHERE aircraft_icao IN (${acPh})
        ${originClause}
        AND seen_at       >= ?
      GROUP BY dep_iata, arr_iata
      ORDER BY count DESC, dep ASC, arr ASC
      LIMIT 500
    `;
    const params = hasOrigins
      ? [...icaoList, ...origins, cutoffMs]
      : [...icaoList, cutoffMs];
    return db.prepare(sql).all(...params);
  },

  /**
   * Quick existence check — does ANY observed row exist for this family
   * where dep_iata = ? within the window? Used by the /aircraft/routes
   * suggestions branch to score nearby airports cheaply.
   */
  countFamilyRoutesFromOrigin: ({ icaoList, origin, cutoffMs }) => {
    if (!icaoList?.length) return 0;
    const acPh = icaoList.map(() => '?').join(',');
    const sql = `
      SELECT COUNT(DISTINCT arr_iata) AS n
      FROM observed_routes
      WHERE aircraft_icao IN (${acPh})
        AND dep_iata = ?
        AND seen_at >= ?
    `;
    const row = db.prepare(sql).get(...icaoList, origin, cutoffMs);
    return row?.n || 0;
  },

  getAircraftByHex: (hex) => {
    if (!hex) return null;
    return stmts.getAircraftByHex.get(String(hex).toLowerCase()) || null;
  },
  upsertAircraft: ({ hex, icaoType, reg }) => {
    if (!hex) return null;
    return stmts.upsertAircraft.run(String(hex).toLowerCase(), icaoType || null, reg || null, Date.now());
  },
  bulkUpsertAircraft: (rows) => bulkUpsertAircraft(rows),
  aircraftDbSize: () => stmts.aircraftDbSize.get().n,

  hashToken,
};
