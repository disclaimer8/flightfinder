# FlightConnections.com full-site crawler — design

**Date:** 2026-05-16
**Status:** Design approved, awaiting implementation plan
**Owner:** Denys

## Goal

Build a Go-based crawler that produces a complete, machine-readable snapshot of all public content on flightconnections.com: every airport, every airline, every route page, alliances, aircraft types, countries, cities. Output is the primary data source on which himaxym.com features (SEO content, aircraft×route matrix, route discovery) will operate.

This is acquisition-only. SEO consumption is out of scope for this spec and will be addressed separately.

## Non-goals

- No other sources (Wikipedia, Travelpayouts, OAG) — clean FC slurp only.
- No content rewriting — descriptions stored verbatim.
- No paid/premium-zone extraction — public content only.
- No field inference for missing data — explicit `null` + log entry.

## Scope estimate (revised after sitemap probe)

| Type | Pattern | Count |
|---|---|---|
| `airport_dep` | `/flights-from-{city}-{iata}` | ~4 000 |
| `airport_arr` | `/flights-to-{city}-{iata}` | ~4 000 |
| `route` | `/flights-from-{iataA}-to-{iataB}` | ~150 000–200 000 |
| `airline` | `/route-map-{name}-{iata}` | ~900 |
| `alliance` | `/route-map-{oneworld\|skyteam\|star-alliance}` | 3 |
| `aircraft`, `country`, `city` | TBD via inventory frequency analysis | ~1 000 combined (estimate) |
| **Total** | | **~150 000–210 000 pages** |

Raw HTML at ~600 KB/page, ~180 KB after gzip → **~36 GB raw on mini-PC**. Parsed JSON ~50 KB/page → **~10 GB**. Wall time at 3-context Playwright pool, ~2 s/page nominal + throttle headroom: **3–7 days**.

## Topology

**Host:** `a1@192.168.1.191` (mini-PC, Ubuntu 24.04, 879 GB disk). Unconstrained on installable software. Raw HTML stays here (VPS has only 38 GB and cannot accept it).

**VPS:** `himaxym.com` receives `parsed/` + `derived/` JSON trees only via daily rsync, mirroring the `aircrash` sync pattern.

**Runtime:** Go (matches existing aircrash parser on the same mini-PC; `playwright-go` and `go-rod` stack already present and proven for stealth scraping). Avoids second Python runtime, leverages goroutines for the 3-context browser pool, stable for multi-day runs.

## Directory layout (mini-PC)

```
/home/a1/flightconnections/
├── cmd/
│   ├── fcs-inventory/main.go    # Phase A
│   ├── fcs-worker/main.go       # Phase B/C/D (--mode=discovery|fetch|parse|reparse)
│   ├── fcs-derive/main.go       # Phase E
│   └── fcs-sync/main.go         # Phase F
├── internal/
│   ├── inventory/               # sitemap fetch + URL classifier
│   ├── fetcher/                 # go-rod 3-context pool
│   ├── throttle/                # UA rotation, exp backoff, captcha detect
│   ├── parsers/                 # one file per page_type
│   │   ├── airport.go
│   │   ├── route.go
│   │   ├── airline.go
│   │   ├── alliance.go
│   │   ├── aircraft.go
│   │   ├── country.go
│   │   ├── city.go
│   │   └── routemap_ajax.go
│   ├── models/                  # struct + go-playground/validator tags per type
│   ├── progress/                # modernc.org/sqlite wrapper
│   ├── derive/                  # all_*.json + aircraft_routes.json
│   ├── validate/                # cross-check report generator
│   ├── sync/                    # rsync wrapper
│   └── log/                     # slog wiring → console + parse.log
├── data/
│   ├── raw/{type}/{slug}.html.gz
│   ├── parsed/{type}/{slug}.json
│   ├── inventory/
│   │   ├── progress.db          # SQLite: urls + fetch_log tables
│   │   ├── urls_inventory.json  # human-readable Phase A snapshot
│   │   ├── schemas_draft/       # auto-generated Go structs after Phase B
│   │   └── validation.md        # cross-check report after Phase D
│   └── derived/
│       ├── all_airports.json
│       ├── all_routes.json
│       ├── all_airlines.json
│       └── aircraft_routes.json # USP reverse index (aircraft type → routes)
├── logs/parse.log
├── sync-to-prod.sh
├── go.mod / go.sum
└── (no .venv — Go binaries from cmd/ via systemd)
```

**Dependencies:**
- `github.com/go-rod/rod` + `github.com/go-rod/stealth`
- `github.com/PuerkitoBio/goquery`
- `modernc.org/sqlite` (pure Go, no CGO)
- `github.com/go-playground/validator/v10`
- `github.com/cenkalti/backoff/v4`
- `github.com/klauspost/compress/gzip`

Build via `GOTOOLCHAIN=auto CGO_ENABLED=0 go build ./cmd/...` (mirrors aircrash).

## SQLite progress schema

