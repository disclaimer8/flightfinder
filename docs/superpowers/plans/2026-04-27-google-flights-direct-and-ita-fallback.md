# Google Flights direct + ITA Matrix fallback — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore working free live flight search by adding a Google Flights direct-API source (via Go sidecar) with an ITA Matrix HTTP fallback, replacing the dead Amadeus path.

**Architecture:** Express on `:5001` calls a new `flightSearchOrchestrator` which tries `googleFlightsService` (HTTP to local Go sidecar on `:5002`) first, then `itaMatrixService` (direct POST to `matrix.itasoftware.com`), then existing `travelpayoutsService`, then stale-cache. Sidecar is a ~70-line Go HTTP wrapper around `gilby125/google-flights-api` library. All sources normalize to the existing flight shape used by `flightController.buildItinerary`.

**Tech Stack:** Node.js + Express + Jest (existing); Go 1.22 + `gilby125/google-flights-api` library (new sidecar); PM2 (process management); GitHub Actions (build + canary).

**Spec:** `docs/superpowers/specs/2026-04-27-google-flights-direct-and-ita-fallback-design.md`

**Branch:** `chore/security-and-data-2026-04` (already open with prior security-hardening commits)

**Parallelism guide for orchestrator agents:**
- Task 1 (ITA research) is independent of Tasks 2–4 (Go sidecar chain) — can run in parallel.
- Task 5 depends on Task 1.
- Task 4 depends on Task 3.
- Task 6 depends on Tasks 4 and 5.
- Task 7 depends on Task 6.
- Task 8 (PM2) and Task 9 (deploy) are independent of services after Task 3 — can be parallel.
- Task 10 (canary) depends on Task 4.

---

## Existing patterns to follow

- **Test layout:** Jest, `server/src/__tests__/<name>.test.js`, run with `npx jest --runInBand --testPathPatterns="<name>"` from the `server/` directory. Setup file `server/src/__tests__/setup.js` already loads env.
- **Service module shape:** `server/src/services/*.js` — `'use strict'` not used; `require()` style; `exports.foo = ...`. See `cacheService.js` for canonical example.
- **Cache:** `cacheService.getOrFetch(key, fetchFn, ttl)` returns `{ data, fromCache }`. TTLs in `cacheService.TTL` (e.g. `TTL.flights = 600`).
- **Normalized flight shape** (from `flightController.buildItinerary`):
  ```js
  {
    departure: { code, terminal, city, country },
    arrival:   { code, terminal, city, country },
    departureTime: ISO8601,
    arrivalTime:   ISO8601,
    duration: number,             // minutes
    stops: number,
    stopAirports: string[],       // IATA
    aircraftCode: string,
    aircraftName: string,
    airline: string,
    airlineIata: string,
    flightNumber: string,
    segments: [{ departure, arrival, airline, airlineIata, flightNumber, aircraftCode, aircraftName, duration }],
  }
  ```
- **Conventional commits** match the existing log: `feat(scope): ...`, `fix(scope): ...`, `chore(scope): ...`.

---

## Task 1: Capture ITA Matrix payload via Playwright MCP

**Why:** `itaMatrixService` needs the exact POST request shape (URL, headers, body format) to talk to `matrix.itasoftware.com`. The format is non-trivial (URL-encoded JSON-array-in-form-field). We capture once, save as fixture, then reference during implementation. **Do not write `itaMatrixService.js` until this task is done.**

**Files:**
- Create: `docs/superpowers/research/ita-matrix-payload.md`
- Create: `server/src/__tests__/fixtures/ita-matrix-request.json`
- Create: `server/src/__tests__/fixtures/ita-matrix-response.json`

- [ ] **Step 1: Open ITA Matrix in Playwright MCP**

Use Playwright MCP browser tools (already configured per memory `project_playwright.md`):

```
mcp__plugin_playwright_playwright__browser_navigate { url: "https://matrix.itasoftware.com/" }
mcp__plugin_playwright_playwright__browser_snapshot
```

- [ ] **Step 2: Perform a search**

Fill the form: Origin = `LIS`, Destination = `JFK`, departure date = today + 30 days, round-trip with return + 7 days, 1 adult. Submit search. Use `browser_fill_form` and `browser_click` actions.

- [ ] **Step 3: Capture network requests**

```
mcp__plugin_playwright_playwright__browser_network_requests
```

Find the POST request to `matrix.itasoftware.com/xhr/shop/search` (or similar `/xhr/` path). Capture:
- Full URL (with any query string)
- All request headers (especially `Content-Type`, `X-CSRF-Token`, `Cookie`)
- Full request body (URL-encoded form data)
- Full response body (JSON)

- [ ] **Step 4: Save fixtures**

Save the request body and headers verbatim into `server/src/__tests__/fixtures/ita-matrix-request.json`:

```json
{
  "url": "<full URL>",
  "method": "POST",
  "headers": { "Content-Type": "...", "...": "..." },
  "body": "<verbatim URL-encoded body>"
}
```

Save the response JSON verbatim into `server/src/__tests__/fixtures/ita-matrix-response.json`.

- [ ] **Step 5: Document payload schema**

Write `docs/superpowers/research/ita-matrix-payload.md` with these sections:
1. **Endpoint URL and HTTP method**
2. **Required headers** (which ones are session-specific vs static)
3. **Body decode** — the body is URL-encoded; once decoded it's a JSON-array-in-form-field. Show the decoded JSON structure with annotations: `[ "version", { ... params object ... } ]`. Annotate every field used in our search (origin, destination, dates, passengers, cabin).
4. **Response shape** — top-level keys, where prices live, where legs/segments live, units (price minor units? UTC vs local datetime?).
5. **Known unknowns** — any fields we couldn't decode and why (deferred to runtime fallback).

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/research/ita-matrix-payload.md \
        server/src/__tests__/fixtures/ita-matrix-request.json \
        server/src/__tests__/fixtures/ita-matrix-response.json
