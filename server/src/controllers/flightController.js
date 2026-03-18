const aircraftData = require('../models/aircraftData');
const popularDestinations = require('../models/popularDestinations');
const airlabsService = require('../services/airlabsService');
const amadeusService = require('../services/amadeusService');
const duffelService = require('../services/duffelService');
const cacheService = require('../services/cacheService');
const openFlights = require('../services/openFlightsService');

const FLIGHT_API = process.env.FLIGHT_API || 'amadeus'; // 'amadeus' | 'duffel'

/**
 * Search flights with real API (Amadeus) or fallback to mock data
 */
exports.searchFlights = async (req, res) => {
  // Use validated + normalised values set by validate.searchQuery middleware
  const vq = req.validatedQuery || {};
  const departure    = vq.departure    || req.query.departure?.toUpperCase();
  const arrival      = vq.arrival      || req.query.arrival?.toUpperCase();
  const date         = vq.date         || req.query.date;
  const returnDate   = vq.returnDate   || req.query.returnDate;
  const aircraftType = vq.aircraftType || req.query.aircraftType;
  const aircraftModel = vq.aircraftModel || req.query.aircraftModel;
  const passengers   = vq.passengers   || parseInt(req.query.passengers, 10) || 1;
  const { useMockData, api } = req.query;

  // Allow per-request API override unless explicitly locked via LOCK_FLIGHT_API=true
  const activeApi = (process.env.LOCK_FLIGHT_API !== 'true' && api) ? api : FLIGHT_API;

  try {
    let flights = [];
    let useRealAPI = process.env.AMADEUS_CLIENT_ID && process.env.AMADEUS_CLIENT_SECRET && useMockData !== 'true';

    if (useRealAPI) {
      const searchParams = {
        departure_airport: departure || 'LIS',
        arrival_airport:   arrival   || 'NYC',
        departure_date:    date      || getNextDate(),
        passengers,
        return_date: returnDate || null,
      };

      // Use pre-sanitised cache key if available, else build from normalised values
      const cacheKey = `flights:${activeApi}:${vq.sanitisedCacheKey || `${searchParams.departure_airport}:${searchParams.arrival_airport}:${searchParams.departure_date}:${passengers}:${returnDate || ''}`}`;

      try {
        const { data: cachedFlights, fromCache } = await cacheService.getOrFetch(cacheKey, async () => {
          if (activeApi === 'duffel' && process.env.DUFFEL_API_KEY) {
            console.log('Using Duffel API');
            const duffelResponse = await duffelService.searchFlights(searchParams);
            return formatDuffelFlights(duffelResponse);
          } else {
            console.log(`Using Amadeus API (activeApi=${activeApi})`);
            const amadeusResponse = await amadeusService.searchFlights(searchParams);
            const result = formatAmadeusFlights(amadeusResponse);

            const aircraftIatas = extractAircraftIatas(amadeusResponse);
            await enrichWithAircraftData(result, aircraftIatas);

            const airlineIatas = extractAirlineIatas(amadeusResponse);
            await enrichWithAirlineData(result, airlineIatas);

            return result.filter(f => f.isValidRoute !== false);
          }
        });

        flights = cachedFlights;
        if (fromCache) console.log(`[cache] Serving ${flights.length} flights from cache`);
      } catch (error) {
        console.error(`${activeApi} API error, falling back to mock data:`, error.message, JSON.stringify(error?.response?.result || error?.response?.data || error));
        flights = getMockFlights(departure, arrival);
      }
    } else {
      // Use mock data
      flights = getMockFlights(departure, arrival);
    }

    // Safety guard — should always be array, but protect against unexpected cache/API results
    if (!Array.isArray(flights)) {
      console.error('[searchFlights] flights is not an array:', typeof flights, JSON.stringify(flights)?.slice(0, 200));
      flights = [];
    }

    // Apply filters
    if (aircraftType) {
      flights = flights.filter(f => {
        const aircraft = f.aircraft || aircraftData[f.aircraftCode];
        return aircraft && aircraft.type === aircraftType.toLowerCase();
      });
    }

    if (aircraftModel) {
      flights = flights.filter(f => f.aircraftCode === aircraftModel.toUpperCase());
    }

    res.json({
      success: true,
      count: flights.length,
      source: useRealAPI ? activeApi : 'mock',
      data: flights
    });
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({
      success: false,
      message: 'Error searching flights',
      error: error.message
    });
  }
};

