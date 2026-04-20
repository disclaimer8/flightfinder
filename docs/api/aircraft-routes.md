# `GET /api/aircraft/routes`

Returns every `(dep, arr)` pair that a given aircraft family has been **observed flying** from a given set of origin airports within a rolling time window. This is the single endpoint that backs the Phase 3 "map-as-output" view for by-aircraft search — the client draws one geodesic arc per row in `routes[]` and looks up every arc's endpoint coordinates in the embedded `airports[]` dictionary. When nothing matches, the response shifts to returning nearby-hub `suggestions[]` so the user isn't staring at a blank map.

Unlike the live flight search endpoints, this is not a real-time query. It reads from the local `observed_routes` table which is populated by the [adsb.lol ADS-B worker](../../server/src/services/adsblolService.js) and topped up with AirLabs-scheduled data. Freshness is in the minutes-to-hours range, not seconds.

Implementation: [server/src/controllers/aircraftController.js](../../server/src/controllers/aircraftController.js) — `exports.getAircraftRoutes`. Route registered in [server/src/routes/aircraft.js](../../server/src/routes/aircraft.js). Validator in [server/src/middleware/validate.js](../../server/src/middleware/validate.js) — `aircraftRoutesQuery`.

---

## Query parameters

| Parameter | Required | Type | Default | Constraints | Description |
|---|---|---|---|---|---|
| `family` | Yes | string | — | 2–64 chars, slug or display name | Aircraft family. Accepts either a slug (`a380`, `a320-family`, `b747`) or a display name (`Airbus A380`, `Airbus A320 family`, `Boeing 747`). The controller normalises via `resolveFamily()` — see [server/src/models/aircraftFamilies.js](../../server/src/models/aircraftFamilies.js). |
| `origins` | Yes | string | — | 1–10 IATA codes, CSV | Origin airports to query from. Two- or three-letter IATA codes, comma-separated, case-insensitive. Duplicates are de-duped server-side. Codes that don't resolve to a known airport are silently dropped; if that leaves zero origins the endpoint returns `400 no valid origins`. |
| `windowDays` | No | integer | `14` | 1–90 | How far back to look in `observed_routes`. The server uses `now() - windowDays * 86400s` as the `seen_at` cutoff. |

IATA codes in `origins` are upper-cased before validation. Slug normalisation is case-insensitive (`A380`, `a380`, and `Airbus A380` all resolve to the same family record).

---

## Request examples

Slug form, single origin:

```bash
curl "https://himaxym.com/api/aircraft/routes?family=a380&origins=LHR&windowDays=14"
```

Display name form (URL-encode the space):

```bash
curl "https://himaxym.com/api/aircraft/routes?family=Airbus%20A340&origins=FRA,MUC&windowDays=14"
```

Multi-origin fan-out (the client issues this after expanding a city + radius into a set of airports via `/api/map/radius`):

```bash
curl "https://himaxym.com/api/aircraft/routes?family=a380&origins=LHR,CDG,FRA,AMS&windowDays=14"
```

Shorter window — only show routes observed in the last three days:

```bash
curl "https://himaxym.com/api/aircraft/routes?family=b747&origins=JFK&windowDays=3"
```

Cache-bust (append a unique query string parameter — the cache key is built only from `family`, sorted `origins`, and `windowDays`, so any extra parameter bypasses the cache):

```bash
curl "https://himaxym.com/api/aircraft/routes?family=a380&origins=LHR&windowDays=14&_=$(date +%s)"
```

---

## Response — 200

```json
{
  "family":      "a380",
  "familyName":  "Airbus A380",
  "icaoTypes":   ["A380", "A388"],
  "windowDays":  14,
  "origins": [
    { "iata": "LHR", "lat": 51.4706, "lon": -0.461941, "name": "London Heathrow Airport" }
  ],
  "airports": [
    { "iata": "LHR", "lat": 51.4706,       "lon": -0.461941,  "name": "London Heathrow Airport" },
    { "iata": "AUH", "lat": 24.433,        "lon": 54.6511,    "name": "Abu Dhabi International Airport" },
    { "iata": "BOS", "lat": 42.3643,       "lon": -71.0052,   "name": "General Edward Lawrence Logan International Airport" },
    { "iata": "DXB", "lat": 25.2528,       "lon": 55.3644,    "name": "Dubai International Airport" },
    { "iata": "SFO", "lat": 37.619,        "lon": -122.375,   "name": "San Francisco International Airport" },
    { "iata": "SIN", "lat": 1.35019,       "lon": 103.994,    "name": "Singapore Changi Airport" }
  ],
  "routes": [
    { "dep": "LHR", "arr": "AUH", "icaoTypes": ["A388"], "count": 1, "lastSeen": "2026-04-20T12:08:04.637Z" },
    { "dep": "LHR", "arr": "BOS", "icaoTypes": ["A388"], "count": 1, "lastSeen": "2026-04-20T14:12:15.551Z" },
    { "dep": "LHR", "arr": "DXB", "icaoTypes": ["A388"], "count": 1, "lastSeen": "2026-04-20T14:12:15.552Z" },
    { "dep": "LHR", "arr": "SFO", "icaoTypes": ["A388"], "count": 1, "lastSeen": "2026-04-20T11:35:38.452Z" },
    { "dep": "LHR", "arr": "SIN", "icaoTypes": ["A388"], "count": 1, "lastSeen": "2026-04-20T14:12:15.553Z" }
  ],
  "suggestions": []
}
```

