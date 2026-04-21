const Amadeus = require('amadeus');

const AMADEUS_CLIENT_ID = process.env.AMADEUS_CLIENT_ID;
const AMADEUS_CLIENT_SECRET = process.env.AMADEUS_CLIENT_SECRET;

let amadeus = null;

if (!AMADEUS_CLIENT_ID || !AMADEUS_CLIENT_SECRET) {
  console.warn('⚠️  AMADEUS_CLIENT_ID or AMADEUS_CLIENT_SECRET is not configured. Live searches will fail.');
} else {
  try {
    amadeus = new Amadeus({
      clientId: AMADEUS_CLIENT_ID,
      clientSecret: AMADEUS_CLIENT_SECRET,
      hostname: process.env.AMADEUS_ENV === 'production' ? 'production' : 'test'
    });
  } catch (err) {
    console.warn('⚠️  Failed to initialize Amadeus client:', err.message);
  }
}

/**
 * Search for flights using Amadeus Flight Offers Search API
 * @param {Object} params
 * @param {string} params.departure_airport - IATA code (e.g. LIS)
 * @param {string} params.arrival_airport   - IATA code (e.g. JFK)
 * @param {string} params.departure_date    - YYYY-MM-DD
 * @param {number} params.passengers        - Number of adult passengers
 */
exports.searchFlights = async (params) => {
  if (!amadeus) throw new Error('Amadeus API is not configured');
  const query = {
    originLocationCode: params.departure_airport,
    destinationLocationCode: params.arrival_airport,
    departureDate: params.departure_date,
    adults: params.passengers || 1,
    max: 20
  };
  if (params.return_date) query.returnDate = params.return_date;
  if (params.nonStop) query.nonStop = true;

  const response = await amadeus.shopping.flightOffersSearch.get(query);

  return response.result; // { data: [...], dictionaries: {...} }
};

/**
 * Flight Inspiration Search — top destinations from an origin (cheap fares).
 * @param {string} origin - IATA code (e.g. 'MAD')
 * @param {string|null} departureDate - optional YYYY-MM-DD
 */
exports.flightDestinations = async (origin, departureDate) => {
  if (!amadeus) throw new Error('Amadeus API is not configured');
  const params = { origin };
  if (departureDate) params.departureDate = departureDate;
  const response = await amadeus.shopping.flightDestinations.get(params);
  return response.data || [];
};

/**
 * Flight Cheapest Date Search — find cheapest departure dates for a route.
 * @param {string} origin - IATA code
 * @param {string} destination - IATA code
 */
exports.flightDates = async (origin, destination) => {
  if (!amadeus) throw new Error('Amadeus API is not configured');
  const response = await amadeus.shopping.flightDates.get({ origin, destination });
  return response.data || [];
};

/**
 * Parse ISO 8601 duration (e.g. "PT8H30M") to a readable string
 */
exports.parseDuration = (isoDuration) => {
  if (!isoDuration) return 'N/A';
  const match = isoDuration.match(/PT(?:(\d+)H)?(?:(\d+)M)?/);
  if (!match) return isoDuration;
  const hours = match[1] ? `${match[1]}h` : '';
  const minutes = match[2] ? ` ${match[2]}m` : '';
  return `${hours}${minutes}`.trim() || 'N/A';
};
