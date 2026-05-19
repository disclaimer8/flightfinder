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
  // Downcase headers so downstream code can use a single case convention
  // regardless of the MDB schema (which mixes lower / PascalCase per table).
  const headers = rows[0].map(h => String(h).toLowerCase());
  return rows.slice(1).map(cells => {
    const obj = {};
    for (let j = 0; j < headers.length; j++) obj[headers[j]] = cells[j] ?? '';
    return obj;
  });
}

async function downloadDump(filename, dest) {
  // NTSB switched (2025-ish) from a static-file URL pattern (avdata/<file>.zip)
  // to a query-string-driven download proxy that takes the original Windows path
  // as a URL-encoded fileID. The static URL now returns 404 even though the file
  // listing still appears at https://data.ntsb.gov/avdata/.
  const fileId = `C:\\avdata\\${filename}`;
  const url = `${NTSB_BASE}/FileDirectory/DownloadFile?fileID=${encodeURIComponent(fileId)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`NTSB download ${url} → HTTP ${res.status}`);
  // We previously tried `pipeline(Readable.fromWeb(res.body), createWriteStream)`
  // to avoid a 94 MB heap allocation, but it produced corrupt files (unzip then
  // failed with no error message). With --max-old-space-size=6144 the simple
  // arrayBuffer path is fine — ~200 MB transient is well within budget.
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dest, buf);
  // Sanity check: NTSB avall.zip is ~94 MB; anything <1 MB means broken
  // download (HTML error page, redirect, etc).
  const stat = fs.statSync(dest);
  if (stat.size < 1_000_000) throw new Error(`NTSB download too small (${stat.size}b) — likely error page`);
}

function unzip(zipPath, destDir) {
  execFileSync('unzip', ['-o', '-q', zipPath, '-d', destDir], { stdio: 'inherit' });
}

function mdbExport(mdbPath, table, outFile) {
  execFileSync('mdb-export', [mdbPath, table], { stdio: ['ignore', fs.openSync(outFile, 'w'), 'pipe'] });
}

async function runIngest({ skipDownload = false, mdbPath = null } = {}) {
  // os.tmpdir() returns /tmp which on many Linux boxes is a tmpfs sized at a
  // small fraction of RAM (e.g. 256 MB). avall.mdb uncompresses to 600+ MB and
  // fails with "write error (disk full?)". Use /var/tmp (or an explicit env
  // override) which lives on the regular disk.
  const tmpRoot = process.env.NTSB_TMPDIR || '/var/tmp';
  const tmpDir = fs.mkdtempSync(path.join(tmpRoot, 'ntsb-'));
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
  // NTSB MDB uses mixed-case table names; mdb-export is case-sensitive.
  // Weather fields live INSIDE the events table (wx_cond_basic, wind_dir_deg,
  // wind_vel_kts, vis_sm) — there is no separate weather table.
  const TABLE_DEFS = [
    { tableKey: 'events',      csvName: 'events',      mdbTable: 'events' },
    { tableKey: 'narratives',  csvName: 'narratives',  mdbTable: 'narratives' },
    { tableKey: 'findings',    csvName: 'findings',    mdbTable: 'Findings' },
    { tableKey: 'occurrences', csvName: 'occurrences', mdbTable: 'Occurrences' },
    { tableKey: 'aircraft',    csvName: 'aircraft',    mdbTable: 'aircraft' },
  ];

  const csvDir = tmpDir;
  if (!skipDownload) {
    for (const def of TABLE_DEFS) {
      mdbExport(chosenMdb, def.mdbTable, path.join(csvDir, `${def.csvName}.csv`));
    }
  }

  // Pre-fetch sidecar ev_id → accident_id map. Filtering CSVs by this set
  // BEFORE retaining them in memory drops peak RAM from ~1.5GB (full 92K-row
  // NTSB dataset × 5 tables) to ~150MB (sidecar's ~30K matching events only).
  // Without the prefilter the worker is OOM-killed (exit 137) on VPSes with
  // <4GB free RAM.
  const evIdToAccId = (process.env.NODE_ENV !== 'test')
    ? sidecar.getNtsbEvIdToAccidentIdMap()
    : null;
  const isMatched = (ev_id) =>
    !evIdToAccId || evIdToAccId.has(ev_id);  // test env: keep everything (mocked)

  const tables = {};
  for (const def of TABLE_DEFS) {
    const csvPath = path.join(csvDir, `${def.csvName}.csv`);
    if (!fs.existsSync(csvPath)) { tables[def.tableKey] = []; continue; }
    let text = fs.readFileSync(csvPath, 'utf8');
    let parsed = parseCsv(text);
    text = null;  // release input string immediately so V8 GC can reclaim
    tables[def.tableKey] = parsed.filter(r => isMatched(r.ev_id));
    parsed = null;  // release full parsed array; only filtered subset retained
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
        // Prefer the pre-fetched map (one-shot SELECT vs 30K LIKE queries).
        // Backward-compat: map value used to be a plain accId integer; now it
        // is an object {accId, normalized_date, aircraft_model, operator,
        // location} carrying clean sidecar data for slug generation.
        const sc = evIdToAccId ? evIdToAccId.get(rec.ev_id) : null;
        const accId = sc
          ? (typeof sc === 'object' ? sc.accId : sc)
          : sidecar.getAccidentIdBySourceEventId(rec.ev_id, 'ntsb');
        if (!accId) { unmatched++; continue; }
        // Slug from sidecar's human-friendly data (e.g. "PIPER PA 28-180" +
        // ISO normalized_date) — the MDB raw data gives "F33A" + "01/10/08".
        const candidate = buildAccidentSlugCandidate({
          normalized_date: (sc && sc.normalized_date) || rec.ev_date,
          aircraft_model:  (sc && sc.aircraft_model)  || rec.ev_meta.aircraft_model,
          operator:        (sc && sc.operator)        || rec.ev_meta.operator,
          location:        (sc && sc.location) || (rec.ev_meta.city
            ? `${rec.ev_meta.city}, ${rec.ev_meta.state || rec.ev_meta.country}`
            : ''),
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
  // In-process NTSB ingest is OFF by default. Running it inside the web
  // server process death-loops: avall.mdb parse needs ~6GB of V8 heap
  // (see package.json:backfill-ntsb), the server runs without that cap,
  // V8 OOMs mid-table-parse, pm2 restarts, the orphaned /var/tmp/ntsb-*
  // dir leaks ~775MB, and the cycle repeats every ~3 minutes — filling
  // a 38GB disk to zero in ~4h. Observed twice in prod 2026-05-12.
  //
  // The canonical refresh path is `gh workflow run backfill-ntsb.yml`
  // (scripts/backfill-ntsb.js launched with --max-old-space-size=6144).
  // Set NTSB_DUMP_AUTOSTART=1 only if you re-enable in-process ingest
  // with a proper heap cap on the pm2 process.
  if (process.env.NTSB_DUMP_AUTOSTART !== '1') {
    console.log('[ntsbDumpWorker] in-process autostart disabled (set NTSB_DUMP_AUTOSTART=1 to enable). Use `gh workflow run backfill-ntsb.yml` for refresh.');
    return false;
  }
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
  return true;
}

module.exports = { start, runIngest };