### Response fields

| Field | Type | Description |
|---|---|---|
| `family` | string | Canonical slug for the resolved family (always lower-case, regardless of what the client sent). |
| `familyName` | string | Human-readable label from `aircraftFamilies.js` — `family.label` if present, otherwise `family.name`. Safe to display directly in the UI. |
| `icaoTypes` | string[] | Every ICAO type designator in the resolved family (e.g. `["A380","A388"]`), sorted ascending. This is the same list the server used to query `observed_routes` — useful for debugging why a specific variant did or didn't appear. |
| `windowDays` | integer | Echo of the requested (or default) window, so the client can render "in the last N days" labels without keeping track. |
| `origins[]` | object[] | The origins that actually resolved to known airports. May be shorter than the requested list if some codes were unknown. Each entry has `iata`, `lat`, `lon`, `name`. |
| `airports[]` | object[] | **Dictionary of every airport referenced anywhere in the response** — the union of `origins[]` and every distinct `dep`/`arr` in `routes[]`. The client uses this to render dots and look up arc endpoint coords without a second round trip to `/api/map/airports`. Same field shape as `origins[]`. |
| `routes[]` | object[] | Aggregated `(dep, arr)` rows. Sorted by `count` desc, then `dep` asc, then `arr` asc. Capped at 500 rows. See below. |
| `suggestions[]` | object[] | Populated **only** when `routes[].length === 0`. Up to 5 nearby hubs (within 1000 km of any origin) that do have routes for this family in the same window. See below. |

### `routes[]` entries

| Field | Type | Description |
|---|---|---|
| `dep` | string | 3-letter IATA of origin. Always one of the resolved `origins[]`. |
| `arr` | string | 3-letter IATA of destination. |
| `icaoTypes` | string[] | The subset of the family's ICAO codes actually observed on this leg in this window. For most families this is a single entry; for collapsed families (A320 family, A340 family, 737) it disambiguates the real variant. Sorted. |
| `count` | integer | Number of `observed_routes` rows backing this `(dep, arr)` pair. A rough popularity proxy — one row per `(dep, arr, aircraft_icao)` tuple, so `count` is really "how many distinct ICAO variants did we see" not "how many flights." |
| `lastSeen` | string | ISO-8601 UTC timestamp of the newest observation on this leg. |

### `suggestions[]` entries

| Field | Type | Description |
|---|---|---|
| `iata` | string | 3-letter IATA of the nearby hub. |
| `name` | string | Airport name. |
| `distanceKm` | integer | Great-circle distance from the nearest requested origin. |
| `routeCount` | integer | Number of distinct destinations this hub has for the requested family in the same window. Sort key is `routeCount` desc, then `distanceKm` asc. |

---

## Error responses

All errors return `{ "success": false, "message": "..." }`.

| Status | Message | Cause |
|---|---|---|
| `400` | `family is required` | `family` missing, non-string, under 2 chars, or over 64 chars. |
| `400` | `origins is required (CSV of IATA codes)` | `origins` missing or empty. |
| `400` | `origins must contain at least one IATA code` | `origins` present but resolved to zero entries after splitting. |
| `400` | `origins must contain at most 10 IATA codes` | More than 10 comma-separated values. |
| `400` | `origin "XX" is not a valid IATA code` | One of the codes didn't match `^[A-Z]{2,3}$`. |
| `400` | `windowDays must be between 1 and 90` | Out-of-range, non-numeric, or NaN. |
| `400` | `unknown aircraft family` | `family` passed validator shape but `resolveFamily()` returned null. Check [aircraftFamilies.js](../../server/src/models/aircraftFamilies.js) for the supported slugs. |
| `400` | `no valid origins` | Every requested IATA was well-formed but none resolved to an airport in the OpenFlights index. Common cause: typos, or obscure codes not in the index. |
| `500` | `Failed to fetch aircraft routes` | DB or geocoding error — check the server logs. |