```sql
CREATE TABLE urls (
  url           TEXT PRIMARY KEY,
  page_type     TEXT NOT NULL,
  slug          TEXT NOT NULL,
  status        TEXT NOT NULL,        -- pending|downloading|downloaded|parsing|parsed|failed
  http_status   INTEGER,
  attempts      INTEGER DEFAULT 0,
  claimed_at    INTEGER,              -- unix ts when worker started; 10-min TTL for orphan recovery
  fetched_at    INTEGER,
  parsed_at     INTEGER,
  last_error    TEXT
);
CREATE INDEX idx_urls_status ON urls(status);
CREATE INDEX idx_urls_type   ON urls(page_type);

CREATE TABLE fetch_log (
  ts          INTEGER NOT NULL,
  url         TEXT NOT NULL,
  http_status INTEGER,
  latency_ms  INTEGER,
  identity_id INTEGER                 -- which UA/viewport combo was used
);
CREATE INDEX idx_fetchlog_ts ON fetch_log(ts);
```

## Phases

### Phase A — Inventory (one-shot)

1. Fetch `https://www.flightconnections.com/sitemap.xml` → 7 sub-sitemap URLs (txt format).
2. Download all 7 sub-sitemaps → `data/inventory/sitemap_raw/sitemap_{1..7}.txt`.
3. URL classifier applies regex rules:
   - `^/flights-from-([a-z0-9-]+)-([a-z0-9]{3})$` → `airport_dep`, slug = `{iata}`
   - `^/flights-to-([a-z0-9-]+)-([a-z0-9]{3})$` → `airport_arr`, slug = `{iata}`
   - `^/flights-from-([a-z0-9]{3})-to-([a-z0-9]{3})$` → `route`, slug = `{A}-{B}`
   - `^/route-map-(oneworld|skyteam|star-alliance)$` → `alliance`, slug = `{name}`
   - `^/route-map-([a-z0-9-]+)-([a-z0-9]{2,3})$` → `airline`, slug = `{iata}`
   - aircraft/country/city patterns: **discovered empirically** by token-prefix frequency analysis of unclassified URLs.
4. Build `urls_inventory.json`:
   ```json
   {
     "total": 198543,
     "by_type": { "airport_dep": 4012, "...": ... },
     "unclassified_top_prefixes": [
       { "prefix": "aircraft-", "count": 213, "sample": "/aircraft-boeing-787" }
     ],
     "unclassified_samples": ["..."]
   }
   ```
5. Populate `progress.db` with all classified URLs as `status='pending'`.

**HALT-1: user reviews `urls_inventory.json`.** Confirms classifier rules or adds new rules for prefixes that should be parsed. After confirmation Phase A re-runs to incorporate new rules (or amends classification in-place via SQL).

### Phase B — Schema discovery (curated sample)

For each `page_type` fetch 5–10 URLs chosen to span the value distribution: e.g. for `airport_dep` — big hub (LHR), medium (DUB), small (ORK), seasonal (KEF), domestic-heavy (LCY). Selection logic is hardcoded with override file `data/inventory/discovery_seeds.txt` (manual additions welcome).

For each sample:
1. Fetch via go-rod, write `raw/{type}/{slug}.html.gz`, capture any AJAX responses on `/route-map-*` pages to `raw/{type}/{slug}_xhr.jsonl`.
2. Run draft parser (best-effort, emits all extracted fields).
3. Write JSON to `parsed/_samples/{type}/{slug}.json`.
4. Generate Go struct draft to `data/inventory/schemas_draft/{type}.go` (union of all fields seen across samples, with `*T` for fields present in <100%).
5. Write `parsed/_samples/_coverage.md` — per-field coverage table across all samples per type.

**HALT-2: user reviews JSON samples + draft structs + coverage report.** Approves → Phase C. Otherwise: identify missing fields → fix parser → re-run Phase B for affected type.

### Phase C — Full fetch

Worker drains `progress.db`:
1. Atomic claim via `UPDATE urls SET status='downloading', attempts=attempts+1, claimed_at=unixepoch() WHERE url = (SELECT url FROM urls WHERE status='pending' AND (claimed_at IS NULL OR claimed_at < unixepoch()-600) ORDER BY page_type, attempts ASC, RANDOM() LIMIT 1) RETURNING url, page_type, slug`.
2. Fetch via go-rod with throttle state machine (see below).
3. On success: gzip-write `raw/{type}/{slug}.html.gz` + `_xhr.jsonl` if applicable; `UPDATE … SET status='downloaded', http_status=200, fetched_at=unixepoch()`.
4. On retryable failure (429/403/timeout): leave as `downloading`, claim TTL recovers it; after `attempts >= 5` → `status='failed'`.

3-context pool: 3 goroutines each owning a rod context; coordinator dispatches claimed rows. No more than 3 concurrent network connections to flightconnections.com.

### Phase D — Full parse

Worker re-walks `status='downloaded'`, reads raw, applies parser, writes `parsed/{type}/{slug}.json`, marks `status='parsed'`. No HTTP. Fully restartable.

### Phase E — Derive (one-shot)