/**
 * Get filter options including live aircraft data
 */
exports.getFilterOptions = async (req, res) => {
  try {
    const hasAirlabsKey = process.env.AIRLABS_API_KEY && process.env.AIRLABS_API_KEY !== 'your_airlabs_api_key_here';

    const allCities = [
      { code: 'LIS', name: 'Lisbon' },
      { code: 'NYC', name: 'New York' },
      { code: 'JFK', name: 'New York (JFK)' },
      { code: 'LON', name: 'London' },
      { code: 'CDG', name: 'Paris' },
      { code: 'AMS', name: 'Amsterdam' },
      { code: 'FRA', name: 'Frankfurt' },
      // Spanish cities
      { code: 'MAD', name: 'Madrid' },
      { code: 'BCN', name: 'Barcelona' },
      // German cities
      { code: 'BER', name: 'Berlin' },
      { code: 'MUC', name: 'Munich' },
      // Italian (optional) or other countries could be added here
    ];

    const allAircraftTypes = ['turboprop', 'jet', 'regional', 'wide-body'];
    
    let allAircraft = Object.entries(aircraftData).map(([code, data]) => ({
      code,
      ...data
    }));

    // If AirLabs API is configured, fetch live data for popular aircraft
    if (hasAirlabsKey) {
      const popularIatas = ['B737', 'A320', 'B777', 'A380', 'CRJ7', 'Q400'];
      const liveData = await airlabsService.getMultipleAircraft(popularIatas);
      
      // Merge live data with mock data
      allAircraft = allAircraft.map(aircraft => ({
        ...aircraft,
        ...liveData[aircraft.code]
      }));
    }

    res.json({
      cities: allCities,
      aircraftTypes: allAircraftTypes,
      aircraft: allAircraft,
      apiStatus: {
        amadeus: !!(process.env.AMADEUS_CLIENT_ID && process.env.AMADEUS_CLIENT_SECRET),
        airlabs: hasAirlabsKey
      }
    });
  } catch (error) {
    console.error('Filter options error:', error);
    res.json({
      cities: [
        { code: 'LIS', name: 'Lisbon' },
        { code: 'NYC', name: 'New York' },
        { code: 'LON', name: 'London' },
        { code: 'LAX', name: 'Los Angeles' }
      ],
      aircraftTypes: ['turboprop', 'jet', 'regional', 'wide-body'],
      aircraft: Object.entries(aircraftData).map(([code, data]) => ({
        code,
        ...data
      })),
      apiStatus: {
        amadeus: false,
        airlabs: false
      }
    });
  }
};

/**
 * Explore destinations reachable on a specific aircraft type/model
 * GET /api/flights/explore?departure=LIS&date=2026-03-15&aircraftType=wide-body&aircraftModel=789
 */
