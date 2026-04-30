const aircraftData = require('../models/aircraftData');
const popularDestinations = require('../models/popularDestinations');
const airlabsService = require('../services/airlabsService');
const amadeusService = require('../services/amadeusService');
const duffelService = require('../services/duffelService');
const cacheService = require('../services/cacheService');
const openFlights = require('../services/openFlightsService');
const travelpayoutsService = require('../services/travelpayoutsService');
const aerodataboxService = require('../services/aerodataboxService');
const flightSearchOrchestrator = require('../services/flightSearchOrchestrator');
const { resolveFamily } = require('../models/aircraftFamilies');

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
  const familyName   = vq.familyName   || req.query.familyName;
  const passengers   = vq.passengers   || parseInt(req.query.passengers, 10) || 1;
  const directOnly   = vq.directOnly   === true;
  const { useMockData } = req.query;

  // Note: ?api= override removed — orchestrator owns the source chain.
  // FLIGHT_API / LOCK_FLIGHT_API still consumed by the Explore handler below.

  try {
    // Single owner of the cache + fallback chain (google → ita → travelpayouts → stale-cache).
    // Returns { flights: NormalizedFlight[], source: 'cache'|'google'|'ita'|'travelpayouts'|'stale-cache'|'none' }.
    // useMockData=true is honoured as an explicit override for local debugging.
    let flights;
    let sourceLabel;
    if (useMockData === 'true') {
      flights = getMockFlights(departure, arrival);
      sourceLabel = 'mock';
    } else {
      const orch = await flightSearchOrchestrator.search({
        departure, arrival, date, returnDate, passengers,
      });
      flights = orch.flights;
      sourceLabel = orch.source;
    }

    // Safety guard — should always be array, but protect against unexpected cache/API results
    if (!Array.isArray(flights)) {
      console.error('[searchFlights] flights is not an array:', typeof flights, JSON.stringify(flights)?.slice(0, 200));
      flights = [];
    }

    // Aircraft filter compatibility note: googleFlightsService stores the
    // human-readable aircraft string in aircraftCode (e.g. "Boeing 787-9"),
    // so an aircraftType/aircraftModel filter keyed on IATA codes ("789") will
    // reject all Google-sourced flights. Existing TP/Duffel sources still
    // produce IATA codes here, so the filter remains useful for those. Future
    // work: normalize aircraft identifiers in the upstream parsers.
    if (aircraftType) {
      const wantedType = aircraftType.toLowerCase();
      flights = flights.filter(f => {
        // 1. IATA-keyed lookup (Amadeus/Duffel/TP path — code is "789", "77W", etc.)
        const ac = f.aircraft || aircraftData[f.aircraftCode];
        if (ac && ac.type === wantedType) return true;
        // 2. Human-readable fallback for Google-source ("Boeing 787-9", "Airbus A380").
        // classifyAircraftByCode does substring matching (e.g. "BOEING 787".includes('787')).
        const code = String(f.aircraftCode || '');
        if (!code || code === 'N/A') return false;
        const classified = classifyAircraftByCode(code);
        return classified && classified.type === wantedType;
      });
    }

    if (aircraftModel) {
      const wanted = aircraftModel.toUpperCase();
      flights = flights.filter(f => {
        const code = String(f.aircraftCode || '').toUpperCase();
        // ITA/Travelpayouts emit 'N/A' as a placeholder when aircraft is unknown;
        // never let a placeholder satisfy a model filter (a permissive substring
        // would otherwise match e.g. wanted="N" or "NA" and leak placeholder rows).
        if (!code || code === 'N/A') return false;
        if (code === wanted) return true;
        // Substring fallback covers Google-source human-readable codes
        // (e.g. "BOEING 787-9" matches wanted="789"). Restricted to ≥3-char
        // queries against codes that look human-readable (contain space or hyphen)
        // so short queries never substring-match short IATA codes like "789".
        if (wanted.length >= 3 && /[\s-]/.test(code)) {
          return code.includes(wanted);
        }
        return false;
      });
    }

    // Family filter — accepts slug ("a380") or display name ("Airbus A380").
    // Match against fam.family.codes (full Set including IATA-style "320"/"32N"
    // and ICAO "A320"); Duffel/Amadeus aircraftCode is 3-char IATA, not 4-char ICAO.
    if (familyName) {
      const fam = resolveFamily(familyName);
      const codes = fam?.family?.codes;
      if (codes && codes.size) {
        const allowed = new Set([...codes].map(c => String(c).toUpperCase()));
        flights = flights.filter(f => {
          const code = (f.aircraftCode || '').toUpperCase();
          return code && allowed.has(code);
        });
      } else {
        flights = [];
      }
    }

    // Safety net: upstream filter parameters are honoured by Amadeus (nonStop)
    // and Duffel (slice.max_connections), but mock data and edge-case cached
    // results may still include connecting itineraries. Enforce the invariant.
    if (directOnly) {
      flights = flights.filter(f => (f.stops ?? 0) === 0);
    }

    if (sourceLabel === 'none') {
      console.warn(`[flights] no results across all sources for ${departure}->${arrival} ${date}`);
    }

    res.json({
      success: true,
      count: flights.length,
      source: sourceLabel,
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

    const cityGroups = [
      { region: 'Europe — West', cities: [
        { code: 'LIS', name: 'Lisbon' },
        { code: 'OPO', name: 'Porto' },
        { code: 'MAD', name: 'Madrid' },
        { code: 'BCN', name: 'Barcelona' },
        { code: 'AGP', name: 'Malaga' },
        { code: 'LON', name: 'London (LHR)' },
        { code: 'LGW', name: 'London (Gatwick)' },
        { code: 'STN', name: 'London (Stansted)' },
        { code: 'MAN', name: 'Manchester' },
        { code: 'EDI', name: 'Edinburgh' },
        { code: 'DUB', name: 'Dublin' },
        { code: 'CDG', name: 'Paris (CDG)' },
        { code: 'ORY', name: 'Paris (Orly)' },
        { code: 'NCE', name: 'Nice' },
        { code: 'MRS', name: 'Marseille' },
        { code: 'LYS', name: 'Lyon' },
        { code: 'AMS', name: 'Amsterdam' },
        { code: 'BRU', name: 'Brussels' },
        { code: 'FRA', name: 'Frankfurt' },
        { code: 'BER', name: 'Berlin' },
        { code: 'MUC', name: 'Munich' },
        { code: 'HAM', name: 'Hamburg' },
        { code: 'DUS', name: 'Dusseldorf' },
        { code: 'VIE', name: 'Vienna' },
        { code: 'ZUR', name: 'Zurich' },
        { code: 'GVA', name: 'Geneva' },
        { code: 'FCO', name: 'Rome' },
        { code: 'MXP', name: 'Milan' },
        { code: 'VCE', name: 'Venice' },
        { code: 'NAP', name: 'Naples' },
        { code: 'ATH', name: 'Athens' },
        { code: 'SKG', name: 'Thessaloniki' },
        { code: 'CPH', name: 'Copenhagen' },
        { code: 'ARN', name: 'Stockholm' },
        { code: 'OSL', name: 'Oslo' },
        { code: 'HEL', name: 'Helsinki' },
        { code: 'RVN', name: 'Rovaniemi' },
      ]},
      { region: 'Europe — East & Central', cities: [
        { code: 'PRG', name: 'Prague' },
        { code: 'WAW', name: 'Warsaw' },
        { code: 'KRK', name: 'Krakow' },
        { code: 'BUD', name: 'Budapest' },
        { code: 'BTS', name: 'Bratislava' },
        { code: 'LJU', name: 'Ljubljana' },
        { code: 'ZAG', name: 'Zagreb' },
        { code: 'SPU', name: 'Split' },
        { code: 'DBV', name: 'Dubrovnik' },
        { code: 'BEG', name: 'Belgrade' },
        { code: 'SOF', name: 'Sofia' },
        { code: 'OTP', name: 'Bucharest' },
        { code: 'KBP', name: 'Kyiv' },
        { code: 'TBS', name: 'Tbilisi' },
        { code: 'EVN', name: 'Yerevan' },
      ]},
      { region: 'Middle East & Turkey', cities: [
        { code: 'IST', name: 'Istanbul' },
        { code: 'SAW', name: 'Istanbul (Sabiha)' },
        { code: 'AYT', name: 'Antalya' },
        { code: 'DXB', name: 'Dubai' },
        { code: 'AUH', name: 'Abu Dhabi' },
        { code: 'DOH', name: 'Doha' },
        { code: 'AMM', name: 'Amman' },
        { code: 'BEY', name: 'Beirut' },
        { code: 'TLV', name: 'Tel Aviv' },
      ]},
      { region: 'Africa', cities: [
        { code: 'CAI', name: 'Cairo' },
        { code: 'CMN', name: 'Casablanca' },
        { code: 'RAK', name: 'Marrakech' },
        { code: 'TUN', name: 'Tunis' },
        { code: 'NBO', name: 'Nairobi' },
        { code: 'JNB', name: 'Johannesburg' },
        { code: 'CPT', name: 'Cape Town' },
        { code: 'LOS', name: 'Lagos' },
      ]},
      { region: 'North America', cities: [
        { code: 'JFK', name: 'New York (JFK)' },
        { code: 'EWR', name: 'New York (Newark)' },
        { code: 'LAX', name: 'Los Angeles' },
        { code: 'SFO', name: 'San Francisco' },
        { code: 'ORD', name: 'Chicago' },
        { code: 'MIA', name: 'Miami' },
        { code: 'BOS', name: 'Boston' },
        { code: 'IAD', name: 'Washington DC' },
        { code: 'SEA', name: 'Seattle' },
        { code: 'LAS', name: 'Las Vegas' },
        { code: 'YYZ', name: 'Toronto' },
        { code: 'YVR', name: 'Vancouver' },
        { code: 'YUL', name: 'Montreal' },
        { code: 'MEX', name: 'Mexico City' },
        { code: 'CUN', name: 'Cancun' },
      ]},
      { region: 'South America', cities: [
        { code: 'GRU', name: 'Sao Paulo' },
        { code: 'GIG', name: 'Rio de Janeiro' },
        { code: 'EZE', name: 'Buenos Aires' },
        { code: 'BOG', name: 'Bogota' },
        { code: 'LIM', name: 'Lima' },
        { code: 'SCL', name: 'Santiago' },
      ]},
      { region: 'Asia', cities: [
        { code: 'SIN', name: 'Singapore' },
        { code: 'BKK', name: 'Bangkok' },
        { code: 'HKT', name: 'Phuket' },
        { code: 'KUL', name: 'Kuala Lumpur' },
        { code: 'CGK', name: 'Jakarta' },
        { code: 'DPS', name: 'Bali' },
        { code: 'HKG', name: 'Hong Kong' },
        { code: 'TPE', name: 'Taipei' },
        { code: 'ICN', name: 'Seoul' },
        { code: 'NRT', name: 'Tokyo (Narita)' },
        { code: 'HND', name: 'Tokyo (Haneda)' },
        { code: 'KIX', name: 'Osaka' },
        { code: 'PEK', name: 'Beijing' },
        { code: 'PVG', name: 'Shanghai' },
        { code: 'CAN', name: 'Guangzhou' },
        { code: 'BOM', name: 'Mumbai' },
        { code: 'DEL', name: 'Delhi' },
        { code: 'BLR', name: 'Bangalore' },
        { code: 'MAA', name: 'Chennai' },
        { code: 'CMB', name: 'Colombo' },
        { code: 'MLE', name: 'Male (Maldives)' },
      ]},
      { region: 'Oceania', cities: [
        { code: 'SYD', name: 'Sydney' },
        { code: 'MEL', name: 'Melbourne' },
        { code: 'BNE', name: 'Brisbane' },
        { code: 'PER', name: 'Perth' },
        { code: 'AKL', name: 'Auckland' },
      ]},
    ];
    const allCities = cityGroups.flatMap(g => g.cities);

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

    // All major airlines (name matches what Duffel/Amadeus return as operating_carrier.name)
    const allAirlines = [
      { code: 'AA', name: 'American Airlines' },
      { code: 'AC', name: 'Air Canada' },
      { code: 'AF', name: 'Air France' },
      { code: 'AS', name: 'Alaska Airlines' },
      { code: 'AY', name: 'Finnair' },
      { code: 'AZ', name: 'ITA Airways' },
      { code: 'B6', name: 'JetBlue' },
      { code: 'BA', name: 'British Airways' },
      { code: 'CM', name: 'Copa Airlines' },
      { code: 'CX', name: 'Cathay Pacific' },
      { code: 'DL', name: 'Delta Air Lines' },
      { code: 'DY', name: 'Norwegian' },
      { code: 'EI', name: 'Aer Lingus' },
      { code: 'EK', name: 'Emirates' },
      { code: 'ET', name: 'Ethiopian Airlines' },
      { code: 'EW', name: 'Eurowings' },
      { code: 'EY', name: 'Etihad Airways' },
      { code: 'F9', name: 'Frontier Airlines' },
      { code: 'FR', name: 'Ryanair' },
      { code: 'GA', name: 'Garuda Indonesia' },
      { code: 'GF', name: 'Gulf Air' },
      { code: 'G3', name: 'Gol' },
      { code: 'HV', name: 'Transavia' },
      { code: 'IB', name: 'Iberia' },
      { code: 'JL', name: 'Japan Airlines' },
      { code: 'KE', name: 'Korean Air' },
      { code: 'KL', name: 'KLM' },
      { code: 'KQ', name: 'Kenya Airways' },
      { code: 'LA', name: 'LATAM Airlines' },
      { code: 'LH', name: 'Lufthansa' },
      { code: 'LO', name: 'LOT Polish Airlines' },
      { code: 'LX', name: 'Swiss' },
      { code: 'MH', name: 'Malaysia Airlines' },
      { code: 'MK', name: 'Air Mauritius' },
      { code: 'MS', name: 'EgyptAir' },
      { code: 'NH', name: 'ANA' },
      { code: 'NK', name: 'Spirit Airlines' },
      { code: 'OS', name: 'Austrian Airlines' },
      { code: 'OZ', name: 'Asiana Airlines' },
      { code: 'PC', name: 'Pegasus Airlines' },
      { code: 'QF', name: 'Qantas' },
      { code: 'QR', name: 'Qatar Airways' },
      { code: 'RJ', name: 'Royal Jordanian' },
      { code: 'SK', name: 'SAS' },
      { code: 'SN', name: 'Brussels Airlines' },
      { code: 'SQ', name: 'Singapore Airlines' },
      { code: 'TG', name: 'Thai Airways' },
      { code: 'TK', name: 'Turkish Airlines' },
      { code: 'TP', name: 'TAP Air Portugal' },
      { code: 'U2', name: 'easyJet' },
      { code: 'UA', name: 'United Airlines' },
      { code: 'UX', name: 'Air Europa' },
      { code: 'VS', name: 'Virgin Atlantic' },
      { code: 'VY', name: 'Vueling' },
      { code: 'W6', name: 'Wizz Air' },
      { code: 'WN', name: 'Southwest Airlines' },
      { code: 'WS', name: 'WestJet' },
      { code: 'XQ', name: 'SunExpress' },
    ].sort((a, b) => a.name.localeCompare(b.name));

    // Popular airlines per departure city (top 10 by typical market share)
    const airlinesByCity = {
      default: ['Emirates', 'Ryanair', 'easyJet', 'British Airways', 'Lufthansa', 'Air France', 'KLM', 'Turkish Airlines', 'Qatar Airways', 'Singapore Airlines'],
      // Portugal
      LIS: ['TAP Air Portugal', 'Ryanair', 'easyJet', 'Wizz Air', 'Vueling', 'British Airways', 'Lufthansa', 'Iberia', 'Air France', 'KLM'],
      OPO: ['TAP Air Portugal', 'Ryanair', 'easyJet', 'Vueling', 'Wizz Air', 'British Airways', 'KLM', 'Iberia', 'Air France', 'Lufthansa'],
      // Spain
      MAD: ['Iberia', 'Vueling', 'Ryanair', 'easyJet', 'Air Europa', 'British Airways', 'Lufthansa', 'Air France', 'KLM', 'Wizz Air'],
      BCN: ['Vueling', 'Ryanair', 'easyJet', 'Iberia', 'Wizz Air', 'British Airways', 'Lufthansa', 'Air France', 'Norwegian', 'KLM'],
      AGP: ['Ryanair', 'easyJet', 'Vueling', 'British Airways', 'Wizz Air', 'Norwegian', 'Iberia', 'Jet2', 'TUI', 'Air Europa'],
      // UK
      LON: ['British Airways', 'easyJet', 'Ryanair', 'Virgin Atlantic', 'Lufthansa', 'Air France', 'KLM', 'Emirates', 'Turkish Airlines', 'Qatar Airways'],
      LGW: ['easyJet', 'British Airways', 'Ryanair', 'Norwegian', 'Vueling', 'Wizz Air', 'KLM', 'Air France', 'TUI', 'Jet2'],
      STN: ['Ryanair', 'easyJet', 'Wizz Air', 'Norwegian', 'Vueling', 'British Airways', 'Jet2', 'TUI', 'SunExpress', 'Pegasus Airlines'],
      MAN: ['easyJet', 'Jet2', 'TUI', 'Ryanair', 'British Airways', 'Wizz Air', 'Norwegian', 'KLM', 'Lufthansa', 'Air France'],
      EDI: ['easyJet', 'Ryanair', 'British Airways', 'Wizz Air', 'Jet2', 'Norwegian', 'KLM', 'Lufthansa', 'Air France', 'TUI'],
      // Ireland
      DUB: ['Ryanair', 'Aer Lingus', 'British Airways', 'easyJet', 'Norwegian', 'KLM', 'Lufthansa', 'Air France', 'Vueling', 'Wizz Air'],
      // France
      CDG: ['Air France', 'easyJet', 'British Airways', 'Lufthansa', 'KLM', 'Iberia', 'Emirates', 'Turkish Airlines', 'Qatar Airways', 'Ryanair'],
      ORY: ['Air France', 'Transavia', 'easyJet', 'Vueling', 'Ryanair', 'Wizz Air', 'Iberia', 'British Airways', 'Norwegian', 'KLM'],
      NCE: ['easyJet', 'Ryanair', 'Air France', 'Vueling', 'Wizz Air', 'British Airways', 'Transavia', 'Lufthansa', 'Norwegian', 'KLM'],
      MRS: ['easyJet', 'Ryanair', 'Air France', 'Vueling', 'Transavia', 'Wizz Air', 'British Airways', 'Norwegian', 'Iberia', 'KLM'],
      LYS: ['easyJet', 'Air France', 'Ryanair', 'Transavia', 'Vueling', 'Wizz Air', 'British Airways', 'Lufthansa', 'Norwegian', 'KLM'],
      // Netherlands
      AMS: ['KLM', 'easyJet', 'Ryanair', 'Transavia', 'British Airways', 'Lufthansa', 'Air France', 'Turkish Airlines', 'Emirates', 'Wizz Air'],
      // Belgium
      BRU: ['Brussels Airlines', 'Ryanair', 'easyJet', 'Wizz Air', 'British Airways', 'Lufthansa', 'Air France', 'KLM', 'Norwegian', 'Vueling'],
      // Germany
      FRA: ['Lufthansa', 'Eurowings', 'British Airways', 'Air France', 'KLM', 'Emirates', 'Turkish Airlines', 'Ryanair', 'Iberia', 'Singapore Airlines'],
      BER: ['Ryanair', 'easyJet', 'Eurowings', 'Wizz Air', 'Lufthansa', 'British Airways', 'Norwegian', 'Air France', 'KLM', 'Turkish Airlines'],
      MUC: ['Lufthansa', 'Eurowings', 'Ryanair', 'British Airways', 'Air France', 'KLM', 'Austrian Airlines', 'Turkish Airlines', 'Emirates', 'Qatar Airways'],
      HAM: ['Eurowings', 'Lufthansa', 'Ryanair', 'easyJet', 'Wizz Air', 'British Airways', 'KLM', 'Air France', 'Norwegian', 'Turkish Airlines'],
      DUS: ['Eurowings', 'Lufthansa', 'Ryanair', 'easyJet', 'Wizz Air', 'British Airways', 'KLM', 'Air France', 'Turkish Airlines', 'Norwegian'],
      // Austria
      VIE: ['Austrian Airlines', 'Eurowings', 'Ryanair', 'easyJet', 'Wizz Air', 'Lufthansa', 'British Airways', 'Air France', 'KLM', 'Turkish Airlines'],
      // Switzerland
      ZUR: ['Swiss', 'Eurowings', 'British Airways', 'Air France', 'Lufthansa', 'KLM', 'Emirates', 'Turkish Airlines', 'Austrian Airlines', 'easyJet'],
      GVA: ['easyJet', 'Swiss', 'British Airways', 'Air France', 'Iberia', 'Lufthansa', 'Vueling', 'Ryanair', 'Wizz Air', 'KLM'],
      // Italy
      FCO: ['Ryanair', 'easyJet', 'ITA Airways', 'British Airways', 'Lufthansa', 'Air France', 'KLM', 'Wizz Air', 'Vueling', 'Iberia'],
      MXP: ['easyJet', 'Ryanair', 'Wizz Air', 'ITA Airways', 'British Airways', 'Lufthansa', 'Air France', 'KLM', 'Norwegian', 'Vueling'],
      VCE: ['Ryanair', 'easyJet', 'Wizz Air', 'Vueling', 'British Airways', 'Lufthansa', 'Air France', 'KLM', 'Norwegian', 'Iberia'],
      NAP: ['Ryanair', 'easyJet', 'Wizz Air', 'Vueling', 'ITA Airways', 'British Airways', 'Lufthansa', 'Air France', 'Norwegian', 'KLM'],
      // Greece
      ATH: ['easyJet', 'Ryanair', 'Wizz Air', 'British Airways', 'Lufthansa', 'Air France', 'KLM', 'Turkish Airlines', 'Emirates', 'Qatar Airways'],
      // Scandinavia
      CPH: ['SAS', 'easyJet', 'Ryanair', 'Norwegian', 'British Airways', 'Lufthansa', 'Air France', 'KLM', 'Wizz Air', 'Turkish Airlines'],
      ARN: ['SAS', 'Norwegian', 'easyJet', 'Ryanair', 'British Airways', 'Lufthansa', 'Air France', 'KLM', 'Wizz Air', 'Finnair'],
      OSL: ['SAS', 'Norwegian', 'easyJet', 'Ryanair', 'British Airways', 'Lufthansa', 'Wizz Air', 'KLM', 'Air France', 'Wideroe'],
      HEL: ['Finnair', 'SAS', 'Norwegian', 'easyJet', 'British Airways', 'Lufthansa', 'KLM', 'Air France', 'Ryanair', 'Wizz Air'],
      // Eastern Europe
      PRG: ['Ryanair', 'easyJet', 'Wizz Air', 'Czech Airlines', 'British Airways', 'Lufthansa', 'Air France', 'KLM', 'Turkish Airlines', 'Austrian Airlines'],
      WAW: ['LOT Polish Airlines', 'Ryanair', 'easyJet', 'Wizz Air', 'British Airways', 'Lufthansa', 'Air France', 'KLM', 'Turkish Airlines', 'Norwegian'],
      KRK: ['Ryanair', 'Wizz Air', 'easyJet', 'LOT Polish Airlines', 'British Airways', 'Lufthansa', 'Norwegian', 'Air France', 'KLM', 'Eurowings'],
      BUD: ['Ryanair', 'Wizz Air', 'easyJet', 'British Airways', 'Lufthansa', 'Air France', 'KLM', 'LOT Polish Airlines', 'Turkish Airlines', 'Austrian Airlines'],
      // Balkans
      BEG: ['Air Serbia', 'Ryanair', 'Wizz Air', 'easyJet', 'British Airways', 'Lufthansa', 'Air France', 'KLM', 'Turkish Airlines', 'Austrian Airlines'],
      DBV: ['Ryanair', 'easyJet', 'Wizz Air', 'Croatia Airlines', 'British Airways', 'Lufthansa', 'Air France', 'KLM', 'Norwegian', 'Vueling'],
      SPU: ['Ryanair', 'easyJet', 'Wizz Air', 'Croatia Airlines', 'British Airways', 'Vueling', 'Norwegian', 'Lufthansa', 'Air France', 'KLM'],
      // Turkey
      IST: ['Turkish Airlines', 'Pegasus Airlines', 'SunExpress', 'British Airways', 'Lufthansa', 'Air France', 'KLM', 'Emirates', 'Ryanair', 'easyJet'],
      AYT: ['Turkish Airlines', 'Pegasus Airlines', 'SunExpress', 'Ryanair', 'easyJet', 'Wizz Air', 'British Airways', 'Lufthansa', 'Vueling', 'Norwegian'],
      // Middle East
      DXB: ['Emirates', 'flydubai', 'British Airways', 'Lufthansa', 'Air France', 'KLM', 'Qatar Airways', 'Etihad Airways', 'Turkish Airlines', 'Singapore Airlines'],
      DOH: ['Qatar Airways', 'British Airways', 'Lufthansa', 'Air France', 'KLM', 'Emirates', 'Etihad Airways', 'Turkish Airlines', 'Singapore Airlines', 'Royal Jordanian'],
      // Africa
      CAI: ['EgyptAir', 'Air Arabia', 'Emirates', 'Qatar Airways', 'Turkish Airlines', 'British Airways', 'Lufthansa', 'Air France', 'EasyJet', 'Ryanair'],
      CMN: ['Royal Air Maroc', 'Ryanair', 'easyJet', 'Air Arabia Maroc', 'British Airways', 'Lufthansa', 'Air France', 'KLM', 'Turkish Airlines', 'Vueling'],
      JNB: ['South African Airways', 'Mango', 'Kulula', 'British Airways', 'Emirates', 'Qatar Airways', 'Lufthansa', 'Air France', 'KLM', 'Ethiopian Airlines'],
      CPT: ['South African Airways', 'kulula', 'FlySafair', 'British Airways', 'Emirates', 'Qatar Airways', 'Lufthansa', 'Air France', 'KLM', 'Ethiopian Airlines'],
      // North America
      JFK: ['American Airlines', 'Delta Air Lines', 'United Airlines', 'British Airways', 'Air France', 'Lufthansa', 'Emirates', 'JetBlue', 'Qatar Airways', 'KLM'],
      EWR: ['United Airlines', 'American Airlines', 'Delta Air Lines', 'British Airways', 'Lufthansa', 'Air France', 'KLM', 'Emirates', 'Turkish Airlines', 'JetBlue'],
      LAX: ['Delta Air Lines', 'United Airlines', 'American Airlines', 'Alaska Airlines', 'British Airways', 'Air France', 'KLM', 'Lufthansa', 'Singapore Airlines', 'Emirates'],
      SFO: ['United Airlines', 'Delta Air Lines', 'American Airlines', 'Alaska Airlines', 'British Airways', 'Air France', 'KLM', 'Lufthansa', 'Singapore Airlines', 'ANA'],
      ORD: ['United Airlines', 'American Airlines', 'Delta Air Lines', 'Southwest Airlines', 'British Airways', 'Lufthansa', 'Air France', 'KLM', 'Turkish Airlines', 'JetBlue'],
      MIA: ['American Airlines', 'Delta Air Lines', 'United Airlines', 'British Airways', 'LATAM Airlines', 'Copa Airlines', 'Air France', 'Lufthansa', 'Avianca', 'JetBlue'],
      BOS: ['JetBlue', 'American Airlines', 'Delta Air Lines', 'United Airlines', 'British Airways', 'Air France', 'Lufthansa', 'Iberia', 'Norwegian', 'KLM'],
      YYZ: ['Air Canada', 'WestJet', 'British Airways', 'American Airlines', 'Delta Air Lines', 'United Airlines', 'Lufthansa', 'Air France', 'KLM', 'Emirates'],
      // South America
      GRU: ['LATAM Airlines', 'Gol', 'Azul', 'Air France', 'Lufthansa', 'KLM', 'British Airways', 'American Airlines', 'Delta Air Lines', 'Emirates'],
      EZE: ['Aerolíneas Argentinas', 'LATAM Airlines', 'Air France', 'Lufthansa', 'British Airways', 'KLM', 'American Airlines', 'Delta Air Lines', 'Emirates', 'Copa Airlines'],
      BOG: ['Avianca', 'LATAM Airlines', 'Copa Airlines', 'American Airlines', 'Delta Air Lines', 'United Airlines', 'Air France', 'Lufthansa', 'British Airways', 'Iberia'],
      // Asia
      SIN: ['Singapore Airlines', 'Scoot', 'Jetstar Asia', 'British Airways', 'Lufthansa', 'Emirates', 'Qantas', 'Cathay Pacific', 'Thai Airways', 'Malaysia Airlines'],
      BKK: ['Thai Airways', 'AirAsia', 'Bangkok Airways', 'Emirates', 'Qatar Airways', 'Singapore Airlines', 'British Airways', 'Lufthansa', 'Cathay Pacific', 'Korean Air'],
      KUL: ['Malaysia Airlines', 'AirAsia', 'Malindo Air', 'Singapore Airlines', 'Emirates', 'Qatar Airways', 'British Airways', 'Lufthansa', 'Cathay Pacific', 'Thai Airways'],
      HKG: ['Cathay Pacific', 'HK Express', 'British Airways', 'Lufthansa', 'Air France', 'KLM', 'Emirates', 'Singapore Airlines', 'ANA', 'Japan Airlines'],
      ICN: ['Korean Air', 'Asiana Airlines', 'Jeju Air', 'British Airways', 'Lufthansa', 'Air France', 'Emirates', 'Singapore Airlines', 'ANA', 'Japan Airlines'],
      NRT: ['ANA', 'Japan Airlines', 'British Airways', 'Lufthansa', 'Air France', 'KLM', 'Emirates', 'Singapore Airlines', 'Cathay Pacific', 'Korean Air'],
      HND: ['ANA', 'Japan Airlines', 'British Airways', 'Lufthansa', 'Air France', 'Emirates', 'Singapore Airlines', 'Korean Air', 'Cathay Pacific', 'Delta Air Lines'],
      PEK: ['Air China', 'China Eastern', 'China Southern', 'British Airways', 'Lufthansa', 'Air France', 'KLM', 'Emirates', 'Singapore Airlines', 'ANA'],
      PVG: ['China Eastern', 'China Southern', 'Air China', 'British Airways', 'Lufthansa', 'Air France', 'KLM', 'Emirates', 'Singapore Airlines', 'Japan Airlines'],
      DEL: ['Air India', 'IndiGo', 'British Airways', 'Lufthansa', 'Air France', 'KLM', 'Emirates', 'Qatar Airways', 'Etihad Airways', 'Singapore Airlines'],
      BOM: ['Air India', 'IndiGo', 'British Airways', 'Lufthansa', 'Air France', 'Emirates', 'Qatar Airways', 'Etihad Airways', 'Singapore Airlines', 'KLM'],
      // Oceania
      SYD: ['Qantas', 'Virgin Australia', 'Jetstar', 'British Airways', 'Singapore Airlines', 'Cathay Pacific', 'Lufthansa', 'Air France', 'Emirates', 'Etihad Airways'],
      MEL: ['Qantas', 'Virgin Australia', 'Jetstar', 'British Airways', 'Singapore Airlines', 'Cathay Pacific', 'Lufthansa', 'Air France', 'Emirates', 'Etihad Airways'],
      AKL: ['Air New Zealand', 'Qantas', 'Jetstar', 'Singapore Airlines', 'Emirates', 'Cathay Pacific', 'British Airways', 'Fiji Airways', 'Korean Air', 'China Airlines'],
    };

    res.json({
      cities: allCities,
      cityGroups,
      airlines: allAirlines,
      airlinesByCity,
      aircraftTypes: allAircraftTypes,
      aircraft: allAircraft,
      apiStatus: {
        amadeus: !!(process.env.AMADEUS_CLIENT_ID && process.env.AMADEUS_CLIENT_SECRET),
        duffel: !!(process.env.DUFFEL_API_KEY),
        activeApi: process.env.FLIGHT_API || 'amadeus',
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
        const exploreApi = FLIGHT_API;
        const segCacheKey = `raw:${exploreApi}:${depCode}:${dest.code}:${searchDate}:1:`;
        let primaryFailed = false;
        try {
          const { data: raw } = await cacheService.getOrFetch(segCacheKey, () => {
            const params = { departure_airport: depCode, arrival_airport: dest.code, departure_date: searchDate, passengers: 1 };
            return exploreApi === 'duffel' && process.env.DUFFEL_API_KEY
              ? duffelService.searchFlights(params)
              : amadeusService.searchFlights(params);
          });

          const flights = exploreApi === 'duffel' && process.env.DUFFEL_API_KEY
            ? formatDuffelFlights(raw)
            : formatAmadeusFlights(raw);

          if (flights.length) {
            // Enrich aircraft data
            await enrichWithAircraftData(flights, []);

            // Filter by aircraft criteria
            const matching = flights.filter(f => {
              if (aircraftModel) return f.aircraftCode === aircraftModel.toUpperCase();
              if (aircraftType) return f.aircraft?.type === aircraftType.toLowerCase();
              return true;
            });

            if (matching.length) {
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
                source: exploreApi,
              };
            }
          }
        } catch (err) {
          primaryFailed = true;
          console.warn('[explore] primary failed: dep=%s dest=%s api=%s err=%s', depCode, dest.code, exploreApi, err.message);
        }

        // Aircraft filters can't be satisfied by price-only feeds, skip fallback in that case.
        if (aircraftType || aircraftModel) return null;

        // Fallback: Travelpayouts cheap-prices feed. Far lower rate-limit, works when
        // Duffel/Amadeus throttles or returns empty sets for unpopular routes.
        if (!travelpayoutsService.isConfigured()) return null;
        const tp = await travelpayoutsService.getCheapest({
          origin: depCode,
          destination: dest.code,
          date: searchDate,
          currency: 'usd',
        });
        if (!tp) return null;

        return {
          destination: dest,
          price: tp.price,
          currency: tp.currency,
          duration: tp.durationMinutes ? `${Math.floor(tp.durationMinutes / 60)}h ${tp.durationMinutes % 60}m` : null,
          stops: tp.stops ?? 0,
          airline: tp.airline,
          aircraftCode: null,
          aircraftName: null,
          aircraftType: 'jet',
          departureTime: tp.departureTime,
          arrivalTime: null,
          source: primaryFailed ? 'travelpayouts-fallback' : 'travelpayouts',
        };
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
 * Cheapest prices per day for a given route + month, via Travelpayouts.
 * GET /api/flights/cheap-calendar?departure=LHR&arrival=JFK&month=2026-05&currency=usd
 */
exports.getCheapCalendar = async (req, res) => {
  const vq = req.validatedQuery || {};
  const origin      = vq.departure;
  const destination = vq.arrival;
  const month       = vq.month;
  const currency    = vq.currency || 'usd';

  const empty = {
    origin,
    destination,
    month,
    currency,
    source: 'travelpayouts',
    entries: [],
  };

  if (!travelpayoutsService.isConfigured()) {
    return res.json(empty);
  }

  const cacheKey = `cheap-cal:${vq.sanitisedCacheKey || `${origin}:${destination}:${month}:${currency}`}`;

  try {
    const { data: entries } = await cacheService.getOrFetch(
      cacheKey,
      async () => {
        const calendar = await travelpayoutsService.getPricesCalendar({
          origin,
          destination,
          month,
          currency,
        });
        return (calendar || [])
          .filter(e => e && e.date && typeof e.price === 'number')
          .map(e => ({ date: e.date, price: e.price }));
      },
      3600
    );

    res.json({
      origin,
      destination,
      month,
      currency,
      source: 'travelpayouts',
      entries: Array.isArray(entries) ? entries : [],
    });
  } catch (err) {
    console.error('[cheap-calendar] failed:', err.message);
    res.json(empty);
  }
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
    res.status(500).json({
      success: false,
      message: error.message || 'Booking failed. Please try again or contact support.',
    });
  }
};

/**
 * GET /api/flights/scheduled-aircraft?departure=LHR&arrival=JFK&date=2026-05-01
 *
 * Pulls future-scheduled departures from AeroDataBox for `departure` on `date`
 * (split into 2×12h local-time windows to stay within their API cap), filters
 * down to flights bound for `arrival`, and enriches each row with an ICAO
 * aircraft type code via the local aircraft_db (hex → type) lookup.
 */
exports.getScheduledAircraft = async (req, res) => {
  const vq = req.validatedQuery || {};
  const departure = vq.departure;
  const arrival   = vq.arrival;
  const date      = vq.date;

  if (!aerodataboxService.isEnabled()) {
    return res.json({
      success: true,
      count: 0,
      data: [],
      note: 'AeroDataBox not configured',
    });
  }

  // Split the day into two 12-hour local windows (AeroDataBox hard limit).
  // Times are "local to the airport" per the AeroDataBox contract — passing the
  // same wall-clock string we got from the user is the correct behaviour.
  const windows = [
    [`${date}T00:00`, `${date}T12:00`],
    [`${date}T12:00`, `${date}T23:59`],
  ];

  try {
    const chunks = await Promise.all(
      windows.map(([from, to]) => aerodataboxService.getAirportDepartures(departure, from, to))
    );
    const all = chunks.flat();

    // Filter to flights actually arriving at the requested airport, dedupe by flight number.
    const seen = new Set();
    const data = [];
    for (const f of all) {
      if (!f || f.arr?.iata !== arrival) continue;
      const key = `${f.number || ''}:${f.dep?.scheduledUtc || ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      data.push({
        flightNumber: f.number,
        airline: f.airline,
        depTime: f.dep?.scheduledLocal || f.dep?.scheduledUtc,
        arrTime: f.arr?.scheduledLocal || f.arr?.scheduledUtc,
        aircraft: {
          icaoType: f.aircraft?.icaoType || null,
          reg:      f.aircraft?.reg || null,
          model:    f.aircraft?.model || null,
        },
      });
    }

    res.json({ success: true, count: data.length, data });
  } catch (err) {
    console.error('[scheduled-aircraft] error:', err.message);
    res.status(500).json({ success: false, message: 'Error fetching scheduled aircraft' });
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