Scan `parsed/` and emit:
- `derived/all_airports.json` — one object per airport with full metadata + destinations + stats.
- `derived/all_routes.json` — flat array of `{origin, destination, airlines[], aircraft_types[], frequency, seasonality, distance, duration, classes[]}`.
- `derived/all_airlines.json` — one object per airline with full network.
- `derived/aircraft_routes.json` — reverse index `{aircraft_type: [routes...]}`. This is the USP index for himaxym.com.

### Phase F — Sync to VPS (daily timer)

`sync-to-prod.sh` (cribbed from aircrash's `sync-to-prod.sh`):
1. `PRAGMA integrity_check` on `progress.db` → must be `ok`.
2. Block if any `status IN ('downloading','parsing')` rows exist (worker is active; sync would propagate half-written JSONs). Exit 0 — timer retries next day. Log the skip.
3. `rsync -avz --delete --exclude='_samples/' parsed/ root@himaxym:/root/flightfinder/data/flightconnections/parsed/`.
4. `rsync -avz --delete derived/ root@himaxym:/root/flightfinder/data/flightconnections/derived/`.
5. `sqlite3 progress.db .dump` → SCP as `_progress_snapshot.sql` (diagnostic only).
6. Smoke `ssh root@himaxym df -h /root` and parse free-space.
7. No pm2 reload — FlightConnections data is read on-demand by FF code (consumption is a separate spec).

## Adaptive throttle (`internal/throttle/`)

Per-`page_type` state machine (path-specific backoff because some endpoints attract more aggressive blocking):

```
NORMAL    (rate=2s,  concurrency=3) ─429/403/captcha→ COOL_DOWN_1
COOL_DOWN_1 (rate=30s, concurrency=1) ─5×200→ NORMAL
                                       ─same trigger→ COOL_DOWN_2
COOL_DOWN_2 (rate=2m,  concurrency=1) ─5×200→ COOL_DOWN_1
                                       ─same trigger→ DEAD (halt this page_type; alert)
```

**Identity pool:** 10 combinations (5 UAs × 2 viewports), round-robin. Per-identity cool-off: any identity hitting 429 is parked 30 min, others rotate.

**Captcha detection:** response body case-insensitive match against `captcha` / `unusual traffic` / `automated requests` / Cloudflare challenge markers → trigger transition.

## Resumability invariants

1. Any `systemctl stop` finishes in-flight fetches (≤3), commits SQLite rows, exits. `claimed_at` TTL recovers orphans from crashes.
2. Restart picks up exactly where it stopped — never re-fetches a `downloaded` or `parsed` URL.
3. `--refresh=all` → `UPDATE urls SET status='pending' WHERE status IN ('parsed','failed')`.
4. `--refresh=type=<page_type>` → same, scoped.
5. `--refresh=url=<url>` → single row.

## Systemd units

| Unit | Type | Trigger | Purpose |
|---|---|---|---|
| `fcs-inventory.service` | oneshot | manual | Phase A |
| `fcs-worker.service` | simple, Restart=on-failure | manual (multi-day) | Phases B/C/D via `--mode=discovery\|fetch\|parse\|reparse` |
| `fcs-derive.service` | oneshot | manual after worker drains | Phase E |
| `fcs-sync.timer` | — | daily `05:00 UTC` (after aircrash sync at `03:30`) | Phase F |
| `fcs-vacuum.timer` | — | weekly `Sun 04:30 UTC` | `VACUUM progress.db` |

Worker is not in a timer. It is a multi-day process started manually and stopped manually.

## Cross-validation (`internal/validate/`)

After each parse cycle (Phase D or `--mode=reparse`), generate `data/inventory/validation.md`:

| Check | Expected behavior |
|---|---|
| Routes referenced by airport pages but no `/flights-from-A-to-B` page in inventory | Log count + samples — likely seasonal routes hidden from sitemap |
| Airlines referenced in routes but no `/route-map-{name}-{iata}` page | Log count + samples |
| Airports listed as destinations but missing `airport_dep`/`airport_arr` page | Log count |
| Aircraft type codes on route pages but no `/aircraft-*` index page | Log count |

Report is informational, not a hard fail.

## Re-parse flow

```bash
sudo systemctl stop fcs-worker
~/flightconnections/bin/fcs-worker --mode=reparse --type=airport_dep
```

Reads `raw/airport_dep/*.html.gz`, runs current parser, overwrites `parsed/airport_dep/*.json`, marks `status='parsed'`. No HTTP.

Followed by `~/flightconnections/bin/fcs-derive` to regenerate `derived/*.json` from updated parsed/.

## Out-of-scope follow-ups (separate specs)

- FF server-side integration (how `derived/*.json` powers SEO pages, search, aircraft-type pages).
- Periodic re-crawl schedule (this spec covers one-time full slurp).
- Frontend surfacing of new data on himaxym.

## Open items (to address in implementation plan)

- Exact seed list for Phase B discovery per `page_type` (medium/small/seasonal selection criteria).
- AJAX capture strategy for `/route-map-*` — record all XHR or filter to known endpoints.
- Whether to push `progress.db` snapshot to VPS daily or weekly (default daily).
- Disk monitoring threshold on mini-PC (alert when raw/ exceeds e.g. 80 GB).