git commit -m "research(flights): capture ITA Matrix payload + response fixtures"
```

---

## Task 2: Go sidecar source code

**Why:** `gilby125/google-flights-api` is a Go library only — its `cmd/` only ships an MCP server which is the wrong protocol for Node.js → Go IPC. We write a 60-line plain HTTP wrapper that imports the library and exposes `/search` returning JSON.

**Files:**
- Create: `bin/google-flights-sidecar/go.mod`
- Create: `bin/google-flights-sidecar/main.go`
- Create: `bin/google-flights-sidecar/README.md`
- Modify: `server/.gitignore` (add the compiled binary path)

- [ ] **Step 1: Initialize Go module**

```bash
mkdir -p bin/google-flights-sidecar
cd bin/google-flights-sidecar
go mod init github.com/denyskolomiiets/flight/sidecar
go get github.com/gilby125/google-flights-api/flights@latest
go get golang.org/x/text/currency
go get golang.org/x/text/language
cd -
```

Verify `bin/google-flights-sidecar/go.mod` exists with `gilby125/google-flights-api` in `require`.

- [ ] **Step 2: Write `main.go`**

Create `bin/google-flights-sidecar/main.go`:

```go
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strconv"
	"time"

	"github.com/gilby125/google-flights-api/flights"
	"golang.org/x/text/currency"
	"golang.org/x/text/language"
)

type errBody struct {
	Error string `json:"error"`
}

func writeErr(w http.ResponseWriter, status int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(errBody{Error: msg})
}

func searchHandler(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	from := q.Get("from")
	to := q.Get("to")
	dateStr := q.Get("date")
	returnStr := q.Get("return")
	adultsStr := q.Get("adults")
	if adultsStr == "" {
		adultsStr = "1"
	}

	if from == "" || to == "" || dateStr == "" {
		writeErr(w, http.StatusBadRequest, "from, to, date are required")
		return
	}

	depDate, err := time.Parse("2006-01-02", dateStr)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "date must be YYYY-MM-DD")
		return
	}
	var retDate time.Time
	if returnStr != "" {
		retDate, err = time.Parse("2006-01-02", returnStr)
		if err != nil {
			writeErr(w, http.StatusBadRequest, "return must be YYYY-MM-DD")
			return
		}
	}
	adults, err := strconv.Atoi(adultsStr)
	if err != nil || adults < 1 {
		writeErr(w, http.StatusBadRequest, "adults must be a positive integer")
		return
	}

	session, err := flights.New()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, fmt.Sprintf("session init: %v", err))
		return
	}

	args := flights.Args{
		Date:        depDate,
		ReturnDate:  retDate,
		SrcAirports: []string{from},
		DstAirports: []string{to},
		Options: flights.Options{
			Travelers: flights.Travelers{Adults: adults},
			Currency:  currency.EUR,
			Stops:     flights.AnyStops,
			Class:     flights.Economy,
			TripType:  ternaryTripType(retDate.IsZero()),
			Lang:      language.English,
		},
	}

	ctx, cancel := context.WithTimeout(r.Context(), 12*time.Second)
	defer cancel()

	offers, _, err := session.GetOffers(ctx, args)
	if err != nil {
		writeErr(w, http.StatusBadGateway, fmt.Sprintf("upstream: %v", err))
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"offers":     offers,
		"queriedAt":  time.Now().UTC().Format(time.RFC3339),
		"upstreamMs": 0, // placeholder; gilby125 doesn't expose timing
	})
}

func ternaryTripType(oneWay bool) flights.TripType {
	if oneWay {
		return flights.OneWay
	}
	return flights.RoundTrip
}

func healthHandler(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "5002"
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/health", healthHandler)
	mux.HandleFunc("/search", searchHandler)

	srv := &http.Server{
		Addr:              "127.0.0.1:" + port,
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
	}
	log.Printf("google-flights-sidecar listening on %s", srv.Addr)
	log.Fatal(srv.ListenAndServe())
}
```

- [ ] **Step 3: Write README explaining usage**

Create `bin/google-flights-sidecar/README.md`:

```markdown
# google-flights-sidecar

Tiny HTTP wrapper around `github.com/gilby125/google-flights-api` so Node.js can call Google Flights without spawning Go on every request.

## Build

    go build -o google-flights-server .

## Run

    PORT=5002 ./google-flights-server

## Endpoints

- `GET /health` → `{ "status": "ok" }`
- `GET /search?from=LIS&to=JFK&date=2026-06-01&return=2026-06-08&adults=1`
  → `{ "offers": [...], "queriedAt": "..." }` (HTTP 200)
  → `{ "error": "..." }` (HTTP 4xx / 5xx)

