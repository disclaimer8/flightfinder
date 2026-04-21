'use strict';

/**
 * Aircraft Search Service
 *
 * Fan-out search: finds flights operated by a specific aircraft family
 * across multiple origin airports (optionally filtered by city + radius).
 *
 * Streams results via an async generator so the SSE controller can push
 * results to the client as they arrive.
 */

const popularDestinations = require('../models/popularDestinations');
const amadeusService = require('./amadeusService');
const duffelService  = require('./duffelService');
const cacheService   = require('./cacheService');
const openFlights    = require('./openFlightsService');
const geocoding      = require('./geocodingService');
const { getFamilyCodes, getFamilyRange } = require('../models/aircraftFamilies');

const BATCH_SIZE  = 4;
const BATCH_DELAY = 220; // ms between batches — Amadeus test API ~10 req/s
const MAX_ORIGINS = 3;   // max departure airports to search from
const MAX_DESTS   = 25;  // max destinations per origin

const delay = ms => new Promise(r => setTimeout(r, ms));

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Resolve departure airports from optional city + radius params.
 * Falls back to using a single explicit IATA code.
 *
 * @param {{ city?: string, radius?: number, iata?: string }} params
 * @returns {{ iata: string, name: string, city: string, distanceKm: number }[]}
 */
function resolveOrigins({ city, radius, iata }) {
  if (city) {
    const r = typeof radius === 'number' && radius > 0 ? radius : 200;
    const results = geocoding.resolveCity(city, r, MAX_ORIGINS);
    if (results.length) return results;
  }
  if (iata) {
    const airport = openFlights.getAirport(iata);
    if (airport) return [{ ...airport, distanceKm: 0 }];
  }
  return [];
}

/**
 * Filter popularDestinations to those within the aircraft's operational range
 * from a given origin airport. Removes the origin itself.
 *
 * @param {string} familyName
 * @param {{ lat: number, lon: number, iata: string }} originAirport
 * @returns {{ code: string, city: string, country: string }[]}
 */
function getRelevantDestinations(familyName, originAirport) {
  const maxRange = getFamilyRange(familyName);
  const MIN_DIST = 100; // km — filter trivially short hops

  return popularDestinations
    .filter(dest => {
      if (dest.code === originAirport.iata) return false;
      const destAirport = openFlights.getAirport(dest.code);
      if (!destAirport?.lat || !destAirport?.lon) return false;
      const dist = geocoding.haversineKm(
        originAirport.lat, originAirport.lon,
        destAirport.lat,   destAirport.lon
      );
      return dist >= MIN_DIST && dist <= maxRange * 0.90;
    })
    .slice(0, MAX_DESTS);
}

/**
 * Format and filter a raw Amadeus response, keeping only flights whose
 * aircraft code is in the family's code set.
 *
 * Returns the cheapest matching flight for this origin→destination pair,
 * or null if none match.
 */
function extractBestFlight(raw, familyCodes, origin, dest) {
  if (!raw?.data?.length) return null;

  const dict = raw.dictionaries || {};
  const flights = raw.data;

  const matching = [];

  for (const offer of flights) {
    // Collect all aircraft codes used across all segments
    const codes = (offer.itineraries || [])
      .flatMap(it => (it.segments || []))
      .map(seg => seg.aircraft?.code)
      .filter(Boolean);

    // Flight matches if any segment uses a family aircraft
    if (!codes.some(c => familyCodes.has(c))) continue;

    const price   = parseFloat(offer.price?.grandTotal || offer.price?.total || 0);
    const currency = offer.price?.currency || 'EUR';
    const firstSeg = offer.itineraries?.[0]?.segments?.[0];
    const lastSeg  = offer.itineraries?.[0]?.segments?.at(-1);
    const stops    = (offer.itineraries?.[0]?.segments?.length || 1) - 1;
    const duration = offer.itineraries?.[0]?.duration || '';

    // Pick the first family-matching aircraft code to display
    const displayCode = codes.find(c => familyCodes.has(c)) || codes[0];
    const aircraftName = dict.aircraft?.[displayCode] || displayCode;

    matching.push({
      offerId: offer.id,
      origin,
      destination: dest,
      price: price.toFixed(2),
      currency,
      departureTime: firstSeg?.departure?.at || null,
      arrivalTime:   lastSeg?.arrival?.at    || null,
      duration,
      stops,
      aircraftCode: displayCode,
      aircraftName,
      airline: firstSeg?.carrierCode || null,
    });
  }

  if (!matching.length) return null;
  return matching.sort((a, b) => parseFloat(a.price) - parseFloat(b.price))[0];
}

/**
 * Format and filter a raw Duffel response, keeping only offers whose aircraft
 * (on any segment of the outbound slice) matches a code in the family code set.
 *
 * Duffel shape: { data: { offers: [...] } } OR { offers: [...] }.
 * Each offer: { id, total_amount, total_currency, slices: [{ duration, segments: [{
 *   aircraft: { iata_code, name }, operating_carrier, marketing_carrier,
 *   departing_at, arriving_at, origin, destination }]}] }
 *
 * Returns the cheapest matching offer in the same normalized shape as
 * `extractBestFlight` (Amadeus), or null if none match.
 */
