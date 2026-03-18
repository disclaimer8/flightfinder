# FlightFinder

> Search flights worldwide and filter results by aircraft type or specific model.

[![Node.js](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Overview

FlightFinder is a full-stack web application that lets you search for flights between airports and filter the results by aircraft category (turboprop, regional, jet, or wide-body) or by a specific aircraft model code (e.g. `789` for Boeing 787, `32N` for A320neo). It connects to the Amadeus and Duffel flight APIs, enriches results with aircraft and airline metadata from AirLabs, and includes an "Explore" mode that fans out to multiple popular destinations at once to show you which routes operate the aircraft you care about.

**Live application:** https://himaxym.com

<!-- Screenshot placeholder -->
<!-- ![FlightFinder search interface](docs/screenshot.png) -->

---

## Features

### Search

- One-way and round-trip flight search by IATA airport code
- Filter results by aircraft category: `turboprop`, `jet`, `regional`, `wide-body`
- Filter results by specific IATA aircraft model code (e.g. `789`, `32N`, `73H`)
- Passenger count selection (1–9)
- Optional return date for round-trip searches
- In-flight request cancellation — submitting a new search immediately cancels the previous one

### Explore

- Select a departure airport and an aircraft type or model to discover all reachable destinations that operate that equipment
- Results show the cheapest matching fare per destination, including duration, stops, airline, and departure time
- Clicking a destination pre-fills the search form and triggers a full flight search automatically

### Auth

- Email and password registration and login
- Access tokens stored in a React `useRef` — never written to `localStorage`, `sessionStorage`, or any cookie
- Refresh token stored in an `httpOnly`, `SameSite=Strict` cookie scoped to `/api/auth/refresh`
- Automatic token rotation on every refresh
- Timing-safe login: the server always runs `argon2.verify()` regardless of whether the email exists, preventing user enumeration via response timing

### Tech

- In-process response cache with separate TTLs for flights (10 min), explore results (30 min), and aircraft metadata (24 h)
- Two-tier rate limiting: 120 requests / 15 min per IP across all `/api` routes, plus 20 requests / min specifically on flight search endpoints, and 10 requests / 15 min on auth endpoints
- Automatic fallback to mock data when Amadeus credentials are absent or the upstream API fails
- Development-only debug endpoints for inspecting and flushing the cache

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, Vite 8 |
| Frontend testing | Vitest 4, Testing Library, jsdom |
| Backend | Node.js 20+, Express 5 |
| Backend testing | Jest 30, Supertest |
| Database | SQLite via better-sqlite3, WAL mode |
| Authentication | argon2id (via argon2), JSON Web Tokens (jsonwebtoken) |
| Flight data | Amadeus SDK v11, Duffel REST API |
| Aircraft / airline metadata | AirLabs REST API |
| Caching | node-cache (in-process) |
| Security | helmet, express-rate-limit, cookie-parser |
| Server | Hetzner VPS, PM2 |
| Reverse proxy | nginx with Let's Encrypt TLS |
| CI/CD | GitHub Actions |

---

## Project Structure

```
flightfinder/
├── client/                  # React frontend (Vite)
│   └── src/
│       ├── components/      # UI components (SearchForm, FlightResults, ExploreResults, …)
│       ├── context/         # AuthContext — access token ref, login/register/logout
│       ├── hooks/           # useFlightSearch — all search and explore fetch logic
│       └── utils/           # flightUtils — query string building helpers
├── server/                  # Express backend
│   ├── data/                # SQLite database file (created at runtime, gitignored)
│   └── src/
│       ├── controllers/     # flightController, authController, aircraftController
│       ├── middleware/      # requireAuth (JWT verification), validate (input sanitisation)
│       ├── models/          # db.js (SQLite + prepared statements), aircraftData.js, popularDestinations.js
│       ├── routes/          # auth.js, flights.js, aircraft.js
│       └── services/        # amadeusService, duffelService, airlabsService,
│                            #   cacheService, authService, openFlightsService
├── nginx/
│   └── himaxym.conf         # nginx server block (HTTP → HTTPS redirect + proxy to port 5001)
└── .github/
    └── workflows/
        └── deploy.yml       # GitHub Actions deployment pipeline
```

---

## Prerequisites

- **Node.js 20+** — [nodejs.org](https://nodejs.org)
- **npm 10+** — included with Node.js 20
- **Amadeus API credentials** (optional, but required for live flight data) — [developers.amadeus.com](https://developers.amadeus.com)

---

## Local Development Setup

### 1. Clone the repository

```bash
git clone https://github.com/<your-org>/flightfinder.git
cd flightfinder
```

### 2. Install server dependencies

```bash
cd server && npm install
```

### 3. Install client dependencies

```bash
cd ../client && npm install
```

### 4. Create the server environment file

Create `server/.env`. A full variable reference is in the [Environment Variables](#environment-variables) section. At minimum you need:

```dotenv
PORT=5001
NODE_ENV=development
JWT_SECRET=replace-this-with-a-random-string-of-at-least-32-characters
```

### 5. Start the backend

```bash
cd server && npm run dev
```

You should see:

```
Server running on port 5001 [development]
```

### 6. Start the frontend

Open a second terminal:

```bash
cd client && npm start
```

Vite starts on `http://localhost:3000` and proxies `/api` requests to the backend.

### 7. Open the application

Navigate to [http://localhost:3000](http://localhost:3000).

> **No API keys?** The server falls back to bundled mock flights automatically when `AMADEUS_CLIENT_ID` is not set. All filtering, caching, and auth flows work against mock data.

---

## Environment Variables

Create `server/.env` with the following variables. Variables marked **Required** will cause the server to throw on startup (in production) or produce degraded behaviour (in development) if absent.

| Variable | Required | Default | Description |
|---|---|---|---|
| `PORT` | No | `5000` | Port the Express server listens on. Set to `5001` to match the nginx config. |
| `NODE_ENV` | No | `development` | Set to `production` on the server. Controls error detail in responses, secure cookie flag, debug endpoint availability, and CORS defaults. |
| `AMADEUS_CLIENT_ID` | No | — | Amadeus API client ID. Without this, the server serves mock flight data. |
| `AMADEUS_CLIENT_SECRET` | No | — | Amadeus API client secret. |
| `AMADEUS_ENV` | No | `test` | Amadeus environment: `test` or `production`. Use `production` for live pricing. |
| `DUFFEL_API_KEY` | No | — | Duffel API key. Required to use Duffel as the flight source or to enable the booking endpoint. |
| `AIRLABS_API_KEY` | No | — | AirLabs API key for live aircraft and airline metadata enrichment. Falls back to static local data if absent. |
| `FLIGHT_API` | No | `amadeus` | Default flight data source: `amadeus` or `duffel`. |
| `LOCK_FLIGHT_API` | No | — | Set to `true` to prevent per-request `?api=` overrides. Recommended in production. |
| `JWT_SECRET` | Yes (prod) | dev fallback | Secret for signing access tokens. **Must be at least 32 characters in production.** The server throws on startup if this constraint is not met. |
| `JWT_EXPIRY` | No | `900` | Access token lifetime in seconds (default: 15 minutes). |
| `REFRESH_TOKEN_EXPIRY` | No | `604800` | Refresh token lifetime in seconds (default: 7 days). |
| `ALLOWED_ORIGINS` | No | localhost URLs in dev, none in prod | Comma-separated list of allowed CORS origins, e.g. `https://himaxym.com`. |

Example `server/.env` for local development with live Amadeus data:

```dotenv
PORT=5001
NODE_ENV=development
AMADEUS_CLIENT_ID=your_amadeus_client_id
AMADEUS_CLIENT_SECRET=your_amadeus_client_secret
AMADEUS_ENV=test
AIRLABS_API_KEY=your_airlabs_key
FLIGHT_API=amadeus
JWT_SECRET=a-locally-generated-random-string-that-is-at-least-32-chars
JWT_EXPIRY=900
REFRESH_TOKEN_EXPIRY=604800
```

---

## API Reference

All endpoints are prefixed with `/api`. JSON is the only supported content type.

Successful responses always include `"success": true`. Error responses always include `"success": false` and a `"message"` string.

### Rate limits

| Scope | Limit |
|---|---|
| All `/api` routes | 120 requests / 15 min per IP |
| `/api/flights` routes | 20 requests / min per IP |
| `/api/auth` routes | 10 requests / 15 min per IP |

Rate limit headers (`RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`) are included in every response.

---

### Flights

#### `GET /api/flights`

Search for flights between two airports.

**Query parameters**

| Parameter | Required | Format | Description |
|---|---|---|---|
| `departure` | Yes | IATA code (2–3 letters, e.g. `LIS`) | Departure airport |
| `arrival` | Yes | IATA code (2–3 letters, e.g. `JFK`) | Arrival airport. Must differ from `departure`. |
| `date` | No | `YYYY-MM-DD` | Departure date. Must not be in the past. Defaults to tomorrow. |
| `returnDate` | No | `YYYY-MM-DD` | Return date for round-trip. Must be on or after `date`. |
| `passengers` | No | Integer 1–9 | Number of passengers. Defaults to `1`. |
| `aircraftType` | No | `turboprop` \| `jet` \| `regional` \| `wide-body` | Post-fetch filter: only return flights operated on this aircraft category. |
| `aircraftModel` | No | 1–6 alphanumeric chars, e.g. `789` | Post-fetch filter: only return flights on this specific IATA aircraft code. |
| `api` | No | `amadeus` \| `duffel` | Override the active flight API for this request. Ignored when `LOCK_FLIGHT_API=true`. |
| `useMockData` | No | `true` | Force mock data regardless of configured credentials. Useful in development. |

**Response — 200**

```json
{
  "success": true,
  "count": 4,
  "source": "amadeus",
  "data": [
    {
      "id": "amadeus_0",
      "departure": {
        "code": "LIS",
        "city": "Lisbon",
        "country": "Portugal",
        "terminal": "1"
      },
      "arrival": {
        "code": "JFK",
        "city": "New York",
        "country": "United States",
        "terminal": "4"
      },
      "aircraftCode": "789",
      "aircraftName": "Boeing 787 Dreamliner",
      "aircraft": {
        "name": "Boeing 787 Dreamliner",
        "type": "wide-body",
        "capacity": 250,
        "range": 8000,
        "cruiseSpeed": 490
      },
      "airline": "TAP Air Portugal",
      "airlineIata": "TP",
      "flightNumber": "TP201",
      "departureTime": "2026-03-20T10:15:00",
      "arrivalTime": "2026-03-20T13:45:00",
      "duration": "8h 30m",
      "stops": 0,
      "stopAirports": [],
      "segments": [],
      "price": "612.50",
      "currency": "EUR",
      "isRoundTrip": false,
      "returnItinerary": null,
      "source": "amadeus"
    }
  ]
}
```

`source` will be `"amadeus"`, `"duffel"`, or `"mock"`. Responses are cached for 10 minutes per unique combination of departure, arrival, date, passengers, and return date.

---

#### `GET /api/flights/explore`

Fan out to a list of popular destinations from a departure airport and return only those where at least one flight matches the requested aircraft criteria. This is an expensive operation — results are cached for 30 minutes.

**Query parameters**

| Parameter | Required | Format | Description |
|---|---|---|---|
| `departure` | Yes | IATA code | Origin airport |
| `date` | No | `YYYY-MM-DD` | Target departure date. Must not be in the past. Defaults to tomorrow. |
| `aircraftType` | No* | `turboprop` \| `jet` \| `regional` \| `wide-body` | Filter destinations by aircraft category. |
| `aircraftModel` | No* | 1–6 alphanumeric chars | Filter destinations by specific aircraft model. |

\* At least one of `aircraftType` or `aircraftModel` is required.

**Response — 200**

```json
{
  "success": true,
  "count": 6,
  "data": [
    {
      "destination": { "code": "CDG", "name": "Paris" },
      "price": "189.00",
      "currency": "EUR",
      "duration": "2h 20m",
      "stops": 0,
      "airline": "Air France",
      "aircraftCode": "32N",
      "aircraftName": "Airbus A320neo",
      "aircraftType": "jet",
      "departureTime": "2026-03-20T07:30:00",
      "arrivalTime": "2026-03-20T09:50:00"
    }
  ]
}
```

Each item represents the cheapest qualifying flight found to that destination.

---

#### `GET /api/flights/filter-options`

Returns the data required to populate the search form: available city pairs, aircraft type labels, the full aircraft catalogue, and a status object showing which upstream APIs are currently configured.

No query parameters.

**Response — 200**

```json
{
  "cities": [
    { "code": "LIS", "name": "Lisbon" },
    { "code": "JFK", "name": "New York (JFK)" }
  ],
  "aircraftTypes": ["turboprop", "jet", "regional", "wide-body"],
  "aircraft": [
    {
      "code": "789",
      "name": "Boeing 787 Dreamliner",
      "type": "wide-body",
      "capacity": 250,
      "range": 8000,
      "cruiseSpeed": 490
    }
  ],
  "apiStatus": {
    "amadeus": true,
    "airlabs": false
  }
}
```

---

#### `POST /api/flights/book`

Create a booking through the Duffel API. Requires a valid Duffel offer ID from a prior search with `FLIGHT_API=duffel`. Returns `503` if `DUFFEL_API_KEY` is not configured.

**Request body**

```json
{
  "offerId": "off_0000...",
  "passengerIds": ["pas_0000..."],
  "passengerInfo": [
    {
      "title": "mr",
      "firstName": "Jane",
      "lastName": "Smith",
      "email": "jane@example.com",
      "dateOfBirth": "1990-06-15",
      "gender": "F"
    }
  ],
  "currency": "EUR",
  "totalAmount": "612.50"
}
```

Validation rules:
- `title` must be one of `mr`, `ms`, `mrs`, `miss`, `dr`
- `gender` must be `M` or `F`
- `dateOfBirth` format is `YYYY-MM-DD`; passenger must be 18 or older
- `currency` must be `EUR`, `USD`, or `GBP`
- Maximum 9 passengers

**Response — 200**

```json
{
  "success": true,
  "data": {
    "orderId": "ord_0000...",
    "bookingReference": "ABC123",
    "status": "confirmed",
    "documents": []
  }
}
```

---

### Auth

All auth endpoints share a rate limit of 10 requests per 15 minutes per IP.

#### `POST /api/auth/register`

Create a new account. Does not issue tokens — call `/api/auth/login` after registration.

**Request body**

```json
{ "email": "you@example.com", "password": "at-least-8-chars" }
```

Passwords must be 8–128 characters. Email is normalised to lowercase before storage.

**Response — 201**

```json
{ "success": true, "message": "Account created" }
```

**Error responses**

| Status | Condition |
|---|---|
| `400` | Invalid email format, or password outside 8–128 character range |
| `409` | Email already registered |

---

#### `POST /api/auth/login`

Authenticate and receive tokens.

**Request body**

```json
{ "email": "you@example.com", "password": "your-password" }
```

**Response — 200**

```json
{
  "success": true,
  "accessToken": "<JWT>",
  "expiresIn": 900
}
```

The response also sets a `refreshToken` cookie (`httpOnly`, `SameSite=Strict`, `Secure` in production) scoped to `/api/auth/refresh`. The raw token value is never exposed anywhere else.

**Error responses**

| Status | Condition |
|---|---|
| `400` | Missing or malformed email or password field |
| `401` | Invalid credentials |

---

#### `POST /api/auth/refresh`

Exchange a valid refresh token cookie for a new access token. The old refresh token is deleted and a new one is issued in the same response (token rotation). No request body is needed — the cookie is read automatically by the browser.

**Response — 200**

```json
{
  "success": true,
  "accessToken": "<new JWT>",
  "expiresIn": 900
}
```

**Error responses**

| Status | Condition |
|---|---|
| `401` | Cookie absent, token not found in database, or token expired |

---

#### `POST /api/auth/logout`

Delete the current refresh token from the database and clear the cookie. Succeeds silently even if no cookie is present.

No request body required.

**Response — 200**

```json
{ "success": true, "message": "Logged out" }
```

---

#### `GET /api/auth/me`

Return the authenticated user's profile. Requires a valid `Authorization: Bearer <accessToken>` header.

**Auth required:** Yes

**Response — 200**

```json
{
  "success": true,
  "user": {
    "id": 1,
    "email": "you@example.com",
    "created_at": 1710000000000
  }
}
```

**Error responses**

| Status | Condition |
|---|---|
| `401` | Missing, invalid, or expired access token |
| `404` | User record deleted after token was issued |

---

### Aircraft

#### `GET /api/aircraft`

Return all aircraft in the local catalogue.

#### `GET /api/aircraft/:iataCode`

Return a single aircraft by its IATA code (e.g. `GET /api/aircraft/789`).

#### `GET /api/aircraft/type/:type`

Return all aircraft matching a category (e.g. `GET /api/aircraft/type/wide-body`). Valid types: `turboprop`, `jet`, `regional`, `wide-body`.

---

### Utility

#### `GET /api/health`

Returns the current runtime environment. Safe to use as an uptime check.

```json
{ "status": "ok", "env": "production" }
```

---

### Development-only endpoints

The following endpoints are only registered when `NODE_ENV !== 'production'`.

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/debug/cache` | Return cache statistics: key count, hit count, miss count |
| `DELETE` | `/api/debug/cache` | Flush the entire in-process cache |
| `GET` | `/api/debug/amadeus` | Run a test Amadeus search (LIS → JFK, tomorrow, 1 passenger) and return the number of offers found |

---

## Authentication Flow

### Registration

1. Client sends `POST /api/auth/register` with email and password.
2. Server validates input (email format, password 8–128 chars).
3. Server checks that the email is not already registered.
4. Password is hashed with argon2id.
5. User row is inserted into SQLite.
6. `201 Created` is returned. No tokens are issued at this step.

### Login

1. Client sends `POST /api/auth/login`.
2. Server looks up the user by email.
3. To prevent user enumeration via timing, the server **always** calls `argon2.verify()` — against the stored hash if the user exists, or against a fixed dummy hash if the email is unknown. Response time is therefore constant.
4. On success the server generates:
   - A **JWT access token** signed with HS256, containing `sub` (user ID) and `email` claims. Expires in `JWT_EXPIRY` seconds.
   - A **refresh token**: 40 cryptographically random bytes encoded as hex. Only the SHA-256 hash of this value is stored in the `refresh_tokens` table.
5. The raw refresh token is set as an `httpOnly`, `SameSite=Strict` cookie scoped to the path `/api/auth/refresh`. JavaScript cannot read it.
6. The access token is returned in the JSON response body.

### Token storage on the client

`AuthContext` stores the access token in a React `useRef` — it lives in JavaScript heap memory for the lifetime of the page session. It is never written to `localStorage`, `sessionStorage`, or any cookie. A page refresh discards the in-memory token; the application silently re-acquires one on mount by calling the refresh endpoint, which reads the `httpOnly` cookie without any JavaScript involvement.

### Token refresh

1. Client calls `POST /api/auth/refresh` with `credentials: 'include'`.
2. Server reads the `refreshToken` cookie, hashes it with SHA-256, and looks the hash up in the database.
3. If valid and not expired: the existing record is deleted, a new refresh token is generated and persisted, a new access token is signed, and both are returned. This is rotation — the old refresh token cannot be used again.
4. If the token is invalid or expired: the cookie is cleared and `401` is returned.

### Logout

1. Client calls `POST /api/auth/logout` with `credentials: 'include'`.
2. Server deletes the refresh token record from the database and clears the cookie with `maxAge: 0`.
3. Client clears the in-memory token ref and sets user state to `null`.

---

## Running Tests

### Client (Vitest)

```bash
cd client && npm test
```

Run in watch mode while developing:

```bash
cd client && npm run test:watch
```

Open the browser-based Vitest UI:

```bash
cd client && npm run test:ui
```

### Server (Jest)

```bash
cd server && npm test
```

Run in watch mode:

```bash
cd server && npm run test:watch
```

Server tests run with `NODE_ENV=test`, which switches the SQLite database to an in-memory instance so no on-disk file is created or modified. The auth rate limiter is also bypassed in test mode.

---

## Deployment

### Automatic deployment via GitHub Actions

Every push to `main` triggers `.github/workflows/deploy.yml`. The workflow:

1. SSH into the Hetzner VPS as `root`, using the private key stored in the `claude` GitHub Actions secret.
2. Pulls the latest code: `git pull origin main`.
3. Installs production server dependencies (dev dependencies excluded): `npm install --omit=dev`.
4. Installs client dependencies and builds the React app: `npm install && npm run build`.
5. Copies `nginx/himaxym.conf` to `/etc/nginx/sites-enabled/flightfinder`, tests the config, and reloads nginx.
6. Restarts the PM2 process named `flightfinder` with `--update-env` so any changed environment variables are applied.
7. Saves the PM2 process list.

The nginx config is version-controlled in `nginx/himaxym.conf`. Changes to it are deployed automatically on the next push to `main` — no manual SSH is required.

### Manual deployment

```bash
# Run on the VPS
cd ~/flightfinder
git pull origin main
cd server && npm install --omit=dev
cd ../client && npm install && npm run build
cp nginx/himaxym.conf /etc/nginx/sites-enabled/flightfinder
nginx -t && systemctl reload nginx
pm2 restart flightfinder --update-env && pm2 save
```

### Environment variables on the server

PM2 can cache environment variables between restarts. The server loads `server/.env` with `dotenv`'s `override: true` flag, so values in that file replace any stale PM2-cached values. `NODE_ENV` is exempted from override so that `NODE_ENV=test` set by Jest is never overwritten by the file.

To update a secret on the server: edit `server/.env` on the VPS, then run `pm2 restart flightfinder --update-env`.

### Checking the server

```bash
# PM2 process list
pm2 status

# Tail application logs
pm2 logs flightfinder

# Verify TLS and application health
curl -I https://himaxym.com
curl https://himaxym.com/api/health
```

---

## Architecture Decisions

### SQLite instead of a hosted database

User accounts and refresh tokens are the only persistent data. Write volume is low (registrations and token rotations). SQLite with WAL mode handles concurrent reads efficiently, eliminates infrastructure dependencies, and keeps the deployment self-contained on a single VPS. Migration to Postgres is straightforward if needed: the data access layer in `server/src/models/db.js` uses prepared statements and a thin module boundary with no ORM coupling.

### In-process cache instead of Redis

Flight search responses are expensive (external API latency) but suitable for short-lived caching and non-critical to persist across restarts. A single-process Node.js deployment makes `node-cache` a sufficient and zero-infrastructure choice.

Cache keys are namespaced to prevent collisions between different data shapes:
- `flights:<api>:<dep>:<arr>:<date>:<passengers>:<returnDate>` — formatted, filtered results ready to serve
- `raw:amadeus:<dep>:<arr>:<date>:1:` — raw Amadeus API responses, reused across explore fan-out batches to avoid redundant upstream calls
- `explore:<dep>:<date>:<aircraftType>:<aircraftModel>` — assembled explore result sets

### Access token in memory, not localStorage

Storing the JWT in a React `useRef` means third-party scripts cannot exfiltrate it via `localStorage` or `document.cookie`, reducing the XSS attack surface. The trade-off is that a page refresh loses the token. The application recovers transparently on mount by calling `POST /api/auth/refresh`, which reads the `httpOnly` cookie that JavaScript has no access to.

### Native `fetch` instead of axios

The client uses the browser's built-in `fetch` API. `AbortController` handles request cancellation when a new search supersedes an in-flight one. The server also uses Node's built-in `fetch` (available since Node 18) for Duffel and AirLabs calls, keeping the dependency count lean.

### Per-request API override (`?api=amadeus|duffel`)

During development it is useful to compare Amadeus and Duffel responses for the same query without restarting the server. Setting `LOCK_FLIGHT_API=true` in production disables this override so that clients cannot influence which upstream API is used.

---

## Contributing

1. Fork the repository and create a branch from `main`.

```bash
git checkout -b feature/your-feature-name
```

2. Make your changes. New server code should have corresponding tests in `server/src/__tests__/` and new client behaviour should have tests in `client/src/`.

3. Run both test suites before opening a pull request.

```bash
cd server && npm test
cd ../client && npm test
```

4. Open a pull request against `main` with a description of what changed and why.

Code that adds or modifies a public API endpoint should include updated documentation in this README under the relevant section of the [API Reference](#api-reference).

---

## License

MIT
