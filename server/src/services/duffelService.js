const axios = require('axios');

// Duffel API configuration
const DUFFEL_API_URL = 'https://api.duffel.com';
const DUFFEL_API_KEY = process.env.DUFFEL_API_KEY;
const DUFFEL_VERSION = 'v2';

if (!DUFFEL_API_KEY) {
  console.warn('⚠️  DUFFEL_API_KEY is not configured. Live searches will fail.');
}

const duffelClient = axios.create({
  baseURL: DUFFEL_API_URL,
  headers: {
    'Authorization': `Bearer ${DUFFEL_API_KEY}`,
    'Content-Type': 'application/json',
    'Duffel-Version': DUFFEL_VERSION
  }
});

// log requests for debugging
duffelClient.interceptors.request.use(config => {
  console.debug('Duffel API request:', config.method?.toUpperCase(), config.url);
  return config;
});

/**
 * Search for flights using Duffel API (modern endpoint /air/offer_requests)
 * @param {Object} params - Search parameters
 * @param {string} params.departure_airport - IATA code (e.g., LIS)
 * @param {string} params.arrival_airport - IATA code (e.g., NYC)
 * @param {string} params.departure_date - ISO date (YYYY-MM-DD)
 * @param {string} params.return_date - Optional return date
 * @param {number} params.passengers - Number of passengers (default: 1)
 */
exports.searchFlights = async (params) => {
  try {
    const outboundSlice = {
      origin: params.departure_airport,
      destination: params.arrival_airport,
      departure_date: params.departure_date ? params.departure_date.split('T')[0] : new Date().toISOString().split('T')[0],
    };
    if (params.nonStop) outboundSlice.max_connections = 0;

    const requestData = {
      cabin_class: 'economy',
      slices: [outboundSlice],
      passengers: Array.from({ length: params.passengers || 1 }, () => ({ type: 'adult' }))
    };

    if (params.return_date) {
      const returnSlice = {
        origin: params.arrival_airport,
        destination: params.departure_airport,
        departure_date: params.return_date,
      };
      if (params.nonStop) returnSlice.max_connections = 0;
      requestData.slices.push(returnSlice);
    }

    // Duffel API expects payload nested under a top-level "data" key
    // return_offers: true allows getting results in the same request
    const response = await duffelClient.post('/air/offer_requests?return_offers=true', { 
      data: requestData 
    });
    const offersCount = response.data?.data?.offers?.length || response.data?.offers?.length || 0;
    console.debug('Duffel search successful, received', offersCount, 'offers');
    return response.data;
  } catch (error) {
    console.error('Duffel API Error:', error.response?.data || error.message);
    throw new Error(`Duffel search failed: ${error.message}`);
  }
};

/**
 * Get offers for an existing offer request
 */
exports.getOffers = async (offerRequestId) => {
  try {
    const response = await duffelClient.get(`/air/offer_requests/${offerRequestId}/offers`);
    return response.data;
  } catch (error) {
    console.error('Duffel API Error:', error.message);
    throw new Error(`Failed to get offers: ${error.message}`);
  }
};

/**
 * Create an order (booking)
 */
exports.createOrder = async (offerData) => {
  try {
    const response = await duffelClient.post('/air/orders', {
      data: offerData
    });
    return response.data;
  } catch (error) {
    const duffelErrors = error.response?.data?.errors;
    const detail = duffelErrors ? duffelErrors.map(e => e.message).join('; ') : error.message;
    console.error('Duffel API Error:', error.response?.data || error.message);
    throw new Error(detail);
  }
};

/**
 * Get aircraft info from flight detail
 */
exports.extractAircraftInfo = (offer) => {
  const aircraft = [];
  
  if (offer.slices && Array.isArray(offer.slices)) {
    offer.slices.forEach(slice => {
      if (slice.segments && Array.isArray(slice.segments)) {
        slice.segments.forEach(segment => {
          if (segment.aircraft?.iata_code) {
            aircraft.push({
              iata: segment.aircraft.iata_code,
              airline: segment.operating_carrier?.name || 'Unknown'
            });
          }
        });
      }
    });
  }
  
  return aircraft;
};