function extractBestFlightDuffel(raw, familyCodes, origin, dest) {
  const offers = raw?.data?.offers || raw?.offers || [];
  if (!offers.length) return null;

  const matching = [];

  for (const offer of offers) {
    const slice = offer.slices?.[0];
    const segments = slice?.segments || [];
    if (!segments.length) continue;

    // Collect aircraft codes across the outbound slice
    const codes = segments
      .map(seg => seg.aircraft?.iata_code)
      .filter(Boolean);

    if (!codes.some(c => familyCodes.has(c))) continue;

    const firstSeg = segments[0];
    const lastSeg  = segments[segments.length - 1];
    const stops    = segments.length - 1;
    const duration = slice.duration || '';
    const price    = parseFloat(offer.total_amount || 0);
    const currency = offer.total_currency || 'EUR';

    // Pick the first family-matching code for display; prefer segment that has it
    const matchingSeg = segments.find(s => familyCodes.has(s.aircraft?.iata_code)) || firstSeg;
    const displayCode = matchingSeg.aircraft?.iata_code || codes[0];
    const aircraftName = matchingSeg.aircraft?.name || displayCode;
    const airline = firstSeg.marketing_carrier?.iata_code
      || firstSeg.operating_carrier?.iata_code
      || null;

    matching.push({
      offerId: offer.id,
      origin,
      destination: dest,
      price: price.toFixed(2),
      currency,
      departureTime: firstSeg.departing_at || null,
      arrivalTime:   lastSeg.arriving_at    || null,
      duration,
      stops,
      aircraftCode: displayCode,
      aircraftName,
      airline,
    });
  }

  if (!matching.length) return null;
  return matching.sort((a, b) => parseFloat(a.price) - parseFloat(b.price))[0];
}

// ── Main async generator ──────────────────────────────────────────────────────

/**
 * Search for flights by aircraft family.
 *
 * Yields SSE-style event objects:
 *   { event: 'progress', data: { phase, airports?, completed?, total? } }
 *   { event: 'result',   data: <flight object> }
 *   { event: 'done',     data: { total } }
 *   { event: 'error',    data: { message } }
 *
 * @param {{ familyName: string, city?: string, radius?: number, iata?: string, date: string, passengers?: number }} params
 */
async function* searchByAircraftFamily(params) {
  const { familyName, city, radius, iata, date, passengers = 1, nonStop = false } = params;

  // 1. Resolve family codes
  const familyCodes = getFamilyCodes(familyName);
  if (!familyCodes) {
    yield { event: 'error', data: { message: `Unknown aircraft family: ${familyName}` } };
    return;
  }

  // 2. Resolve origin airports
  const origins = resolveOrigins({ city, radius, iata });
  if (!origins.length) {
    yield { event: 'error', data: { message: city ? `No airports found near "${city}"` : 'No origin airport specified' } };
    return;
  }

  yield {
    event: 'progress',
    data: {
      phase: 'resolving_airports',
      airports: origins.map(a => ({ iata: a.iata, name: a.name, city: a.city, distanceKm: a.distanceKm })),
    },
  };

  // 3. Build (origin × destination) work list
  const pairs = [];
  for (const origin of origins) {
    const dests = getRelevantDestinations(familyName, origin);
    for (const dest of dests) {
      pairs.push({ origin, dest });
    }
  }

  const total = pairs.length;
  let completed = 0;
  let found = 0;

  // Provider selection: prefer Duffel when configured (Amadeus test env is sparse
  // on future dates and produces empty streams — see commit history). Fall back
  // to Amadeus per-pair on Duffel failure so a transient 4xx/rate-limit doesn't
  // kill the whole stream.
  const useDuffel = !!process.env.DUFFEL_API_KEY;
  console.log(
    useDuffel
      ? '[aircraft-search] using Duffel as primary'
      : '[aircraft-search] using Amadeus (Duffel not configured)'
  );

  yield { event: 'progress', data: { phase: 'searching', completed: 0, total } };

  // 4. Fan-out in batches
  for (let i = 0; i < pairs.length; i += BATCH_SIZE) {
    const batch = pairs.slice(i, i + BATCH_SIZE);

    const batchResults = await Promise.allSettled(
      batch.map(async ({ origin, dest }) => {
        const searchParams = {
          departure_airport: origin.iata,
          arrival_airport:   dest.code,
          departure_date:    date,
          passengers,
          nonStop,
        };

        if (useDuffel) {
          const duffelKey = `raw:duffel:${origin.iata}:${dest.code}:${date}:${passengers}:${nonStop ? '1' : '0'}:`;
          try {
            const { data: raw } = await cacheService.getOrFetch(duffelKey, () =>
              duffelService.searchFlights(searchParams)
            );
            const best = extractBestFlightDuffel(raw, familyCodes, origin.iata, dest.code);
            if (best) return best;
            // If Duffel returned no family-matching offers, try Amadeus as fallback
            // (Duffel's coverage for some carriers/routes is narrower than Amadeus).
          } catch {
            // swallow — fall through to Amadeus
          }
        }

        const amadeusKey = `raw:amadeus:${origin.iata}:${dest.code}:${date}:${passengers}:${nonStop ? '1' : '0'}:`;
        try {
          const { data: raw } = await cacheService.getOrFetch(amadeusKey, () =>
            amadeusService.searchFlights(searchParams)
          );
          return extractBestFlight(raw, familyCodes, origin.iata, dest.code);
        } catch {
          return null;
        }
      })
    );

    for (const result of batchResults) {
      if (result.status === 'fulfilled' && result.value) {
        found++;
        yield { event: 'result', data: result.value };
      }
    }

    completed += batch.length;
    yield { event: 'progress', data: { phase: 'searching', completed, total } };

    if (i + BATCH_SIZE < pairs.length) await delay(BATCH_DELAY);
  }

  yield { event: 'done', data: { total: found } };
}

module.exports = { searchByAircraftFamily };
