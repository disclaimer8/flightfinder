const axios = require('axios');

const KIWI_API_URL = 'https://api.tequila.kiwi.com';
const KIWI_API_KEY = process.env.KIWI_API_KEY;

if (!KIWI_API_KEY) {
  console.warn('⚠️  KIWI_API_KEY is not configured. Kiwi searches will fail.');
}

const kiwiClient = axios.create({
  baseURL: KIWI_API_URL,
  headers: { apikey: KIWI_API_KEY },
});

kiwiClient.interceptors.request.use(config => {
  console.debug('Kiwi API request:', config.method?.toUpperCase(), config.url);
  return config;
});

/**
 * Search flights using Kiwi Tequila API
 * Docs: https://tequila.kiwi.com/portal/docs/tequila-api/search_api
 */
exports.searchFlights = async (params) => {
  const { departure_airport, arrival_airport, departure_date, passengers, return_date } = params;

  const query = {
    fly_from: departure_airport,
    fly_to: arrival_airport,
    date_from: formatDate(departure_date),
    date_to: formatDate(departure_date),
    adults: passengers || 1,
    curr: 'EUR',
    limit: 20,
    sort: 'price',
    vehicle_type: 'aircraft',
  };

  if (return_date) {
    query.return_from = formatDate(return_date);
    query.return_to = formatDate(return_date);
  }

  try {
    const response = await kiwiClient.get('/v2/search', { params: query });
    console.debug('Kiwi search successful, received', response.data?.data?.length, 'offers');
    return response.data;
  } catch (error) {
    console.error('Kiwi API Error:', error.response?.data || error.message);
    throw new Error(`Kiwi search failed: ${error.response?.data?.message || error.message}`);
  }
};

/** Convert YYYY-MM-DD → DD/MM/YYYY (Kiwi format) */
function formatDate(dateStr) {
  if (!dateStr) return null;
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
}

/** Parse Kiwi duration in seconds → "Xh Ym" */
exports.parseDuration = (seconds) => {
  if (!seconds) return null;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
};