Examples:

```bash
$ curl -w "%{http_code}\n" "https://himaxym.com/api/aircraft/routes?family=concorde&origins=LHR"
{"success":false,"message":"unknown aircraft family"}
400

$ curl -w "%{http_code}\n" "https://himaxym.com/api/aircraft/routes?family=a380&origins=ZZZ"
{"success":false,"message":"no valid origins"}
400

$ curl -w "%{http_code}\n" "https://himaxym.com/api/aircraft/routes?family=a380&origins=LHR&windowDays=999"
{"success":false,"message":"windowDays must be between 1 and 90"}
400
```

---

## Empty-state behaviour

When the family-and-origin combination has zero hits in the window, the server does **not** return an empty `routes[]` and nothing else — it runs a second query over airports within 1000 km of each origin (using `geocodingService.nearbyAirports`) and fills `suggestions[]` with up to 5 hubs that do have data for the same family and window. The client renders these as clickable chips that swap the origin set via a `arm-swap-origin` `CustomEvent`.

Real example — the A380 is not seen from LaGuardia, but JFK 17 km away operates one:

```bash
$ curl "https://himaxym.com/api/aircraft/routes?family=a380&origins=LGA&windowDays=14"
{
  "family": "a380", "familyName": "Airbus A380", "icaoTypes": ["A380","A388"],
  "windowDays": 14,
  "origins": [{"iata":"LGA","lat":40.7772,"lon":-73.8726,"name":"La Guardia Airport"}],
  "airports": [{"iata":"LGA", ...}],
  "routes": [],
  "suggestions": [
    { "iata": "JFK", "name": "John F Kennedy International Airport", "distanceKm": 17, "routeCount": 1 }
  ]
}
```

The suggestion scan is bounded to 25 candidate airports per request to keep cold-cache responses fast.

---

## Caching

Cache key:

```
aircraft-routes:v2:{slug}:{sorted-origins}:{windowDays}
```

Origins are sorted before being concatenated so that `?origins=LHR,CDG` and `?origins=CDG,LHR` share a cache entry. TTL is **1800 seconds** (30 minutes).

To bust for a single key, pass any extra query parameter — the cache key uses only the three fields above, so `&_=1234567890` (as the client's "Refresh" button does) produces an identical cache key but the value ends up recomputed on the very next miss of any cohort that expires. In practice: wait ≤30 min, or call `DELETE /api/debug/cache` in development.

---

## Data source and freshness

`observed_routes` is populated from two jobs:

- **adsb.lol worker** — polls live ADS-B and writes `(dep_iata, arr_iata, aircraft_icao)` rows whenever a callsign resolves to a known route via adsb.lol's `/routeset` endpoint. ~87% of transatlantic commercial callsigns hit.
- **AirLabs scheduled flights** — fills gaps for routes that aren't airborne at poll time.

Rows have `seen_at` refreshed on every re-observation (the `PRIMARY KEY` is `(dep_iata, arr_iata, aircraft_icao)` and the insert uses `ON CONFLICT ... DO UPDATE`). A route that stops operating will fall out of the `windowDays` filter and disappear from responses within `windowDays` days.

As of the Phase 3 launch, `observed_routes` has been warming for ~2 weeks and contains roughly thousands of distinct `(dep, arr, aircraft)` rows. Expect sparse coverage for regional and turboprop families until the table matures — this is why the `suggestions[]` fallback exists.

See also: [observed_routes indexes in db.js](../../server/src/models/db.js) (`idx_observed_dep`, `idx_observed_aircraft`).

---

## Rate limiting

This endpoint inherits the project-wide `/api` limit: **120 requests per 15 minutes per IP**. Responses include standard `RateLimit-Limit`, `RateLimit-Remaining`, and `RateLimit-Reset` headers. It is **not** subject to the tighter `/api/flights` per-minute limit.

---

## Tests

Covered by [server/src/__tests__/aircraftRoutes.test.js](../../server/src/__tests__/aircraftRoutes.test.js):

- happy path: single origin, full response shape, no cross-family leakage (A330 rows must not contaminate A380 responses)
- multi-origin: sort contract is `count desc, dep asc, arr asc`; no duplicate `(dep, arr)` pairs
- 400 on unknown family slug
- 400 on >10 origins
- 400 on all-unknown-origins
- suggestions branch: LUX has no A380 data; response surfaces FRA (~175 km away)
