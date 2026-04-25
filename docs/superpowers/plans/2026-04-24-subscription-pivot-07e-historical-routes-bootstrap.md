# Historical Routes Bootstrap (Plan 7e) — 9 quarters of ADS-B-derived tuples

> **Status: ⚠️ REVERTED 2026-04-25** after data-quality issue surfaced in browser test.
>
> Bootstrap **succeeded technically** (3.85M tuples imported, peak RSS 1.2GB on 3.8GB VPS — DuckDB swap was sound). BUT MrAirspace's `Track_Origin_ApplicableAirports` field maps to **nearest-airport-at-time-of-signal**, not actual flight origin. ADS-B receivers near Egypt picked up Emirates A380s in cruise → got logged as "AAC origin". Result: AircraftLandingPage for /aircraft/airbus-a380 showed `AAC → BHX/CAI/CDG/...` as top routes — visibly bogus.
>
> **Action taken:** `DELETE FROM observed_routes WHERE source = 'historical'` on prod (3.85M rows removed). PM2 restart to flush in-memory cache. Now back to 4,490 organic rows. UI restored: A380 top routes are now real (`DXB↔JNB↔LHR↔CAN↔ORD`).
>
> **For re-import:** add an altitude filter in `bootstrapHistoricalRoutes.js` — only ingest rows where `Track_Origin_FL_Ft` is `'ground'` or below 5000ft (real takeoff phase). Current SQL accepts any row with non-empty origin. ETA: ~1h to add filter + retest a small parquet to verify only takeoff/landing tracks survive.
>
> Initial DuckDB refactor work (commit 2e63805): valid, keep. Tests pass, code shipped, schema changes (source column on observed_routes) stay.
>
> | Metric | Before | After |
> |---|---|---|
> | `observed_routes` total | 22,197 | **3,850,167** (+173×) |
> | Unique aircraft types | ~80 | **1,520** |
> | Airports covered | ~200 | **4,011** |
> | B748 (747-8) routes | 0 | **3,644** |
> | A388 (A380) routes | unknown | **2,686** |
> | Peak RSS during run | 3GB+ (OOM) | **~1.2GB** |
>
> Initial `@dsnp/parquetjs` implementation OOM'd on Hetzner 3.8GB VPS. Resolved by swapping for **DuckDB streaming** (`read_parquet()` via httpfs with HTTP range-reads + predicate pushdown). Dropped 2024 `aircraft_flight_logs_*` releases (AC_Type='-' for all rows, useless). Parsed Python-repr airport format `"['EHAM', 'EHRD']"` via `regexp_extract`. Final: 5 detailed 2025+ parquets processed end-to-end in ~45 min, stable memory footprint.
>
> VPS upgrade was NOT needed — problem was library choice, not hardware.
>
> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans. `- [ ]` checkboxes.