exports.exploreDestinations = async (req, res) => {
  // Use validated + normalised values from validate.exploreQuery middleware
  const vq = req.validatedQuery || {};
  const departure    = vq.departure    || req.query.departure?.toUpperCase();
  const date         = vq.date         || req.query.date;
  const aircraftType = vq.aircraftType || req.query.aircraftType;
  const aircraftModel = vq.aircraftModel || req.query.aircraftModel;

  if (!departure) {
    return res.status(400).json({ success: false, message: 'departure is required' });
  }

  const depCode    = departure;
  const searchDate = date || getNextDate();

  // Use pre-sanitised cache key
  const exploreCacheKey = `explore:${vq.sanitisedCacheKey || `${depCode}:${searchDate}:${aircraftType || ''}:${aircraftModel || ''}`}`;
  const cachedExplore = cacheService.get(exploreCacheKey);
  if (cachedExplore) {
    return res.json({ success: true, count: cachedExplore.length, data: cachedExplore, fromCache: true });
  }

  // Filter out the departure airport itself
  const candidates = popularDestinations.filter(d => d.code !== depCode);

  const delay = ms => new Promise(r => setTimeout(r, ms));

  const results = [];
  const BATCH_SIZE = 4;

  for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
    const batch = candidates.slice(i, i + BATCH_SIZE);

    const batchResults = await Promise.allSettled(
      batch.map(async (dest) => {
        const segCacheKey = `flights:amadeus:${depCode}:${dest.code}:${searchDate}:1:`;
        try {
          const { data: raw } = await cacheService.getOrFetch(segCacheKey, () => amadeusService.searchFlights({
            departure_airport: depCode,
            arrival_airport: dest.code,
            departure_date: searchDate,
            passengers: 1,
          }));

          const flights = formatAmadeusFlights(raw);
          if (!flights.length) return null;

          // Enrich aircraft data
          await enrichWithAircraftData(flights, []);

          // Filter by aircraft criteria
          const matching = flights.filter(f => {
            if (aircraftModel) return f.aircraftCode === aircraftModel.toUpperCase();
            if (aircraftType) return f.aircraft?.type === aircraftType.toLowerCase();
            return true;
          });

          if (!matching.length) return null;

          // Return cheapest matching flight
          const best = matching.sort((a, b) => parseFloat(a.price) - parseFloat(b.price))[0];

          return {
            destination: dest,
            price: best.price,
            currency: best.currency,
            duration: best.duration,
            stops: best.stops ?? 0,
            airline: best.airline,
            aircraftCode: best.aircraftCode,
            aircraftName: best.aircraft?.name || best.aircraftCode,
            aircraftType: best.aircraft?.type || 'jet',
            departureTime: best.departureTime,
            arrivalTime: best.arrivalTime,
          };
        } catch {
          return null;
        }
      })
    );

    batchResults.forEach(r => {
      if (r.status === 'fulfilled' && r.value) results.push(r.value);
    });

    // Small pause between batches to respect API rate limits
    if (i + BATCH_SIZE < candidates.length) await delay(200);
  }

  cacheService.set(exploreCacheKey, results, cacheService.TTL.explore);
  res.json({ success: true, count: results.length, data: results });
};

/**
 * Build a normalized itinerary object from an Amadeus itinerary + dictionaries
 */
function buildItinerary(itinerary, carriers, aircraftDict) {
  if (!itinerary) return null;
  const segments = itinerary.segments || [];
  if (segments.length === 0) return null;

  const first = segments[0];
  const last = segments[segments.length - 1];

  const depAirport = openFlights.getAirport(first.departure.iataCode);
  const arrAirport = openFlights.getAirport(last.arrival.iataCode);

  return {
    departure: { code: first.departure.iataCode, terminal: first.departure.terminal || null, city: depAirport?.city || null, country: depAirport?.country || null },
    arrival:   { code: last.arrival.iataCode,    terminal: last.arrival.terminal    || null, city: arrAirport?.city || null, country: arrAirport?.country || null },
    departureTime: first.departure.at,
    arrivalTime: last.arrival.at,
    duration: amadeusService.parseDuration(itinerary.duration),
    stops: segments.length - 1,
    stopAirports: segments.slice(0, -1).map(s => s.arrival.iataCode),
    aircraftCode: first.aircraft?.code || 'N/A',
    aircraftName: aircraftDict[first.aircraft?.code] || first.aircraft?.code || 'N/A',
    airline: carriers[first.carrierCode] || openFlights.getAirline(first.carrierCode)?.name || first.carrierCode,
    airlineIata: first.carrierCode,
    flightNumber: `${first.carrierCode}${first.number}`,
    segments: segments.map(s => ({
      departure: { code: s.departure.iataCode, time: s.departure.at, city: openFlights.getAirport(s.departure.iataCode)?.city || null },
      arrival:   { code: s.arrival.iataCode,   time: s.arrival.at,   city: openFlights.getAirport(s.arrival.iataCode)?.city   || null },
      airline: carriers[s.carrierCode] || openFlights.getAirline(s.carrierCode)?.name || s.carrierCode,
      airlineIata: s.carrierCode,
      flightNumber: `${s.carrierCode}${s.number}`,
      aircraftCode: s.aircraft?.code || 'N/A',
      aircraftName: aircraftDict[s.aircraft?.code] || s.aircraft?.code || 'N/A',
      duration: amadeusService.parseDuration(s.duration),
    })),
  };
}

