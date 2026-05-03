# aircrash-sidecar

Read-only HTTP sidecar serving the global aviation accidents dataset at
`/api/*` (proxied by nginx as `/api/safety/global/*` on himaxym.com).

## Architecture

This is a deliberately minimal fork of the upstream AirCrash project
(`/Users/denyskolomiiets/AirCrash`). Scrapers, geocoder, dashboard HTML,
and the headless-Chrome dependency are stripped — the binary only opens
the SQLite file in read-only mode and serves four JSON endpoints. The
file mirrors the [`bin/google-flights-sidecar/`](../google-flights-sidecar/)
pattern: single-package Go module, built once at deploy, run under PM2.

## Endpoints (loopback only)

- `GET /health` — `{"status":"ok"}` (PM2 / nginx healthcheck)
- `GET /api/accidents?limit=100&offset=0` — paginated raw rows
- `GET /api/stats/aircrafts` — top 10 aircraft by accident count
- `GET /api/stats/operators` — top 10 operators by accident count
- `GET /api/map_data` — geocoded points (≤ 10000) for Leaflet

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

The DB itself is a snapshot — scraping happens out-of-band:

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
3. Commit and deploy. `deploy.yml` copies the seed to
   `/root/flightfinder/data/accidents.db` only on first deploy or when
   the seed file's hash changes — restart-only deploys preserve any
   live geocoder enrichment that happened on the server.

Production never runs the scraper; the headless-Chrome attack surface
is too large to host alongside the main app.
