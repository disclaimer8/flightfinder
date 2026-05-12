'use strict';
const fs    = require('node:fs');
const os    = require('node:os');
const path  = require('node:path');
const { execFileSync } = require('node:child_process');

const model   = require('../models/accidentNarratives');
const sidecar = require('../services/sidecarAccidentsClient');
const { joinNtsbTables } = require('../services/ntsbParse');
const { buildAccidentSlugCandidate } = require('../utils/accidentSlug');

const NTSB_BASE = 'https://data.ntsb.gov/avdata';
const FULL_DUMP = 'avall.zip';

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { cur += '"'; i++; continue; }
        inQ = false;
      } else {
        cur += c;
      }
    } else {
      if (c === '"') {
        inQ = true;
      } else if (c === ',') {
        row.push(cur); cur = '';
      } else if (c === '\r') {
        // ignore — handled by \n
      } else if (c === '\n') {
        row.push(cur); cur = '';
        if (row.some(v => v !== '')) rows.push(row);
        row = [];
      } else {
        cur += c;
      }
    }
  }
  if (cur || row.length) {
    row.push(cur);
    if (row.some(v => v !== '')) rows.push(row);
  }
  if (rows.length === 0) return [];
  const headers = rows[0];
  return rows.slice(1).map(cells => {
    const obj = {};
    for (let j = 0; j < headers.length; j++) obj[headers[j]] = cells[j] ?? '';
    return obj;
  });
}

async function downloadDump(filename, dest) {
  const url = `${NTSB_BASE}/${filename}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`NTSB download ${url} → HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dest, buf);
}

function unzip(zipPath, destDir) {
  execFileSync('unzip', ['-o', '-q', zipPath, '-d', destDir], { stdio: 'inherit' });
}

function mdbExport(mdbPath, table, outFile) {
  execFileSync('mdb-export', [mdbPath, table], { stdio: ['ignore', fs.openSync(outFile, 'w'), 'pipe'] });
}

async function runIngest({ skipDownload = false, mdbPath = null } = {}) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ntsb-'));
  try {
  let chosenMdb = mdbPath;

  if (!skipDownload) {
    const zip = path.join(tmpDir, FULL_DUMP);
    await downloadDump(FULL_DUMP, zip);
    unzip(zip, tmpDir);
    const candidates = fs.readdirSync(tmpDir).filter(f => f.toLowerCase().endsWith('.mdb'));
    if (candidates.length === 0) throw new Error('No .mdb file found in NTSB dump');
    chosenMdb = path.join(tmpDir, candidates[0]);
  }

  // Table name → CSV file name mapping.
  // The MDB table is "occurrence" (singular); we pass it to joinNtsbTables as
  // the "occurrences" key which is what ntsbParse.js expects.
  const TABLE_DEFS = [
    { tableKey: 'events',      csvName: 'events',      mdbTable: 'events' },
    { tableKey: 'narratives',  csvName: 'narratives',  mdbTable: 'narratives' },
    { tableKey: 'findings',    csvName: 'findings',    mdbTable: 'findings' },
    { tableKey: 'occurrences', csvName: 'occurrence',  mdbTable: 'occurrence' },
    { tableKey: 'weather',     csvName: 'weather',     mdbTable: 'weather' },
    { tableKey: 'aircraft',    csvName: 'aircraft',    mdbTable: 'aircraft' },
  ];

  const csvDir = tmpDir;
  if (!skipDownload) {
    for (const def of TABLE_DEFS) {
      mdbExport(chosenMdb, def.mdbTable, path.join(csvDir, `${def.csvName}.csv`));
    }
  }

  const tables = {};
  for (const def of TABLE_DEFS) {
    const csvPath = path.join(csvDir, `${def.csvName}.csv`);
    if (!fs.existsSync(csvPath)) { tables[def.tableKey] = []; continue; }
    const text = fs.readFileSync(csvPath, 'utf8');
    tables[def.tableKey] = parseCsv(text);
  }

  const records = joinNtsbTables(tables);
  let ingested = 0;
  let unmatched = 0;
  const NOW = Math.floor(Date.now() / 1000);

  const { db } = require('../models/db');
  const txnChunk = 1000;
  for (let i = 0; i < records.length; i += txnChunk) {
    const slice = records.slice(i, i + txnChunk);
    db.transaction(() => {
      for (const rec of slice) {
        const accId = sidecar.getAccidentIdBySourceEventId(rec.ev_id);
        if (!accId) { unmatched++; continue; }
        const candidate = buildAccidentSlugCandidate({
          normalized_date: rec.ev_date,
          aircraft_model:  rec.ev_meta.aircraft_model,
          operator:        rec.ev_meta.operator,
          location:        rec.ev_meta.city
            ? `${rec.ev_meta.city}, ${rec.ev_meta.state || rec.ev_meta.country}`
            : '',
        });
        const finalSlug = model.finalSlug(candidate, accId);
        model.upsert({
          accident_id:     accId,
          source:          'ntsb',
          source_event_id: rec.ev_id,
          source_url:      `https://carol.ntsb.gov/event/${rec.ev_id}`,
          slug:            finalSlug,
          narrative_text:  rec.narrative_text,
          probable_cause:  rec.probable_cause,
          factors_json:    rec.factors_json,
          phase_of_flight: rec.phase_of_flight,
          weather_summary: rec.weather_summary,
          fetched_at:      NOW,
          ingested_at:     NOW,
          updated_at:      NOW,
        });
        ingested++;
      }
    })();
  }

  // Orphan cleanup: skipped in test env (no ATTACHed sidecar DB).
  if (process.env.NODE_ENV !== 'test') {
    try {
      db.exec(`
        ATTACH DATABASE '${process.env.SIDECAR_ACCIDENTS_DB || '/root/flightfinder/data/accidents.db'}' AS sc;
        DELETE FROM accident_narratives
        WHERE NOT EXISTS (SELECT 1 FROM sc.accidents WHERE id = accident_narratives.accident_id);
        DETACH DATABASE sc;
      `);
    } catch (e) { /* sidecar missing — skip */ }
  }

  return { ingested, unmatched };
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

function start() {
  const intervalMs = 24 * 3600 * 1000;
  const run = async () => {
    try {
      const r = await runIngest({});
      console.log(`[ntsbDumpWorker] ingested=${r.ingested} unmatched=${r.unmatched}`);
    } catch (e) {
      console.error('[ntsbDumpWorker] failed:', e.message);
    }
  };
  setTimeout(run, 60_000);
  setInterval(run, intervalMs);
}

module.exports = { start, runIngest };