/**
 * Helper: Format Duffel API response to normalized shape
 * Duffel structure: { data: { offers: [...] } }
 * Each offer has slices[] → segments[]
 */
function formatDuffelFlights(duffelResponse) {
  const offers = duffelResponse?.data?.offers || duffelResponse?.offers || [];

  return offers.map((offer, index) => {
    const slices = offer.slices || [];
    if (!slices.length) return null;

    const buildSlice = (slice) => {
      const segments = slice.segments || [];
      if (!segments.length) return null;
      const first = segments[0];
      const last = segments[segments.length - 1];

      return {
        departure: { code: first.origin?.iata_code, terminal: first.origin_terminal || null },
        arrival: { code: last.destination?.iata_code, terminal: last.destination_terminal || null },
        departureTime: first.departing_at,
        arrivalTime: last.arriving_at,
        duration: slice.duration || null,
        stops: segments.length - 1,
        stopAirports: segments.slice(0, -1).map(s => s.destination?.iata_code),
        aircraftCode: first.aircraft?.iata_code || 'N/A',
        aircraftName: first.aircraft?.name || first.aircraft?.iata_code || 'N/A',
        airline: first.marketing_carrier?.name || first.operating_carrier?.name || 'Unknown',
        airlineIata: first.marketing_carrier?.iata_code || '',
        flightNumber: `${first.marketing_carrier?.iata_code || ''}${first.marketing_carrier_flight_number || ''}`,
        segments: segments.map(s => ({
          departure: { code: s.origin?.iata_code, time: s.departing_at },
          arrival: { code: s.destination?.iata_code, time: s.arriving_at },
          airline: s.marketing_carrier?.name || s.operating_carrier?.name || 'Unknown',
          airlineIata: s.marketing_carrier?.iata_code || '',
          flightNumber: `${s.marketing_carrier?.iata_code || ''}${s.marketing_carrier_flight_number || ''}`,
          aircraftCode: s.aircraft?.iata_code || 'N/A',
          aircraftName: s.aircraft?.name || s.aircraft?.iata_code || 'N/A',
          duration: s.duration || null,
        })),
      };
    };

    const outbound = buildSlice(slices[0]);
    if (!outbound) return null;
    const returnSlice = slices[1] ? buildSlice(slices[1]) : null;

    // Enrich with local aircraft data
    outbound.aircraft = aircraftData[outbound.aircraftCode] || classifyAircraftByCode(outbound.aircraftCode);
    outbound.segments.forEach(s => {
      s.aircraft = aircraftData[s.aircraftCode] || classifyAircraftByCode(s.aircraftCode);
    });

    return {
      id: `duffel_${index}`,
      offerId: offer.id,
      passengerIds: (offer.passengers || []).map(p => p.id),
      departure: outbound.departure,
      arrival: outbound.arrival,
      aircraftCode: outbound.aircraftCode,
      aircraftName: outbound.aircraftName,
      aircraft: outbound.aircraft,
      airline: outbound.airline,
      airlineIata: outbound.airlineIata,
      flightNumber: outbound.flightNumber,
      departureTime: outbound.departureTime,
      arrivalTime: outbound.arrivalTime,
      duration: outbound.duration,
      stops: outbound.stops,
      stopAirports: outbound.stopAirports,
      segments: outbound.segments,
      price: offer.total_amount,
      currency: offer.total_currency || 'EUR',
      isRoundTrip: !!returnSlice,
      returnItinerary: returnSlice,
      source: 'duffel',
    };
  }).filter(Boolean);
}

