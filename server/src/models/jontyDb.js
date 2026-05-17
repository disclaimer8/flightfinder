'use strict';

const Database = require('better-sqlite3');
const path     = require('path');

const DB_PATH = path.join(__dirname, '../../data/jonty.db');

let _db = null;

/**
 * Returns a cached read-only connection to jonty.db.
 * Throws a clean Error if the file does not exist so the controller can
 * return 503 instead of letting better-sqlite3 throw an opaque SQLITE_CANTOPEN.
 */
function getDb() {
  if (_db) return _db;

  const fs = require('fs');
  if (!fs.existsSync(DB_PATH)) {
    throw new Error('jonty.db not present — run server/scripts/sync-jonty.js');
  }

  _db = new Database(DB_PATH, { readonly: true, fileMustExist: false });
  return _db;
}

/**
 * Closes the cached connection and resets the module-level handle.
 * Used by tests to release the file handle between test runs.
 */
function closeDb() {
  if (_db) {
    try { _db.close(); } catch { /* noop */ }
    _db = null;
  }
}

module.exports = { getDb, closeDb };
