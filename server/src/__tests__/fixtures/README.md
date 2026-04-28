# Test fixtures

This directory holds verbatim third-party responses used as Jest fixtures so unit
tests never call live upstreams. Each fixture should have a short provenance
note below explaining what was captured and how to re-capture it.

## google-sidecar-response.json

Captured from local `bin/google-flights-sidecar` against `LIS -> JFK`,
30 days out, return +7d, 1 adult, EUR.
Captured 2026-04-28.

Re-capture if Google changes the response shape -- see Task 3 of the
google-flights-direct-and-ita-fallback plan.