/**
 * Helper: Format Amadeus API response
 * Amadeus structure: { data: [...offers], dictionaries: { carriers, aircraft, locations } }
 */
function formatAmadeusFlights(amadeusResponse) {
  const offers = amadeusResponse.data || [];
  const carriers = amadeusResponse.dictionaries?.carriers || {};
  const aircraftDict = amadeusResponse.dictionaries?.aircraft || {};

  return offers.map((offer, index) => {
    const outbound = buildItinerary(offer.itineraries?.[0], carriers, aircraftDict);
    if (!outbound) return null;

    const returnItin = offer.itineraries?.[1]
      ? buildItinerary(offer.itineraries[1], carriers, aircraftDict)
      : null;

    return {
      id: `amadeus_${index}`,
      departure: outbound.departure,
      arrival: outbound.arrival,
      aircraftCode: outbound.aircraftCode,
      aircraftName: outbound.aircraftName,
      airline: outbound.airline,
      airlineIata: outbound.airlineIata,
      flightNumber: outbound.flightNumber,
      departureTime: outbound.departureTime,
      arrivalTime: outbound.arrivalTime,
      duration: outbound.duration,
      stops: outbound.stops,
      stopAirports: outbound.stopAirports,
      segments: outbound.segments,
      price: offer.price?.total,
      currency: offer.price?.currency || 'EUR',
      isRoundTrip: !!returnItin,
      returnItinerary: returnItin,
      source: 'amadeus'
    };
  }).filter(Boolean);
}

/**
 * Helper: Extract aircraft IATA codes from Amadeus response
 */
function extractAircraftIatas(amadeusResponse) {
  const iatas = new Set();
  (amadeusResponse.data || []).forEach(offer => {
    offer.itineraries?.forEach(itin => {
      itin.segments?.forEach(seg => {
        if (seg.aircraft?.code) iatas.add(seg.aircraft.code);
      });
    });
  });
  return Array.from(iatas);
}

/**
 * Helper: Extract airline IATA codes from Amadeus response
 */
function extractAirlineIatas(amadeusResponse) {
  const iatas = new Set();
  (amadeusResponse.data || []).forEach(offer => {
    offer.itineraries?.forEach(itin => {
      itin.segments?.forEach(seg => {
        if (seg.carrierCode) iatas.add(seg.carrierCode);
        if (seg.operating?.carrierCode) iatas.add(seg.operating.carrierCode);
      });
    });
  });
  return Array.from(iatas);
}

/**
 * Helper: Validate if the route is valid for the airline
 */
function validateRoute(departureCode, arrivalCode, airlineCountry) {
  const depCountry = openFlights.getCountry(departureCode) || 'Unknown';
  const arrCountry = openFlights.getCountry(arrivalCode) || 'Unknown';

  if (airlineCountry === 'United Kingdom') {
    return depCountry === 'United Kingdom' || arrCountry === 'United Kingdom';
  }
  return true;
}

/**
 * Helper: Enrich flights with airline data from AirLabs
 */
async function enrichWithAirlineData(flights, airlineIatas) {
  const hasAirlabsKey = process.env.AIRLABS_API_KEY && process.env.AIRLABS_API_KEY !== 'your_airlabs_api_key_here';

  if (!hasAirlabsKey || airlineIatas.length === 0) return;

  try {
    const liveData = await airlabsService.getMultipleAirlines(airlineIatas);
    flights.forEach(flight => {
      // Assuming we add airlineIata to flight object
      const iata = flight.airlineIata;
      if (liveData[iata]) {
        flight.airlineCountry = liveData[iata].country;
        flight.airlineIcao = liveData[iata].icao;
        flight.isValidRoute = validateRoute(flight.departure.code, flight.arrival.code, liveData[iata].country);
      } else {
        flight.isValidRoute = true; // Default to true if no data
      }
    });
  } catch (error) {
    console.warn('AirLabs airline enrichment failed:', error.message);
    flights.forEach(flight => flight.isValidRoute = true);
  }
}