Listens on `127.0.0.1` only — never bind public.
```

- [ ] **Step 4: Add binary path to gitignore**

Append to `server/.gitignore` (create the file if it doesn't exist):

```
# Compiled Go sidecar — built in CI, never committed
/bin/google-flights-sidecar/google-flights-server
```

Note: the binary is built into `server/bin/google-flights-server` for deploy, but the source lives in `bin/google-flights-sidecar/`. Adjust paths if the team prefers `server/bin/google-flights-sidecar/` instead — verify with the existing repo layout before committing.

- [ ] **Step 5: Verify it builds (smoke test, not a behaviour test)**

```bash
cd bin/google-flights-sidecar
go build -o /tmp/sidecar-smoke .
test -x /tmp/sidecar-smoke && echo OK
rm /tmp/sidecar-smoke
cd -
```

Expected: `OK` printed.

- [ ] **Step 6: Commit**

```bash
git add bin/google-flights-sidecar/ server/.gitignore
git commit -m "feat(sidecar): Go HTTP wrapper around gilby125/google-flights-api"
```

---

## Task 3: Build sidecar locally and capture response fixture

**Why:** The Node parser in Task 4 needs a real Google-Flights JSON response as a Jest fixture. We capture once, commit, never call live Google in unit tests.

**Files:**
- Create: `server/src/__tests__/fixtures/google-sidecar-response.json`

- [ ] **Step 1: Build and start sidecar in background**

```bash
cd bin/google-flights-sidecar
go build -o /tmp/sidecar .
PORT=5002 /tmp/sidecar &
SIDECAR_PID=$!
cd -
sleep 1
curl -sf http://127.0.0.1:5002/health || (echo "sidecar didn't start" && kill $SIDECAR_PID; exit 1)
```

Expected: `{"status":"ok"}`.

- [ ] **Step 2: Run a real search and save response**

```bash
DEP_DATE=$(date -v+30d +%Y-%m-%d 2>/dev/null || date -d '+30 days' +%Y-%m-%d)
RET_DATE=$(date -v+37d +%Y-%m-%d 2>/dev/null || date -d '+37 days' +%Y-%m-%d)
mkdir -p server/src/__tests__/fixtures
curl -sf "http://127.0.0.1:5002/search?from=LIS&to=JFK&date=$DEP_DATE&return=$RET_DATE&adults=1" \
  | python3 -m json.tool \
  > server/src/__tests__/fixtures/google-sidecar-response.json
```

Verify the file is valid JSON and contains a non-empty `offers` array:

```bash
node -e "const j = require('./server/src/__tests__/fixtures/google-sidecar-response.json'); console.log('offers:', j.offers?.length || 0)"
```

Expected: `offers: <some number > 0>`.

If `offers: 0`, the search returned no flights — pick a different date or route. **Do not commit a fixture with empty offers.**

- [ ] **Step 3: Stop the sidecar**

```bash
kill $SIDECAR_PID
```

- [ ] **Step 4: Document fixture provenance**

Append to `server/src/__tests__/fixtures/README.md` (create if absent):

```markdown
## google-sidecar-response.json

Captured from local `bin/google-flights-sidecar` against `LIS → JFK`,
30 days out, return +7d, 1 adult, EUR. Captured 2026-04-27.

Re-capture if Google changes the response shape — see Task 3 of the
google-flights-direct-and-ita-fallback plan.
```

- [ ] **Step 5: Commit**

```bash
git add server/src/__tests__/fixtures/google-sidecar-response.json \
        server/src/__tests__/fixtures/README.md
git commit -m "test(flights): capture Google Flights sidecar response fixture"
```

---

## Task 4: googleFlightsService.js (TDD)

**Why:** Node-side adapter to the Go sidecar. Single responsibility: HTTP call + parse → normalized flight array, or `null` on any failure.

**Files:**
- Create: `server/src/services/googleFlightsService.js`
- Create: `server/src/__tests__/googleFlightsService.test.js`

- [ ] **Step 1: Write failing parser test (happy path)**

Create `server/src/__tests__/googleFlightsService.test.js`:

```js
const path = require('path');
const fixture = require(path.join(__dirname, 'fixtures', 'google-sidecar-response.json'));
const svc = require('../services/googleFlightsService');

