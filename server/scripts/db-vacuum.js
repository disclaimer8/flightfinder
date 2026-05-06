#!/usr/bin/env node
/**
 * One-shot VACUUM for the production SQLite DB.
 *
 * Use case:
 *   - First time switching to auto_vacuum=INCREMENTAL on an existing,
 *     populated DB — pragma alone has no effect; a full VACUUM is required
 *     to reformat the file with auto-vacuum metadata.
 *   - Manual reclaim after a major refresh cycle (FAA registry monthly).
 *
 * Run on the prod server:
 *   ssh himaxym 'cd ~/flightfinder/server && pm2 stop flightfinder && \
 *                node scripts/db-vacuum.js && pm2 start flightfinder'
 *
 * The script:
 *   1. Opens the DB (read+write).
 *   2. Runs `PRAGMA wal_checkpoint(TRUNCATE)` to flush WAL.
 *   3. Runs `PRAGMA auto_vacuum = INCREMENTAL` (idempotent — sets if not set).
 *   4. Runs `VACUUM` (rewrites the file, applies the new auto_vacuum mode,
 *      reclaims all free pages — file size shrinks to ~live data + headers).
 *   5. Reports before/after sizes.
 *
 * Safe to abort mid-run; SQLite VACUUM is atomic via journal.
 */
'use strict';

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '../data/app.db');

function fmtSize(bytes) {
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

function statSize(p) {
  try { return fs.statSync(p).size; } catch { return 0; }
}

function main() {
  if (!fs.existsSync(DB_PATH)) {
    console.error(`db-vacuum: not found: ${DB_PATH}`);
    process.exit(1);
  }

  const dbBefore  = statSize(DB_PATH);
  const walBefore = statSize(DB_PATH + '-wal');
  console.log(`db-vacuum: BEFORE — db=${fmtSize(dbBefore)} wal=${fmtSize(walBefore)}`);

  const db = new Database(DB_PATH);
  console.log('db-vacuum: PRAGMA wal_checkpoint(TRUNCATE)…');
  db.pragma('wal_checkpoint(TRUNCATE)');
  console.log('db-vacuum: PRAGMA auto_vacuum = INCREMENTAL…');
  db.pragma('auto_vacuum = INCREMENTAL');
  console.log('db-vacuum: VACUUM (this may take a while for a large DB)…');
  const t0 = Date.now();
  db.exec('VACUUM');
  console.log(`db-vacuum: VACUUM done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  db.close();

  const dbAfter  = statSize(DB_PATH);
  const walAfter = statSize(DB_PATH + '-wal');
  const reclaimed = dbBefore - dbAfter;
  console.log(`db-vacuum: AFTER  — db=${fmtSize(dbAfter)} wal=${fmtSize(walAfter)}`);
  console.log(`db-vacuum: reclaimed ${fmtSize(reclaimed)} (${((reclaimed / dbBefore) * 100).toFixed(1)}% of original)`);
}

main();
