const axios = require('axios');

const BASE_URL = 'https://api.travelpayouts.com';
const TOKEN = process.env.TRAVELPAYOUTS_TOKEN;
const MARKER = process.env.TRAVELPAYOUTS_MARKER || '709966';
const TRS = process.env.TRAVELPAYOUTS_TRS || '509158';
const PROGRAM = '4114';

if (!TOKEN) {
  console.warn('⚠️  TRAVELPAYOUTS_TOKEN is not configured. Aviasales fallback disabled.');
}

const client = axios.create({
  baseURL: BASE_URL,
  timeout: 6000,
  headers: { 'X-Access-Token': TOKEN || '' },
});

const ALLOWED_CURRENCIES = new Set(['usd', 'eur']);

function normaliseCurrency(cur) {
  const c = String(cur || 'usd').toLowerCase();
  return ALLOWED_CURRENCIES.has(c) ? c : 'usd';
}

exports.MARKER = MARKER;
exports.isConfigured = () => Boolean(TOKEN);

/**
 * Cheapest known flight for origin→destination on (or around) a given date.
 * Returns null on any failure or when no data is available.
 *
 * @param {object} params
 * @param {string} params.origin - IATA code
 * @param {string} params.destination - IATA code
 * @param {string} [params.date] - YYYY-MM-DD (optional, narrows result)
 * @param {string} [params.currency] - 'usd' | 'eur'
 */
exports.getCheapest = async ({ origin, destination, date, currency }) => {
  if (!TOKEN) return null;
  try {
    const { data } = await client.get('/v1/prices/cheap', {
      params: {
        origin: String(origin || '').toUpperCase(),
        destination: String(destination || '').toUpperCase(),
        depart_date: date || undefined,
        currency: normaliseCurrency(currency),
      },
    });

    if (!data?.success || !data?.data) return null;

    const destEntry = data.data[String(destination).toUpperCase()]
      || Object.values(data.data)[0];
    if (!destEntry) return null;

    const variants = Object.values(destEntry);
    if (!variants.length) return null;

    const best = variants.reduce((a, b) => (a.price <= b.price ? a : b));

    return {
      price: String(best.price),
      currency: (data.currency || currency || 'usd').toUpperCase(),
      airline: best.airline,
      flightNumber: best.flight_number ? String(best.flight_number) : null,
      departureTime: best.departure_at,
      returnTime: best.return_at || null,
      durationMinutes: best.duration || null,
      stops: typeof best.transfers === 'number' ? best.transfers : null,
      expiresAt: best.expires_at || null,
      source: 'travelpayouts',
    };
  } catch (err) {
    console.warn(`[travelpayouts] getCheapest ${origin}→${destination} failed:`, err.message);
    return null;
  }
};

/**
 * Price calendar for a month. Returns array of { date, price, airline, transfers }.
 *
 * @param {object} params
 * @param {string} params.origin
 * @param {string} params.destination
 * @param {string} params.month - YYYY-MM
 * @param {string} [params.currency]
 */
exports.getPricesCalendar = async ({ origin, destination, month, currency }) => {
  if (!TOKEN) return [];
  try {
    const { data } = await client.get('/v1/prices/calendar', {
      params: {
        origin: String(origin || '').toUpperCase(),
        destination: String(destination || '').toUpperCase(),
        depart_date: month,
        currency: normaliseCurrency(currency),
      },
    });

    if (!data?.success || !data?.data) return [];

    return Object.entries(data.data).map(([date, entry]) => ({
      date,
      price: entry.price,
      airline: entry.airline,
      flightNumber: entry.flight_number ? String(entry.flight_number) : null,
      departureTime: entry.departure_at,
      transfers: entry.transfers ?? null,
      currency: (data.currency || currency || 'usd').toUpperCase(),
    }));
  } catch (err) {
    console.warn(`[travelpayouts] getPricesCalendar ${origin}→${destination} ${month} failed:`, err.message);
    return [];
  }
};

/**
 * Build an affiliate deep-link URL for Aviasales search through the tp.media
 * redirect — required for click attribution in the Travelpayouts dashboard.
 * Final URL shape: https://tp.media/r?marker=...&trs=...&p=4114&u=<encoded>
 */
exports.buildDeepLink = ({ origin, destination, date, returnDate, passengers = 1 }) => {
  if (!origin || !destination || !date) return null;
  const toDDMM = (iso) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return String(d.getUTCDate()).padStart(2, '0') + String(d.getUTCMonth() + 1).padStart(2, '0');
  };
  const departDDMM = toDDMM(date);
  if (!departDDMM) return null;

  let aviasalesUrl = `https://www.aviasales.com/search/${origin}${departDDMM}${destination}`;
  if (returnDate) {
    const ret = toDDMM(returnDate);
    if (ret) aviasalesUrl += `${ret}${passengers}`;
    else aviasalesUrl += `${passengers}`;
  } else {
    aviasalesUrl += `${passengers}`;
  }

  return `https://tp.media/r?marker=${MARKER}&trs=${TRS}&p=${PROGRAM}&u=${encodeURIComponent(aviasalesUrl)}`;
};
