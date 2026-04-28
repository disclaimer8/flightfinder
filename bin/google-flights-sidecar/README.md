# google-flights-sidecar

Tiny HTTP wrapper around `github.com/gilby125/google-flights-api` so Node.js can call Google Flights without spawning Go on every request.

## Build

    go build -o google-flights-server .

## Run

    PORT=5002 ./google-flights-server

## Endpoints

- `GET /health` -> `{ "status": "ok" }`
- `GET /search?from=LIS&to=JFK&date=2026-06-01&return=2026-06-08&adults=1`
  -> `{ "offers": [...], "queriedAt": "..." }` (HTTP 200)
  -> `{ "error": "..." }` (HTTP 4xx / 5xx)

Listens on `127.0.0.1` only - never bind public.