describe('googleFlightsService.parse', () => {
  test('parses sidecar response into normalized flight array', () => {
    const flights = svc.parse(fixture);
    expect(Array.isArray(flights)).toBe(true);
    expect(flights.length).toBeGreaterThan(0);

    const f = flights[0];
    expect(f).toHaveProperty('departure.code');
    expect(f).toHaveProperty('arrival.code');
    expect(f).toHaveProperty('departureTime');
    expect(f).toHaveProperty('arrivalTime');
    expect(typeof f.duration).toBe('number');
    expect(typeof f.stops).toBe('number');
    expect(f).toHaveProperty('airlineIata');
    expect(f).toHaveProperty('flightNumber');
    expect(Array.isArray(f.segments)).toBe(true);
    expect(f.segments.length).toBeGreaterThan(0);
  });

  test('returns empty array when offers is missing', () => {
    expect(svc.parse({})).toEqual([]);
    expect(svc.parse({ offers: null })).toEqual([]);
    expect(svc.parse(null)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL with "Cannot find module"**

```bash
cd server
npx jest --runInBand --testPathPatterns="googleFlightsService"
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal `parse()` to pass tests**

Create `server/src/services/googleFlightsService.js`. The exact field-mapping inside `parse()` depends on what `gilby125`'s `Offer` struct looks like in the captured fixture — read the fixture file before writing the mapping. Common gilby125 `Offer` fields are: `Price`, `FlightDuration`, `Flight[]` (legs) where each leg has `DepAirportCode`, `ArrAirportCode`, `DepTime`, `ArrTime`, `Duration`, `AirlineName`, `FlightNumber`, `Airplane`. Adapt the mapping below to the actual capitalisation/field names in the fixture.

```js
const axios = require('axios');

const SIDECAR_URL = process.env.GOOGLE_SIDECAR_URL || 'http://127.0.0.1:5002';
const TIMEOUT_MS  = parseInt(process.env.GOOGLE_SIDECAR_TIMEOUT_MS || '10000', 10);

/**
 * Convert a Google-sidecar JSON response into the normalized flight shape
 * used elsewhere in flightController. Pure function; no I/O.
 */
exports.parse = (raw) => {
  if (!raw || !Array.isArray(raw.offers)) return [];
  return raw.offers.map(buildFlight).filter(Boolean);
};

function buildFlight(offer) {
  const legs = offer.Flight || offer.flights || [];
  if (!legs.length) return null;
  const first = legs[0];
  const last  = legs[legs.length - 1];

  return {
    departure: { code: first.DepAirportCode, terminal: null, city: null, country: null },
    arrival:   { code: last.ArrAirportCode,  terminal: null, city: null, country: null },
    departureTime: first.DepTime,
    arrivalTime:   last.ArrTime,
    duration: minutesFromDuration(offer.FlightDuration),
    stops: legs.length - 1,
    stopAirports: legs.slice(0, -1).map(l => l.ArrAirportCode),
    aircraftCode: first.Airplane || 'N/A',
    aircraftName: first.Airplane || 'N/A',
    airline: first.AirlineName || first.AirlineIata,
    airlineIata: first.AirlineIata || extractIata(first.FlightNumber),
    flightNumber: first.FlightNumber,
    price: offer.Price ? { amount: Number(offer.Price), currency: 'EUR' } : null,
    segments: legs.map(l => ({
      departure: { code: l.DepAirportCode, time: l.DepTime, city: null },
      arrival:   { code: l.ArrAirportCode, time: l.ArrTime, city: null },
      airline: l.AirlineName,
      airlineIata: l.AirlineIata || extractIata(l.FlightNumber),
      flightNumber: l.FlightNumber,
      aircraftCode: l.Airplane || 'N/A',
      aircraftName: l.Airplane || 'N/A',
      duration: minutesFromDuration(l.Duration),
    })),
    source: 'google',
  };
}

function minutesFromDuration(v) {
  if (!v) return 0;
  if (typeof v === 'number') return v;                  // seconds → minutes
  const m = String(v).match(/(\d+)h\s*(\d+)?/);
  if (m) return parseInt(m[1], 10) * 60 + parseInt(m[2] || '0', 10);
  return 0;
}

function extractIata(flightNo) {
  const m = String(flightNo || '').match(/^([A-Z0-9]{2,3})\d/);
  return m ? m[1] : null;
}

/**
 * Live search via the sidecar. Returns normalized flight array or `null` on any failure.
 * Never throws — orchestrator relies on null = "advance to fallback".
 */
exports.search = async ({ departure, arrival, date, returnDate, passengers }) => {
  try {
    const params = { from: departure, to: arrival, date, adults: passengers || 1 };
    if (returnDate) params.return = returnDate;
    const res = await axios.get(`${SIDECAR_URL}/search`, {
      params,
      timeout: TIMEOUT_MS,
      validateStatus: s => s === 200,
    });
    return exports.parse(res.data);
  } catch (err) {
    console.warn('[googleFlightsService] search failed:', err.code || err.message);
    return null;
  }
};
```

- [ ] **Step 4: Run parse tests — expect PASS**

```bash
npx jest --runInBand --testPathPatterns="googleFlightsService"
```

Expected: PASS — both `parse` tests green.

If field names from the fixture differ from what the code assumes (e.g. `flight` vs `Flight`), edit `buildFlight()` to match the fixture, re-run.

- [ ] **Step 5: Add HTTP-failure tests**

Append to `server/src/__tests__/googleFlightsService.test.js`:

```js
const axios = require('axios');
jest.mock('axios');

describe('googleFlightsService.search', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns null on ECONNREFUSED', async () => {
    axios.get.mockRejectedValue({ code: 'ECONNREFUSED', message: 'connect ECONNREFUSED 127.0.0.1:5002' });
    const result = await svc.search({ departure: 'LIS', arrival: 'JFK', date: '2026-06-01' });
    expect(result).toBeNull();
  });

  test('returns null on timeout', async () => {
    axios.get.mockRejectedValue({ code: 'ECONNABORTED', message: 'timeout of 10000ms exceeded' });
    const result = await svc.search({ departure: 'LIS', arrival: 'JFK', date: '2026-06-01' });
    expect(result).toBeNull();
  });

  test('returns parsed flights on 200', async () => {
    axios.get.mockResolvedValue({ status: 200, data: fixture });
    const result = await svc.search({ departure: 'LIS', arrival: 'JFK', date: '2026-06-01' });
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 6: Run all googleFlightsService tests — expect PASS**

```bash
npx jest --runInBand --testPathPatterns="googleFlightsService"
```

Expected: PASS — all five tests green.

- [ ] **Step 7: Commit**

```bash
git add server/src/services/googleFlightsService.js \
        server/src/__tests__/googleFlightsService.test.js
git commit -m "feat(flights): googleFlightsService — sidecar adapter with normalized parser"
```

---

## Task 5: itaMatrixService.js (TDD)

**Why:** Fallback when sidecar fails. Direct HTTP POST to ITA Matrix using payload captured in Task 1. Single responsibility: HTTP call + parse → normalized flight array, or `null` on failure.

**Depends on:** Task 1 (fixture + research doc must exist).

**Files:**
- Create: `server/src/services/itaMatrixService.js`
- Create: `server/src/__tests__/itaMatrixService.test.js`

- [ ] **Step 1: Read research doc and fixture**

Open `docs/superpowers/research/ita-matrix-payload.md` and `server/src/__tests__/fixtures/ita-matrix-response.json`. Note exactly:
- response top-level key holding the offer list (e.g. `result.itineraries.itineraries`)
- where price lives (`pricings[0].price` etc.)
- where each leg's airport, datetime, carrier, flightNumber, aircraft live
- units (USD minor units? local time?)

You will mirror these in the parser below — replace placeholders with actual paths.

- [ ] **Step 2: Write failing parser test**

Create `server/src/__tests__/itaMatrixService.test.js`:

```js
const path = require('path');
const fixture = require(path.join(__dirname, 'fixtures', 'ita-matrix-response.json'));
const svc = require('../services/itaMatrixService');

describe('itaMatrixService.parse', () => {
  test('parses ITA response into normalized flight array', () => {
    const flights = svc.parse(fixture);
    expect(Array.isArray(flights)).toBe(true);
    expect(flights.length).toBeGreaterThan(0);

    const f = flights[0];
    expect(f.departure.code).toMatch(/^[A-Z]{3}$/);
    expect(f.arrival.code).toMatch(/^[A-Z]{3}$/);
    expect(typeof f.duration).toBe('number');
    expect(f.source).toBe('ita');
    expect(Array.isArray(f.segments)).toBe(true);
  });

  test('returns empty array on missing/empty input', () => {
    expect(svc.parse({})).toEqual([]);
    expect(svc.parse(null)).toEqual([]);
  });
});
```

- [ ] **Step 3: Run test — expect FAIL with "Cannot find module"**

```bash
npx jest --runInBand --testPathPatterns="itaMatrixService"
```

Expected: FAIL.

- [ ] **Step 4: Write minimal `parse()` to pass tests**

Create `server/src/services/itaMatrixService.js`. Replace the placeholder paths inside `parse()` with the actual paths discovered in research (Step 1):

```js
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const ITA_URL = 'https://matrix.itasoftware.com/xhr/shop/search';
const TIMEOUT_MS = parseInt(process.env.ITA_TIMEOUT_MS || '12000', 10);

const REQUEST_TEMPLATE = (() => {
  const p = path.join(__dirname, '..', '__tests__', 'fixtures', 'ita-matrix-request.json');
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
})();

/**
 * Pure JSON → normalized array. The exact paths must match the structure of
 * `ita-matrix-response.json`. Update field accessors here when ITA changes shape.
 */
exports.parse = (raw) => {
  if (!raw) return [];
  const itineraries = extractItineraries(raw);
  return itineraries.map(buildFlight).filter(Boolean);
};

// Path to the itinerary array in the ITA response. The exact path comes from
// the captured response fixture (Task 1). Replace this body with the actual
// path before the parse test will pass.
function extractItineraries(raw) {
  return raw.itineraries || raw.result?.itineraries?.itineraries || [];
}

function buildFlight(itin) {
  const slices = itin.slices || itin.legs || [];
  if (!slices.length) return null;
  const segments = slices.flatMap(s => s.segments || s.flights || []);
  if (!segments.length) return null;
  const first = segments[0];
  const last  = segments[segments.length - 1];

  return {
    departure: { code: first.origin || first.departure?.code, terminal: null, city: null, country: null },
    arrival:   { code: last.destination || last.arrival?.code, terminal: null, city: null, country: null },
    departureTime: first.departure || first.depart,
    arrivalTime:   last.arrival || last.arrive,
    duration: itin.totalDuration || sumDurations(segments),
    stops: segments.length - 1,
    stopAirports: segments.slice(0, -1).map(s => s.destination || s.arrival?.code),
    aircraftCode: first.aircraft || first.equipment || 'N/A',
    aircraftName: first.aircraft || first.equipment || 'N/A',
    airline: first.carrier?.name || first.carrier,
    airlineIata: first.carrier?.code || first.carrier,
    flightNumber: `${first.carrier?.code || ''}${first.flight || first.flightNumber || ''}`,
    price: extractPrice(itin),
    segments: segments.map(s => ({
      departure: { code: s.origin || s.departure?.code, time: s.departure || s.depart, city: null },
      arrival:   { code: s.destination || s.arrival?.code, time: s.arrival || s.arrive, city: null },
      airline: s.carrier?.name || s.carrier,
      airlineIata: s.carrier?.code || s.carrier,
      flightNumber: `${s.carrier?.code || ''}${s.flight || s.flightNumber || ''}`,
      aircraftCode: s.aircraft || s.equipment || 'N/A',
      aircraftName: s.aircraft || s.equipment || 'N/A',
      duration: s.duration || 0,
    })),
    source: 'ita',
  };
}

function sumDurations(segments) {
  return segments.reduce((sum, s) => sum + (s.duration || 0), 0);
}

// Price extraction. Real path comes from research output (Task 1).
function extractPrice(itin) {
  const p = itin.pricings?.[0]?.price?.amount ?? itin.price?.amount ?? null;
  if (p == null) return null;
  return { amount: Number(p), currency: itin.pricings?.[0]?.price?.currency || 'USD' };
}

/**
 * Live search via direct ITA POST. Returns normalized array or `null` on failure.
 */
exports.search = async ({ departure, arrival, date, returnDate, passengers }) => {
  if (!REQUEST_TEMPLATE) return null;
  try {
    const body = buildBody({ departure, arrival, date, returnDate, passengers });
    const res = await axios.post(REQUEST_TEMPLATE.url, body, {
      headers: REQUEST_TEMPLATE.headers,
      timeout: TIMEOUT_MS,
      validateStatus: s => s === 200,
    });
    return exports.parse(res.data);
  } catch (err) {
    console.warn('[itaMatrixService] search failed:', err.code || err.message);
    return null;
  }
};

// String-substitute the search params into the captured body template.
// The exact substitution strategy depends on the body shape from research:
// if the body is JSON-in-form-field, parse-mutate-stringify-encode instead.
function buildBody({ departure, arrival, date, returnDate, passengers }) {
  return REQUEST_TEMPLATE.body
    .replace(/__FROM__/g, departure)
    .replace(/__TO__/g, arrival)
    .replace(/__DATE__/g, date)
    .replace(/__RETURN__/g, returnDate || '')
    .replace(/__ADULTS__/g, String(passengers || 1));
}
```

After running the test in Step 5 below, edit `extractItineraries`, `buildFlight`, `extractPrice`, and `buildBody` to match what the fixture/research actually contain. The placeholders reflect *common* ITA shapes — confirm against the captured response.

- [ ] **Step 5: Run parse tests — adjust until PASS**

```bash
npx jest --runInBand --testPathPatterns="itaMatrixService"
```

Expected: PASS once placeholders are correctly replaced.

- [ ] **Step 6: Add HTTP-failure tests**

Append to `server/src/__tests__/itaMatrixService.test.js`:

```js
const axios = require('axios');
jest.mock('axios');

describe('itaMatrixService.search', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns null on HTTP 5xx', async () => {
    axios.post.mockRejectedValue({ response: { status: 500 }, message: '500' });
    expect(await svc.search({ departure: 'LIS', arrival: 'JFK', date: '2026-06-01' })).toBeNull();
  });

  test('returns null on timeout', async () => {
    axios.post.mockRejectedValue({ code: 'ECONNABORTED' });
    expect(await svc.search({ departure: 'LIS', arrival: 'JFK', date: '2026-06-01' })).toBeNull();
  });

  test('returns parsed flights on 200', async () => {
    axios.post.mockResolvedValue({ status: 200, data: fixture });
    const result = await svc.search({ departure: 'LIS', arrival: 'JFK', date: '2026-06-01' });
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 7: Run all itaMatrixService tests — expect PASS**

```bash
npx jest --runInBand --testPathPatterns="itaMatrixService"
```

Expected: PASS — five tests green.

- [ ] **Step 8: Commit**

```bash
git add server/src/services/itaMatrixService.js \
        server/src/__tests__/itaMatrixService.test.js
git commit -m "feat(flights): itaMatrixService — direct ITA Matrix XHR fallback"
```

---

## Task 6: flightSearchOrchestrator.js (TDD)

**Why:** Single-owner of the cache + fallback chain. Controllers call only this; tests mock the three sources independently and verify chain order, stale-cache fallback, and final-empty behaviour.

**Files:**
- Create: `server/src/services/flightSearchOrchestrator.js`
- Create: `server/src/__tests__/flightSearchOrchestrator.test.js`

- [ ] **Step 1: Write failing tests**

Create `server/src/__tests__/flightSearchOrchestrator.test.js`:

```js
jest.mock('../services/googleFlightsService');
jest.mock('../services/itaMatrixService');
jest.mock('../services/travelpayoutsService');
jest.mock('../services/cacheService');

const google = require('../services/googleFlightsService');
const ita = require('../services/itaMatrixService');
const tp = require('../services/travelpayoutsService');
const cache = require('../services/cacheService');
const orch = require('../services/flightSearchOrchestrator');

const PARAMS = { departure: 'LIS', arrival: 'JFK', date: '2026-06-01', passengers: 1 };
const STUB_FLIGHT = [{ departure: { code: 'LIS' }, arrival: { code: 'JFK' }, duration: 480, stops: 0, source: 'X', segments: [{}] }];

describe('flightSearchOrchestrator.search', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    cache.get.mockReturnValue(undefined);
    cache.set.mockImplementation(() => {});
  });

  test('returns cache when warm', async () => {
    cache.get.mockReturnValueOnce(STUB_FLIGHT);
    const r = await orch.search(PARAMS);
    expect(r.flights).toEqual(STUB_FLIGHT);
    expect(r.source).toBe('cache');
    expect(google.search).not.toHaveBeenCalled();
  });

  test('uses google when cache cold', async () => {
    google.search.mockResolvedValue(STUB_FLIGHT);
    const r = await orch.search(PARAMS);
    expect(r.source).toBe('google');
    expect(r.flights).toEqual(STUB_FLIGHT);
    expect(ita.search).not.toHaveBeenCalled();
    expect(cache.set).toHaveBeenCalled();
  });

  test('falls through to ITA when google returns null', async () => {
    google.search.mockResolvedValue(null);
    ita.search.mockResolvedValue(STUB_FLIGHT);
    const r = await orch.search(PARAMS);
    expect(r.source).toBe('ita');
    expect(google.search).toHaveBeenCalled();
    expect(ita.search).toHaveBeenCalled();
    expect(tp.getCheapest).not.toHaveBeenCalled();
  });

  test('falls through to ITA when google returns []', async () => {
    google.search.mockResolvedValue([]);
    ita.search.mockResolvedValue(STUB_FLIGHT);
    const r = await orch.search(PARAMS);
    expect(r.source).toBe('ita');
  });

  test('falls through to travelpayouts when both upstream fail', async () => {
    google.search.mockResolvedValue(null);
    ita.search.mockResolvedValue(null);
    tp.isConfigured.mockReturnValue(true);
    tp.getCheapest.mockResolvedValue(STUB_FLIGHT);
    const r = await orch.search(PARAMS);
    expect(r.source).toBe('travelpayouts');
  });

  test('returns empty when all sources fail', async () => {
    google.search.mockResolvedValue(null);
    ita.search.mockResolvedValue(null);
    tp.isConfigured.mockReturnValue(false);
    const r = await orch.search(PARAMS);
    expect(r.flights).toEqual([]);
    expect(r.source).toBe('none');
  });

  test('serves stale cache rather than empty when all sources fail', async () => {
    cache.get.mockImplementation((k) => (k.includes('stale:') ? STUB_FLIGHT : undefined));
    google.search.mockResolvedValue(null);
    ita.search.mockResolvedValue(null);
    tp.isConfigured.mockReturnValue(false);
    const r = await orch.search(PARAMS);
    expect(r.source).toBe('stale-cache');
    expect(r.flights).toEqual(STUB_FLIGHT);
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL with "Cannot find module"**

```bash
npx jest --runInBand --testPathPatterns="flightSearchOrchestrator"
```

Expected: FAIL.

- [ ] **Step 3: Write `flightSearchOrchestrator.js`**

Create `server/src/services/flightSearchOrchestrator.js`:

```js
const google = require('./googleFlightsService');
const ita = require('./itaMatrixService');
const tp = require('./travelpayoutsService');
const cache = require('./cacheService');

const TTL_FRESH = cache.TTL?.flights || 600;
const TTL_STALE = 24 * 60 * 60;

function cacheKey(params) {
  const { departure, arrival, date, returnDate, passengers } = params;
  return `flights:${departure}:${arrival}:${date}:${returnDate || ''}:${passengers || 1}`;
}

function staleKey(params) {
  return 'stale:' + cacheKey(params);
}

function nonEmpty(arr) {
  return Array.isArray(arr) && arr.length > 0;
}

/**
 * Run the fallback chain and return { flights, source }.
 * Never throws — orchestration errors get squashed into source: 'none'.
 */
exports.search = async (params) => {
  const key = cacheKey(params);
  const fresh = cache.get(key);
  if (nonEmpty(fresh)) return { flights: fresh, source: 'cache' };

  const candidates = [
    { name: 'google',        run: () => google.search(params) },
    { name: 'ita',           run: () => ita.search(params) },
    {
      name: 'travelpayouts',
      run: async () => (tp.isConfigured?.() ? tp.getCheapest?.(params) : null),
    },
  ];

  for (const c of candidates) {
    let result;
    try {
      result = await c.run();
    } catch (err) {
      console.warn(`[orchestrator] ${c.name} threw:`, err.message);
      result = null;
    }
    if (nonEmpty(result)) {
      cache.set(key, result, TTL_FRESH);
      cache.set(staleKey(params), result, TTL_STALE);
      return { flights: result, source: c.name };
    }
  }

  const stale = cache.get(staleKey(params));
  if (nonEmpty(stale)) return { flights: stale, source: 'stale-cache' };

  return { flights: [], source: 'none' };
};
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
npx jest --runInBand --testPathPatterns="flightSearchOrchestrator"
```

Expected: PASS — seven tests green. If anything fails, read the failing assertion message and adjust the orchestrator (do NOT alter test expectations to make them pass).

- [ ] **Step 5: Commit**

```bash
git add server/src/services/flightSearchOrchestrator.js \
        server/src/__tests__/flightSearchOrchestrator.test.js
git commit -m "feat(flights): orchestrator with cache + 3-source fallback chain"
```

---

## Task 7: Refactor `flightController.searchFlights` to use orchestrator

**Why:** The controller currently has ~80 LOC of inline `if (hasAmadeus) ... else if (hasDuffel) ...` followed by a separate Travelpayouts fallback block. With Amadeus dead and the new chain in place, this collapses to one orchestrator call. Smaller, clearer, fully tested.

**Files:**
- Modify: `server/src/controllers/flightController.js` (remove old branching, call orchestrator)

- [ ] **Step 1: Read the current handler**

```bash
sed -n '15,140p' server/src/controllers/flightController.js
```

Identify the block that decides `useRealAPI`, calls `amadeusService.searchFlights` / `duffelService.searchFlights`, and the subsequent `travelpayouts` fallback (~lines 50–620). This is what gets replaced.

- [ ] **Step 2: Inject the orchestrator import**

Edit `server/src/controllers/flightController.js`:

After existing requires, add:

```js
const flightSearchOrchestrator = require('../services/flightSearchOrchestrator');
```

- [ ] **Step 3: Replace the search dispatch**

Inside `exports.searchFlights`, replace the entire block from `let useRealAPI = ...` down to (and including) the existing Travelpayouts fallback in the same handler with:

```js
const orch = await flightSearchOrchestrator.search({
  departure, arrival, date, returnDate, passengers,
});
let flights = orch.flights;
const sourceLabel = orch.source;

if (aircraftType) {
  flights = flights.filter(f => {
    const ac = f.aircraft || aircraftData[f.aircraftCode];
    return ac && ac.type === aircraftType.toLowerCase();
  });
}
if (aircraftModel) {
  flights = flights.filter(f => f.aircraftCode === aircraftModel.toUpperCase());
}
if (directOnly) {
  flights = flights.filter(f => (f.stops || 0) === 0);
}

return res.json({
  source: sourceLabel,
  count: flights.length,
  flights,
});
```

Keep the post-filter logic (aircraftType / aircraftModel / directOnly) — these are independent of source. Adjust the response shape to match what the controller previously returned (read the existing `res.json(...)` call to confirm field names — keep them identical so the frontend doesn't break).

- [ ] **Step 4: Remove now-unused imports if and only if they have no other callers in the file**

Run:

```bash
grep -n "amadeusService\." server/src/controllers/flightController.js
grep -n "duffelService\." server/src/controllers/flightController.js
```

If `amadeusService` only appears in the require line + `parseDuration` calls, keep the require (it's used for `parseDuration` in `buildItinerary`). If `duffelService` is still used in `createOrder` later in the file, keep it. **Do not blindly delete imports.**

- [ ] **Step 5: Run existing tests to verify no regression**

```bash
cd server
npx jest --runInBand
```

Expected: all existing tests still PASS. If `auth.test.js` (14) or `historical.test.js` (23) break, the refactor changed something it shouldn't — bisect.

- [ ] **Step 6: Commit**

```bash
git add server/src/controllers/flightController.js
git commit -m "refactor(flights): route searchFlights through orchestrator chain"
```

---

## Task 8: PM2 sidecar process

**Why:** The Go binary needs to start on boot and restart on crash. PM2 already manages the Node API; we add a second app entry.

**Files:**
- Modify (or create): `ecosystem.config.js` at repo root

- [ ] **Step 1: Locate or create `ecosystem.config.js`**

```bash
ls ecosystem.config.js 2>/dev/null || ls server/ecosystem.config.js 2>/dev/null || echo "MISSING"
```

If missing, create at repo root with content:

```js
module.exports = {
  apps: [
    {
      name: 'flight-api',
      script: 'src/index.js',
      cwd: './server',
      instances: 1,
      autorestart: true,
      max_memory_restart: '500M',
      env: { NODE_ENV: 'production' },
    },
    {
      name: 'google-flights-sidecar',
      script: '/opt/flight/server/bin/google-flights-server',
      autorestart: true,
      max_memory_restart: '300M',
      env: { PORT: '5002', LOG_LEVEL: 'warn' },
    },
  ],
};
```

If it already exists, append the sidecar entry to the `apps:` array. **Do not change the existing `flight-api` entry without reading it first** — match its `cwd`, env, etc.

- [ ] **Step 2: Smoke-test PM2 config syntax locally**

```bash
node -e "console.log(JSON.stringify(require('./ecosystem.config.js'), null, 2))"
```

Expected: prints the config object without error.

- [ ] **Step 3: Commit**

```bash
git add ecosystem.config.js
git commit -m "chore(pm2): add google-flights-sidecar process"
```

---

## Task 9: deploy.yml — Go build + binary deploy

**Why:** GitHub Actions must compile the Go sidecar in CI (the VPS doesn't have Go) and ship the binary alongside the Node code.

**Files:**
- Modify: `.github/workflows/deploy.yml`

- [ ] **Step 1: Read current workflow**

```bash
cat .github/workflows/deploy.yml
```

Identify:
- the job that does the deploy (likely named `deploy` or similar)
- the step where `node` deps install / build happens
- the rsync command that ships the artifact to the VPS

- [ ] **Step 2: Add Go build step**

Insert before the rsync step, after the existing checkout:

```yaml
      - name: Set up Go
        uses: actions/setup-go@v5
        with:
          go-version: '1.22'

      - name: Build google-flights-sidecar
        run: |
          mkdir -p server/bin
          cd bin/google-flights-sidecar
          go build -o "$GITHUB_WORKSPACE/server/bin/google-flights-server" .
          test -x "$GITHUB_WORKSPACE/server/bin/google-flights-server"
```

- [ ] **Step 3: Verify rsync include-list**

Find the rsync command (probably something like `rsync -avz ./server/ user@host:/opt/flight/server/` or with `--include` filters). Confirm `server/bin/` is included. If the rsync uses an explicit `--include` allowlist, add `--include='bin/'  --include='bin/**'`. If it uses an `--exclude` list and `bin/` isn't excluded, no change needed.

- [ ] **Step 4: Add post-deploy PM2 reload**

After the rsync step, ensure there is a `pm2 reload ecosystem.config.js` (or equivalent) that picks up both `flight-api` and the new `google-flights-sidecar`. If the existing deploy only reloads `flight-api`, change it to reload the full ecosystem file.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/deploy.yml
git commit -m "ci(deploy): build Go sidecar and ship binary to VPS"
```

---

## Task 10: Schema canary workflow

**Why:** Catch Google Protobuf schema drift in CI, hours before users complain. Minimal cost: one search every 6 hours.

**Files:**
- Create: `.github/workflows/flight-canary.yml`

- [ ] **Step 1: Create canary workflow**

```yaml
name: flight-canary

on:
  schedule:
    - cron: '0 */6 * * *'   # every 6h
  workflow_dispatch: {}

jobs:
  canary:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - name: Hit production search and validate shape
        env:
          PROD_URL: https://himaxym.com
        run: |
          set -euo pipefail
          DEP=$(date -u -d '+30 days' +%Y-%m-%d)
          RESP=$(curl -fsS "$PROD_URL/api/flights?departure=LIS&arrival=JFK&date=$DEP&passengers=1")
          echo "$RESP" | jq -e '.flights | type == "array"' >/dev/null
          echo "$RESP" | jq -e '.flights | length > 0' >/dev/null
          echo "$RESP" | jq -e '.flights[0].departure.code | test("^[A-Z]{3}$")' >/dev/null
          echo "$RESP" | jq -e '.flights[0].arrival.code   | test("^[A-Z]{3}$")' >/dev/null
          echo "$RESP" | jq -e '.flights[0].duration | type == "number"' >/dev/null
          echo "$RESP" | jq -e '.flights[0].segments | type == "array" and length > 0' >/dev/null
          echo "OK source=$(echo "$RESP" | jq -r '.source')"
```

If the canary fails, GitHub sends an email to the repo owner, and Sentry will see the production error if the request itself returns 5xx. For a stronger signal, also add a `Notify Sentry` step using `curl` against the Sentry events API — *defer to a follow-up unless explicitly requested.*

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/flight-canary.yml
git commit -m "ci(canary): 6h schema-drift check on production search"
```

---

## Final verification checklist (run after Task 10)

- [ ] `npx jest --runInBand` from `server/` — all suites green (auth 14, historical 23, googleFlightsService 5, itaMatrixService 5, orchestrator 7 = **54 minimum**).
- [ ] `node -e "require('./ecosystem.config.js')"` from repo root — config parses.
- [ ] `cd bin/google-flights-sidecar && go build -o /tmp/sidecar . && rm /tmp/sidecar` — sidecar still compiles.
- [ ] Local end-to-end: start sidecar (`PORT=5002 ./google-flights-server`), start Node (`npm run dev`), `curl 'http://localhost:5001/api/flights?departure=LIS&arrival=JFK&date=2026-06-01'` returns 200 with `source: "google"` and a non-empty `flights` array.
- [ ] `git status` clean. `git log --oneline -15` shows ten new task commits on top of existing branch state.

## Out-of-scope (do NOT do as part of this plan)

- Adding SerpApi or any paid source.
- Removing dormant `amadeusService.js`.
- Touching the booking flow (`flightController.createOrder` / `duffelService.createOrder`).
- Frontend changes.
- Aircraft enrichment refactor — keep the `enrichWithAircraftData` calls exactly as they are, fed by the orchestrator's output.
