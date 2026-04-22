'use strict';

const fs = require('fs');
const path = require('path');
const ourAirports = require('../services/ourAirportsService');

const SOURCE_URL = 'https://davidmegginson.github.io/ourairports-data/airports.csv';
const OUT_PATH = path.resolve(__dirname, '../../data/ourairports.csv');
const TMP_PATH = `${OUT_PATH}.tmp`;

const INITIAL_DELAY_MS  = 2 * 60 * 1000;       // 2 min after boot
const CYCLE_INTERVAL_MS = 24 * 60 * 60 * 1000; // daily

async function downloadOnce() {
  const res = await fetch(SOURCE_URL);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  // Sanity: refuse to overwrite with a tiny payload (e.g. a redirect error page).
  if (buf.length < 1_000_000) throw new Error(`payload too small: ${buf.length} bytes`);
  fs.writeFileSync(TMP_PATH, buf);
  fs.renameSync(TMP_PATH, OUT_PATH); // atomic swap
  const loaded = ourAirports.loadFromCsv(OUT_PATH);
  console.log(`[ourairports-refresh] downloaded ${buf.length} bytes, reloaded ${loaded} airports`);
}

async function runCycle() {
  try { await downloadOnce(); }
  catch (err) { console.warn('[ourairports-refresh] failed:', err.message); }
}

exports.startOurAirportsRefreshWorker = () => {
  if (process.env.OURAIRPORTS_REFRESH !== '1') {
    console.log('[ourairports-refresh] disabled (OURAIRPORTS_REFRESH != 1)');
    return () => {};
  }
  let intervalTimer = null;
  const initialTimer = setTimeout(() => {
    runCycle();
    intervalTimer = setInterval(runCycle, CYCLE_INTERVAL_MS);
  }, INITIAL_DELAY_MS);
  console.log(`[ourairports-refresh] scheduled: first pull in ${INITIAL_DELAY_MS/1000}s, then every 24h`);
  return function stop() {
    clearTimeout(initialTimer);
    if (intervalTimer) clearInterval(intervalTimer);
  };
};

exports._runCycleForTest = runCycle;