/**
 * Helper: Enrich flights with aircraft data from AirLabs
 */
async function enrichWithAircraftData(flights, aircraftIatas) {
  const hasAirlabsKey = process.env.AIRLABS_API_KEY && process.env.AIRLABS_API_KEY !== 'your_airlabs_api_key_here';

  const resolveAircraft = (code) => aircraftData[code] || classifyAircraftByCode(code);

  flights.forEach(flight => {
    flight.aircraft = resolveAircraft(flight.aircraftCode);

    // Enrich each segment with aircraft data
    const enrichSegments = (segments) => {
      (segments || []).forEach(seg => {
        seg.aircraft = resolveAircraft(seg.aircraftCode);
      });
    };
    enrichSegments(flight.segments);
    enrichSegments(flight.returnItinerary?.segments);
  });

  // If AirLabs is available, try to fetch live data for unknown aircraft
  if (hasAirlabsKey && aircraftIatas.length > 0) {
    try {
      const liveData = await airlabsService.getMultipleAircraft(aircraftIatas);
      flights.forEach(flight => {
        const applyLive = (code, target) => {
          if (!aircraftData[code] && liveData[code]) target.aircraft = liveData[code];
        };
        applyLive(flight.aircraftCode, flight);
        (flight.segments || []).forEach(seg => applyLive(seg.aircraftCode, seg));
        (flight.returnItinerary?.segments || []).forEach(seg => applyLive(seg.aircraftCode, seg));
      });
    } catch (error) {
      console.warn('AirLabs enrichment failed, using local data:', error.message);
    }
  }
}

/**
 * Helper: Classify aircraft by code using known mappings
 */
