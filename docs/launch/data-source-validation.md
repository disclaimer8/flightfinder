# Data-source validation & refresh cadence

## Sources (post-Plan 6)

| Field | Primary | Fallback | Refresh |
|---|---|---|---|
| airport name / city / lat,lon / ICAO | OurAirports (nightly) | OpenFlights (`airports.dat`, MIT, rare updates) | Daily via `ourAirportsRefreshWorker` when `OURAIRPORTS_REFRESH=1` |
| airport IANA timezone | OpenFlights | — | Manual (rarely changes) |
| weather at IATA | NOAA aviationweather.gov METAR (free, no key) | OpenWeather (free tier, `OPENWEATHER_API_KEY`) | Fetched on-demand, 10-min memo |
| aircraft type / registration | AeroDataBox live (per-flight) | `aircraft_fleet` table | — |
| aircraft build year | `aircraft_fleet.build_year` (populated by Mictronics + OpenSky CSV) | null | Manual — `FLEET_BOOTSTRAP=1` after placing CSVs in `server/data/` |

## How to refresh the OpenSky CSV

1. Download with: `curl -o server/data/opensky-aircraft.csv https://opensky-network.org/datasets/metadata/aircraftDatabase.csv` (check the latest filename on the page)
2. Set `FLEET_BOOTSTRAP=1` in GH Secrets
3. Push an empty commit to trigger redeploy — the one-shot worker runs 10s after boot
4. Unset `FLEET_BOOTSTRAP` (or leave it on — it's a no-op if the file hasn't changed)

## Validation signals to watch in logs

- `[airport-validation] audit: checked=N conflicts=M` — at boot, after OurAirports loads. `conflicts > 20` suggests a systematic OpenFlights<->OurAirports drift worth investigating.
- `[avwx] 503 for EGLL` — NOAA outage or blocked region; the enrichment service falls through to OpenWeather.
- `[ourairports-refresh] payload too small: N bytes` — GitHub Pages returned something other than the CSV (rate limit, outage). Falls through silently.
- `[fleetBootstrap] opensky done: N rows upserted (build_year enrichment)` — OpenSky merge completed; `N` equals the OpenSky CSV row count. `[fleetBootstrap] opensky disabled (no data file)` means the CSV isn't in `server/data/`.

## Known limits

- OurAirports has no IANA timezone column — we keep OpenFlights as the timezone-of-record until the upstream ships one.
- OpenSky aircraft database is technically "unlicensed / as-is". Safe to derive enrichment into our own `aircraft_fleet` table; don't redistribute the raw CSV.
- NOAA blocks requests from some cloud IPs — if `[avwx]` warnings spike after a hosting provider change, verify from a curl on the production box.

## Live verification

Sanity curl (from any machine with outbound HTTPS):

```bash
curl -s 'https://aviationweather.gov/api/data/metar?ids=EGLL&format=json' | head -c 200
```

Expected: JSON array with `icaoId`, `temp`, `wspd`, `rawOb`, `obsTime` fields.
