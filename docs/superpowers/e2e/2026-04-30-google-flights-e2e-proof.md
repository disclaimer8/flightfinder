# E2E Smoke Test — Google Flights chain

**Date:** 2026-04-30
**Branch:** chore/security-and-data-2026-04
**Purpose:** First-time end-to-end verification of the controller → orchestrator → sidecar → Google chain.

## Setup
- Local Go sidecar built from `bin/google-flights-sidecar/main.go` (Go 1.26.2 darwin/arm64), listening on 127.0.0.1:5002.
- Local Node server (NODE_ENV=development), listening on 5001.
- Request: `GET /api/flights?departure=LIS&arrival=JFK&date=2026-05-30&passengers=1`

## Result

```json
{
    "success": true,
    "count": 9,
    "source": "google",
    "data": [
        {
            "departure": {
                "code": "LIS",
                "terminal": null,
                "city": null,
                "country": null
            },
            "arrival": {
                "code": "JFK",
                "terminal": null,
                "city": null,
                "country": null
            },
            "departureTime": "2026-05-30T14:00:00+01:00",
            "arrivalTime": "2026-05-30T22:00:00-04:00",
            "duration": 780,
            "stops": 1,
            "stopAirports": [
                "BCN"
            ],
```

## Summary line
```
source: google count: 9 first: Vueling VY8467 780min 541 EUR
```

## Verdict
PASS — chain returns source `google`, non-empty data array with valid IATA codes, durations, and EUR prices.