function classifyAircraftByCode(code) {
  if (!code || code === 'N/A' || code === 'null') {
    return { name: 'Unknown Aircraft', type: 'unknown', capacity: null, range: null, cruiseSpeed: null };
  }

  const upperCode = code.toUpperCase();

  // Common narrow-body jets (737, 320, 757, 767, etc.)
  const narrowBodyMap = {
    '320': { name: 'Airbus A320', type: 'jet', cap: 160, range: 5500, speed: 460 },
    '321': { name: 'Airbus A321', type: 'jet', cap: 220, range: 5500, speed: 460 },
    '32A': { name: 'Airbus A320', type: 'jet', cap: 160, range: 5500, speed: 460 },
    '32B': { name: 'Airbus A320', type: 'jet', cap: 160, range: 5500, speed: 460 },
    '32N': { name: 'Airbus A320neo', type: 'jet', cap: 160, range: 6300, speed: 460 },
    '32Q': { name: 'Airbus A320neo', type: 'jet', cap: 160, range: 6300, speed: 460 },
    '737': { name: 'Boeing 737', type: 'jet', cap: 160, range: 5200, speed: 460 },
    '738': { name: 'Boeing 737-800', type: 'jet', cap: 189, range: 5200, speed: 460 },
    '739': { name: 'Boeing 737-900', type: 'jet', cap: 189, range: 5200, speed: 460 },
    '73J': { name: 'Boeing 737-900ER', type: 'jet', cap: 189, range: 5200, speed: 460 },
    '73H': { name: 'Boeing 737-800', type: 'jet', cap: 189, range: 5200, speed: 460 },
    '73G': { name: 'Boeing 737-700', type: 'jet', cap: 149, range: 5000, speed: 460 },
    '752': { name: 'Boeing 757-200', type: 'jet', cap: 185, range: 7500, speed: 470 },
    '753': { name: 'Boeing 757-300', type: 'jet', cap: 280, range: 7500, speed: 470 }
  };

  if (narrowBodyMap[upperCode]) {
    const data = narrowBodyMap[upperCode];
    return { name: data.name, type: data.type, capacity: data.cap, range: data.range, cruiseSpeed: data.speed };
  }

  // Check if it matches any narrow-body pattern
  const narrowBodyPatterns = ['320', '321', '737', '738', '739', '752', '753'];
  if (narrowBodyPatterns.some(p => upperCode.includes(p))) {
    return { name: 'Narrow-body Jet', type: 'jet', capacity: 160, range: 5500, cruiseSpeed: 460 };
  }

  // Wide-body jets (777, 787, 350, 330, etc.)
  const wideBodyMap = {
    '777': { name: 'Boeing 777', type: 'wide-body', cap: 350, range: 7000, speed: 490 },
    '778': { name: 'Boeing 777-800', type: 'wide-body', cap: 350, range: 7000, speed: 490 },
    '779': { name: 'Boeing 777-900', type: 'wide-body', cap: 400, range: 7000, speed: 490 },
    '787': { name: 'Boeing 787 Dreamliner', type: 'wide-body', cap: 250, range: 8000, speed: 490 },
    '350': { name: 'Airbus A350', type: 'wide-body', cap: 315, range: 8000, speed: 490 },
    '330': { name: 'Airbus A330', type: 'wide-body', cap: 300, range: 7400, speed: 490 },
    '340': { name: 'Airbus A340', type: 'wide-body', cap: 300, range: 9000, speed: 490 },
    '380': { name: 'Airbus A380', type: 'wide-body', cap: 560, range: 8000, speed: 490 },
    '747': { name: 'Boeing 747', type: 'wide-body', cap: 500, range: 7000, speed: 490 }
  };

  if (wideBodyMap[upperCode]) {
    const data = wideBodyMap[upperCode];
    return { name: data.name, type: data.type, capacity: data.cap, range: data.range, cruiseSpeed: data.speed };
  }

  // Check if it matches any wide-body pattern
  const wideBodyPatterns = ['777', '787', '350', '330', '340', '380', '747'];
  if (wideBodyPatterns.some(p => upperCode.includes(p))) {
    return { name: 'Wide-body Jet', type: 'wide-body', capacity: 300, range: 7000, cruiseSpeed: 490 };
  }

  // Regional jets (CRJ, ERJ, DHC, etc.)
  if (upperCode.match(/^(CRJ|ERJ|E\d|DH\d|Q4)/)) {
    return { name: 'Regional Jet', type: 'regional', capacity: 70, range: 3500, cruiseSpeed: 450 };
  }

  // Turboprops (ATR, Q4, DHC, etc.)
  if (upperCode.match(/^(ATR|Q4|DH\d)/)) {
    return { name: 'Turboprop', type: 'turboprop', capacity: 50, range: 2000, cruiseSpeed: 300 };
  }

  // Airline codes - assign based on common fleets (fallback)
  // Most airlines operate a mix of jets
  return {
    name: `Aircraft (${upperCode})`,
    type: 'jet',  // Default to jet for unknown airline codes
    capacity: 160,
    range: 5000,
    cruiseSpeed: 460
  };
}

/**
 * Helper: Get mock flights for testing
 */
