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
`);

// Prepared statements
const stmts = {
  getUserByEmail:    db.prepare('SELECT * FROM users WHERE email = ?'),
  getUserById:       db.prepare('SELECT id, email, created_at FROM users WHERE id = ?'),
  createUser:        db.prepare('INSERT INTO users (email, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?)'),
  createRefreshToken: db.prepare('INSERT INTO refresh_tokens (user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?)'),
  getRefreshToken:   db.prepare('SELECT * FROM refresh_tokens WHERE token_hash = ?'),
  deleteRefreshToken: db.prepare('DELETE FROM refresh_tokens WHERE token_hash = ?'),
  deleteExpiredTokens: db.prepare('DELETE FROM refresh_tokens WHERE expires_at < ?'),
};

function hashToken(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

module.exports = {
  getUserByEmail:   (email) => stmts.getUserByEmail.get(email),
  getUserById:      (id) => stmts.getUserById.get(id),
  createUser:       (email, passwordHash) => {
    const now = Date.now();
    return stmts.createUser.run(email, passwordHash, now, now);
  },
  createRefreshToken: (userId, tokenHash, expiresAt) => {
    return stmts.createRefreshToken.run(userId, tokenHash, expiresAt, Date.now());
  },
  getRefreshToken:  (tokenHash) => stmts.getRefreshToken.get(tokenHash),
  deleteRefreshToken: (tokenHash) => stmts.deleteRefreshToken.run(tokenHash),
  deleteExpiredTokens: () => stmts.deleteExpiredTokens.run(Date.now()),
  hashToken,
};