**Goal:** Bootstrap `observed_routes` с 9+ кварталами глобальной ADS-B-derived истории (10-15M flights per quarter) через одноразовый импорт из [MrAirspace/aircraft-flight-schedules](https://github.com/MrAirspace/aircraft-flight-schedules) parquet releases. Вместо ожидания органического накопления через adsb.lol worker, получить immediate coverage для редких aircraft типов (A380, B748, B744, etc.) в `AircraftRouteMap` "by aircraft" flow.

**Why:** Наш существующий `adsblolWorker.js` накапливает `observed_routes` в реальном времени. Для common типов (A320, B738) 1-3 месяца работы достаточно. Для редких типов и экзотических route'ов органика медленная — "by aircraft" experience для A380 пользователей плохой (видят 5-10 маршрутов вместо десятков). Этот датасет использует **тот же источник** (adsb.lol dumps) но за 9 кварталов истории — single batch = years of coverage.

**Architecture:** One-shot bootstrap script запускает:
1. Скачивает ~9 quarterly parquet файлов с [GitHub Releases](https://github.com/MrAirspace/aircraft-flight-schedules/releases) (~1GB each compressed).
2. Stream-парсит каждый через `@dsnp/parquetjs`.
3. Фильтрует incomplete tracks (where Track_Origin_ApplicableAirports или Track_Destination_ApplicableAirports == '-').
4. Мапит ICAO airport codes (EHAM/EGLL) в IATA (AMS/LHR) через existing `openFlights.iataForIcao()`.
5. Bulk-upsert (dep_iata, arr_iata, aircraft_icao, airline_iata, seen_at) в `observed_routes` через existing `upsertObservedRoute`.
6. Prints stats and stops. Не запускает как continuous worker — one-shot по env flag.

**Tech Stack:** Node 22, добавляем 1 runtime dep: `@dsnp/parquetjs` (~200KB). Всё остальное существует.

**Spec source:** Repo evaluated 2026-04-23. Data source = same adsb.lol чей live feed уже используем, так что license/quality concerns resolved.

**Out of scope:**
- Continuous sync — parquet файлы публикуются quarterly, не подходят для live. Наш existing live worker покрывает.
- Dedup с existing organic rows — existing `upsertObservedRoute` уже идемпотентен через PRIMARY KEY (dep_iata, arr_iata, aircraft_icao). Historical rows обновят `first_seen_at` до более старого, `seen_at` оставит актуальным.
- Retention policy — пока сохраняем всё, observed_routes bounded ~tens-of-thousands rows даже после import'а (unique tuples, не per-flight records).
- ADS-B historical dumps напрямую от adsb.lol (без MrAirspace pre-processing) — MrAirspace добавляет route-validation через vradarserver, ценно.

## File Structure

**New files:**
- `server/scripts/bootstrapHistoricalRoutes.js` — standalone Node script (не worker). Запуск: `cd server && FLEET_BOOTSTRAP=1 node scripts/bootstrapHistoricalRoutes.js`
- `server/src/__tests__/fixtures/historical-routes-sample.parquet` — committed 100-row sample для test'ов
- `server/src/__tests__/historical.bootstrap.test.js` — parse-мапинг-upsert test против fixture

**Modified files:**
- `server/package.json` — add `@dsnp/parquetjs` dep
- `server/src/models/db.js` — optional: add `source` column к `observed_routes` (additive migration) если хотим различать historic vs live rows. Recommended but not strictly required.

**Nothing in client/** — фича прозрачна для UI, AircraftRouteMap уже читает observed_routes as-is.

---

## Task 1: Add `source` column to `observed_routes` (optional but recommended)

**Why:** Различать organic (live adsb.lol worker) rows от historical-batch import'ом. Полезно для debug + future re-importов.

**Files:**
- Modify: `server/src/models/db.js` — ALTER ADD COLUMN source TEXT
- Modify: `server/src/models/db.js` — update `upsertObservedRoute` statement to accept source param (default 'live')
- Add test: `server/src/__tests__/observedRoutes.source.test.js`

Skip if you don't want schema change — all tasks below work without it, just lose debug visibility.

---

## Task 2: Standalone bootstrap script

**Files:**
- Create: `server/scripts/bootstrapHistoricalRoutes.js`

```js
'use strict';

// One-shot import of historical aircraft route tuples from MrAirspace/aircraft-flight-schedules
// parquet releases. Reads parquet URL list from env or hardcoded default. Streams each file,
// filters, maps, bulk-upserts.
//
// Run:
//   cd server && node scripts/bootstrapHistoricalRoutes.js
// or to process just one quarter:
//   HISTORICAL_PARQUET_URLS='https://github.com/MrAirspace/aircraft-flight-schedules/releases/download/Q3-2025/2025_Q3.parquet' node scripts/bootstrapHistoricalRoutes.js

const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { ParquetReader } = require('@dsnp/parquetjs');
const openFlights = require('../src/services/openFlightsService');
const dbModule = require('../src/models/db');

// Default: all quarters available on repo releases. Engineer updates on activation.
const DEFAULT_URLS = [
  // TODO fill from releases page — example:
  // 'https://github.com/MrAirspace/aircraft-flight-schedules/releases/download/2026-Q1/2026_Q1.parquet',
];

async function downloadToTempFile(url) {
  const tmpPath = path.join(os.tmpdir(), `mras-${Date.now()}-${Math.random().toString(36).slice(2)}.parquet`);
  await new Promise((resolve, reject) => {
    const file = fs.createWriteStream(tmpPath);
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close();
        fs.unlinkSync(tmpPath);
        return downloadToTempFile(res.headers.location).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        file.close();
        return reject(new Error(`HTTP ${res.statusCode} from ${url}`));
      }
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
      file.on('error', reject);
    }).on('error', reject);
  });
  return tmpPath;
}

function parseDateToMs(iso) {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

async function importParquet(url) {
  console.log(`[historical] downloading ${url} ...`);
  const tmpPath = await downloadToTempFile(url);
  try {
    const reader = await ParquetReader.openFile(tmpPath);
    const cursor = reader.getCursor();
    let processed = 0, imported = 0, skipped = 0;
    let record;
    while ((record = await cursor.next())) {
      processed++;
      const depIcao = String(record.Track_Origin_ApplicableAirports || '').trim().toUpperCase();
      const arrIcao = String(record.Track_Destination_ApplicableAirports || '').trim().toUpperCase();
      const acType  = String(record.AC_Type || '').trim().toUpperCase();
      const airline = String(record.Airline || '').trim().toUpperCase();
      const seenAt  = parseDateToMs(record.Track_Origin_DateTime_UTC);

      if (!depIcao || depIcao === '-' || !arrIcao || arrIcao === '-' || !acType || !seenAt) {
        skipped++;
        continue;
      }

      // MrAirspace "ApplicableAirports" can be multi-airport "EHAM|EHRD" — take first (nearest).
      const depIata = openFlights.iataForIcao(depIcao.split('|')[0]);
      const arrIata = openFlights.iataForIcao(arrIcao.split('|')[0]);
      if (!depIata || !arrIata) { skipped++; continue; }

      dbModule.upsertObservedRoute({
        depIata, arrIata,
        aircraftIcao: acType,
        airlineIata: airline.length === 2 ? airline : null, // ICAO airline in dataset, store only if 2-char IATA
      });
      imported++;

      if (processed % 100000 === 0) {
        console.log(`[historical]   ${processed} processed, ${imported} imported, ${skipped} skipped`);
      }
    }
    await reader.close();
    console.log(`[historical] ${url}: total=${processed} imported=${imported} skipped=${skipped}`);
  } finally {
    try { fs.unlinkSync(tmpPath); } catch {}
  }
}

async function main() {
  const urls = (process.env.HISTORICAL_PARQUET_URLS || '').split(',').filter(Boolean);
  const list = urls.length ? urls : DEFAULT_URLS;
  if (!list.length) {
    console.error('No parquet URLs. Set HISTORICAL_PARQUET_URLS env or update DEFAULT_URLS in this script.');
    process.exit(1);
  }
  const beforeStats = dbModule.observedStats();
  console.log(`[historical] observed_routes before: ${beforeStats.total} rows`);
  for (const url of list) {
    try {
      await importParquet(url);
    } catch (err) {
      console.warn(`[historical] FAILED ${url}: ${err.message}`);
    }
  }
  const afterStats = dbModule.observedStats();
  console.log(`[historical] observed_routes after: ${afterStats.total} rows (delta: +${afterStats.total - beforeStats.total})`);
}

main().catch(e => {
  console.error('[historical] fatal:', e);
  process.exit(1);
});
```

Notes for engineer:
- **Don't run without populating `DEFAULT_URLS`** with actual release URLs from [MrAirspace releases page](https://github.com/MrAirspace/aircraft-flight-schedules/releases). They name them like `2024_Q1.parquet`, `2024_Q2.parquet`, ... `2026_Q1.parquet` — up to 9 files on activation date.
- Script takes ~30-60 min per quarter on a decent connection + laptop. Run on prod server (has faster network).
- Airlines в dataset — ICAO (`DLH`, `BAW`) not IATA (`LH`, `BA`). Conversion ICAO-airline → IATA is NOT in openFlightsService currently. Initial import just stores null for airline (data still useful per (dep, arr, ac_type)). Add reverse airline lookup as follow-up if needed.

---

## Task 3: Add parquet fixture + test

**Files:**
- Create: `server/src/__tests__/fixtures/historical-routes-sample.parquet` (100 rows, manually generated from a real download)
- Create: `server/src/__tests__/historical.bootstrap.test.js`

Test validates:
- parquet file parses
- ICAO airport filter (rows with `-` skipped)
- ICAO→IATA mapping works
- observed_routes upsert produces expected count

Pseudocode:

```js
describe('bootstrapHistoricalRoutes', () => {
  test('parses fixture and upserts rows', async () => {
    const fixture = path.join(__dirname, 'fixtures/historical-routes-sample.parquet');
    // Load reader manually, iterate, collect processed/imported/skipped
    // Assert imported > 0, observed_routes.observedStats().total matches
  });
});
```

---

## Task 4: Run bootstrap on prod

**NOT** via GH Actions — script is long-running (30-60 min per quarter × 9 quarters = hours). Run manually on prod server as one-off admin task.

- [ ] **Step 1:** SSH to prod
  ```bash
  ssh himaxym
  cd /root/flightfinder/server
  ```

- [ ] **Step 2:** Update `DEFAULT_URLS` in script with current release URLs, OR pass via env
- [ ] **Step 3:** Run
  ```bash
  node scripts/bootstrapHistoricalRoutes.js 2>&1 | tee ~/historical-bootstrap.log
  ```
- [ ] **Step 4:** Verify growth
  ```bash
  sqlite3 data/app.db "SELECT COUNT(*), COUNT(DISTINCT dep_iata), COUNT(DISTINCT aircraft_icao) FROM observed_routes;"
  ```
  Expected: count > 50k (vs <5k before). Aircraft types > 100.

- [ ] **Step 5:** Spot-check rare aircraft in UI
  - Open `https://himaxym.com/aircraft/a380` → should show 30+ routes
  - Open `https://himaxym.com/aircraft/b748` → should show 20+ routes
  - Before bootstrap — likely 5-10 each.

- [ ] **Step 6:** Update `/legal/attributions`
  Add in [client/src/pages/legal/Attributions.jsx](client/src/pages/legal/Attributions.jsx) under the list:
  ```jsx
  <li><strong>Aircraft Flight Schedules</strong> — historical ADS-B-derived tuples, <a href="https://github.com/MrAirspace/aircraft-flight-schedules">MrAirspace/aircraft-flight-schedules</a>, ODbL-1.0.</li>
  ```
  Commit + redeploy.

---

## Critical files

- `server/scripts/bootstrapHistoricalRoutes.js` — the one-shot importer
- `server/src/services/openFlightsService.js` — `iataForIcao` (added in Plan 7)
- `server/src/models/db.js` — `upsertObservedRoute`, `observedStats`
- `server/src/workers/adsblolWorker.js` — reference for live side (continues working after bootstrap)

## Effort estimate

- Task 1 (source column): 30 min (optional)
- Task 2 (script): 3-4h (bulk of work — streaming parquet + edge cases)
- Task 3 (fixture + test): 1-2h
- Task 4 (prod run): 3-6h of waiting (parallelizable with other tasks)

**Total active work: ~5-6h. Plus 3-6h prod run time.**

## Why this gets priority vs. 7b/7c/7d

- **7b (FAA enrichment)** — требует 4+ недели накопления NTSB prerequisite. Gate.
- **7c (UX honesty)** — ждёт non-US юзера с жалобой. Gate.
- **7d (OpenSky OAuth2)** — ждёт Sentry 401 spike. Gate.
- **7e (этот)** — нет gate, только effort. **Immediately value-generating** для AircraftRouteMap user experience (когда юзеры появятся). Can ship whenever we have a spare day.

## Decision log

- **2026-04-23:** Оценён репо MrAirspace/aircraft-flight-schedules — уникальный legit free historical source, same adsb.lol origin как наш live feed. ODbL clean. Parked пока не появится свободный день.
