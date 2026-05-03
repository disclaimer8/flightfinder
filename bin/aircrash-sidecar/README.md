# aircrash-sidecar

Read-only HTTP sidecar serving the global aviation accidents dataset.
nginx mounts it under `/api/safety/global/` (e.g. /accidents,
/stats/aircrafts, /map_data, /health), with the prefix stripped so the
sidecar's internal routes stay short.

## Architecture

This is a deliberately minimal fork of the upstream AirCrash project
(`/Users/denyskolomiiets/AirCrash`). Scrapers, geocoder, dashboard HTML,
and the headless-Chrome dependency are stripped — the binary only opens
the SQLite file in read-only mode and serves four JSON endpoints. The
file mirrors the [`bin/google-flights-sidecar/`](../google-flights-sidecar/)
pattern: single-package Go module, built once at deploy, run under PM2.

## Endpoints (loopback only)

- `GET /health` — `{"status":"ok"}` (PM2 / nginx healthcheck)
- `GET /accidents?limit=100&offset=0` — paginated raw rows
- `GET /stats/aircrafts` — top 10 aircraft by accident count
- `GET /stats/operators` — top 10 operators by accident count
- `GET /map_data` — geocoded points (≤ 10000) for Leaflet

`limit` is clamped to `[1, 500]`; `offset` to `[0, 1_000_000]`. Any error
returns `{"error":"internal"}` and logs the detail server-side.

## Build

```sh
cd bin/aircrash-sidecar
go build -o ../../server/bin/aircrash-sidecar .
```

`deploy.yml` does this on every release, mirroring how it builds
`google-flights-sidecar`. Local builds need Go 1.23+ and the SQLite
toolchain (CGO).

## Run

```sh
./aircrash-sidecar --db /root/flightfinder/data/accidents.db --addr 127.0.0.1:5003
```

Both flags are explicit by design — there is no relative-path default,
so PM2's `cwd` doesn't silently change behaviour.

## Refreshing the database

The DB itself is a snapshot — scraping happens out-of-band. There are
two refresh paths: an automated weekly CI workflow (preferred) and a
manual local fallback.

### How the seed gets refreshed (automated, preferred)

`.github/workflows/aircrash-refresh.yml` runs every Sunday at 03:00 UTC
on a GitHub-hosted `ubuntu-latest` runner:

1. Clones the upstream `disclaimer8/Aviation-Safety-Explorer` repo at HEAD.
2. Builds the upstream `aircrash-parser` binary (Go 1.26, Chromium from apt).
3. Pre-seeds the scraper's working DB with our committed
   `accidents.db.seed` so `InsertAccident`'s fuzzy dedup (date +
   first-word-of-model) skips records we already have.
4. Runs **Wikidata** (cheap SPARQL) and **ASN for the last ~1 year**
   (narrow window keeps Cloudflare-bypass exposure low). **B3A is
   skipped** — code review flagged its output as low-quality
   (`Cessna (B3A)` placeholders).
5. If the DB hash changed, opens a labelled PR (`data-refresh`,
   `automated`) against `main` with the new seed and a row-delta
   summary. **The PR is never auto-merged** — humans review for
   garbage rows before approving.

Once merged, `deploy.yml` picks up the new seed via its existing
sha256-compare path and copies it to
`/root/flightfinder/data/accidents.db` on the next deploy.

The scraper is **never** run on the VPS:

- Headless Chrome plus Cloudflare-bypass plugins enlarge the attack
  surface on a server already serving real users.
- We previously triggered a Google Flights soft-block by running an
  unrelated scraper too aggressively from the production IP — running
  another scraper there is asking for a repeat.

You can trigger the workflow ad-hoc from the Actions tab via the
`workflow_dispatch` button (optional `asn_years_back` input lets you
widen the ASN window if a refresh missed older data).

### Manual / local refresh (fallback)

If CI is unavailable or you need to backfill older years:

1. Run the upstream scraper locally (needs Chromium):
   ```sh
   cd ~/AirCrash
   ./aircrash-parser --asn --start=2020 --end=2026
   ./aircrash-parser --wikidata
   ```
2. Copy the updated DB into the seed location:
   ```sh
   cp ~/AirCrash/accidents.db ~/FLIGHT/bin/aircrash-sidecar/accidents.db.seed
   ```
3. Open a PR (do **not** push directly to main) so a human can review
   the delta the same way the automated path is reviewed.