function getMockFlights(departure, arrival) {
  const mockFlights = [
    {
      id: 1,
      departure: { code: 'LIS', city: 'Lisbon' },
      arrival: { code: 'NYC', city: 'New York' },
      aircraftCode: 'B737',
      airline: 'TAP Air Portugal',
      flightNumber: 'TP123',
      departureTime: '2026-03-15T10:00:00Z',
      arrivalTime: '2026-03-15T14:30:00Z',
      price: 450,
      currency: 'USD',
      duration: '7h 30m',
      source: 'mock'
    },
    {
      id: 2,
      departure: { code: 'LIS', city: 'Lisbon' },
      arrival: { code: 'NYC', city: 'New York' },
      aircraftCode: 'A320',
      airline: 'United Airlines',
      departureTime: '2026-03-15T12:00:00Z',
      arrivalTime: '2026-03-15T16:45:00Z',
      price: 520,
      currency: 'USD',
      duration: '7h 45m',
      source: 'mock'
    },
    {
      id: 3,
      departure: { code: 'LIS', city: 'Lisbon' },
      arrival: { code: 'NYC', city: 'New York' },
      aircraftCode: '789',
      airline: 'Delta Air Lines',
      flightNumber: 'DL201',
      departureTime: '2026-03-15T14:00:00Z',
      arrivalTime: '2026-03-15T22:30:00Z',
      price: 490,
      currency: 'USD',
      duration: '8h 30m',
      source: 'mock'
    },
    {
      id: 4,
      departure: { code: 'LIS', city: 'Lisbon' },
      arrival: { code: 'NYC', city: 'New York' },
      aircraftCode: '333',
      airline: 'Iberia',
      flightNumber: 'IB6253',
      departureTime: '2026-03-16T09:00:00Z',
      arrivalTime: '2026-03-16T17:45:00Z',
      price: 410,
      currency: 'USD',
      duration: '8h 45m',
      source: 'mock'
    },
    {
      id: 5,
      departure: { code: 'MAD', city: 'Madrid' },
      arrival: { code: 'BCN', city: 'Barcelona' },
      aircraftCode: 'A320',
      airline: 'Iberia',
      departureTime: '2026-04-01T08:00:00Z',
      arrivalTime: '2026-04-01T09:30:00Z',
      price: 120,
      currency: 'EUR',
      duration: '1h 30m',
      source: 'mock'
    },
    {
      id: 6,
      departure: { code: 'BER', city: 'Berlin' },
      arrival: { code: 'MUC', city: 'Munich' },
      aircraftCode: 'B737',
      airline: 'Lufthansa',
      departureTime: '2026-04-02T10:00:00Z',
      arrivalTime: '2026-04-02T11:15:00Z',
      price: 95,
      currency: 'EUR',
      duration: '1h 15m',
      source: 'mock'
    }
  ];

  let results = mockFlights;

  if (departure) {
    results = results.filter(f => f.departure.code === departure.toUpperCase());
  }

  if (arrival) {
    results = results.filter(f => f.arrival.code === arrival.toUpperCase());
  }

  // Enrich with aircraft info
  results = results.map(flight => ({
    ...flight,
    aircraft: aircraftData[flight.aircraftCode] || { name: 'Unknown' }
  }));

  return results;
}

/**
 * POST /api/flights/book
 * Book a Duffel offer and return order confirmation
 */
exports.bookFlight = async (req, res) => {
  // Input is pre-validated by validate.bookBody middleware
  const { offerId, passengerIds, passengerInfo, currency = 'EUR', totalAmount } = req.body;

  if (!process.env.DUFFEL_API_KEY) {
    return res.status(503).json({ success: false, message: 'Booking is not available at this time' });
  }

  try {
    const passengers = (passengerIds || []).map((pid, i) => {
      const p = passengerInfo[i] || passengerInfo[0];
      const passenger = {
        id:           pid,
        title:        (p.title || 'mr').toLowerCase(),
        given_name:   p.firstName.trim(),
        family_name:  p.lastName.trim(),
        born_on:      p.dateOfBirth,
        email:        p.email.toLowerCase().trim(),
        gender:       p.gender,
        type:         'adult',
      };
      // Only include phone if provided and non-empty
      if (p.phone && p.phone.trim().length >= 7) {
        passenger.phone_number = p.phone.trim();
      }
      return passenger;
    });

    const orderData = {
      selected_offers: [offerId],
      passengers,
      payments: [{ type: 'balance', amount: String(totalAmount), currency }],
    };

    const result = await duffelService.createOrder(orderData);
    const order  = result.data;

    res.json({
      success: true,
      data: {
        orderId:          order.id,
        bookingReference: order.booking_reference,
        status: order.payment_status?.awaiting_payment ? 'awaiting_payment' : 'confirmed',
        documents: order.documents || [],
      },
    });
  } catch (error) {
    console.error('Booking error:', error.message);
    // Return a safe message — don't forward raw Duffel errors
    const IS_DEV = process.env.NODE_ENV !== 'production';
    res.status(500).json({
      success: false,
      message: IS_DEV ? error.message : 'Booking failed. Please try again or contact support.',
    });
  }
};

/**
 * Helper: Get next available date (next day)
 */
function getNextDate() {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return tomorrow.toISOString().split('T')[0];
}
