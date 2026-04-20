'use strict';

/**
 * Lightweight validation middleware — no external deps.
 *
 * Usage:
 *   router.get('/', validate.searchQuery, controller.searchFlights);
 */

const IATA_RE      = /^[A-Z]{2,3}$/;
const DATE_RE      = /^\d{4}-\d{2}-\d{2}$/;
const AIRCRAFT_MODEL_RE = /^[A-Z0-9]{1,6}$/;

const VALID_AIRCRAFT_TYPES = new Set(['turboprop', 'jet', 'regional', 'wide-body']);
const PHONE_RE       = /^\+?[\d\s\-().]{7,20}$/;
const VALID_TITLES   = new Set(['mr', 'ms', 'mrs', 'miss', 'dr']);
const VALID_GENDERS  = new Set(['M', 'F']);
const VALID_CURRENCIES = new Set(['EUR', 'USD', 'GBP']);
const EMAIL_RE   = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const DOB_RE     = /^\d{4}-\d{2}-\d{2}$/;

/** Send a 400 with a human-readable message */
function bad(res, message) {
  return res.status(400).json({ success: false, message });
}

/** Sanitise a string used as part of a cache key — strip anything except alphanumeric + hyphen */
function sanitiseKey(str) {
  return String(str || '').replace(/[^A-Za-z0-9\-]/g, '').toUpperCase().slice(0, 10);
}

/**
 * Validate GET /api/flights  query params
 */
function searchQuery(req, res, next) {
  const { departure, arrival, date, returnDate, passengers, aircraftType, aircraftModel } = req.query;

  if (!departure || !arrival) {
    return bad(res, 'departure and arrival are required');
  }

  const dep = departure.toUpperCase().trim();
  const arr = arrival.toUpperCase().trim();

  if (!IATA_RE.test(dep)) return bad(res, 'departure must be a 2–3 letter IATA code');
  if (!IATA_RE.test(arr)) return bad(res, 'arrival must be a 2–3 letter IATA code');
  if (dep === arr)         return bad(res, 'departure and arrival cannot be the same airport');

  if (date) {
    if (!DATE_RE.test(date)) return bad(res, 'date must be YYYY-MM-DD');
    const d = new Date(date);
    if (isNaN(d.getTime())) return bad(res, 'date is not a valid date');
    const today = new Date(); today.setHours(0,0,0,0);
    if (d < today) return bad(res, 'date must not be in the past');
  }

  if (returnDate) {
    if (!DATE_RE.test(returnDate)) return bad(res, 'returnDate must be YYYY-MM-DD');
    if (date && returnDate < date) return bad(res, 'returnDate must be on or after departure date');
  }

  const pax = parseInt(passengers, 10);
  if (passengers !== undefined && (isNaN(pax) || pax < 1 || pax > 9)) {
    return bad(res, 'passengers must be between 1 and 9');
  }

  if (aircraftType && !VALID_AIRCRAFT_TYPES.has(aircraftType.toLowerCase())) {
    return bad(res, `aircraftType must be one of: ${[...VALID_AIRCRAFT_TYPES].join(', ')}`);
  }

  if (aircraftModel && !AIRCRAFT_MODEL_RE.test(aircraftModel.toUpperCase())) {
    return bad(res, 'aircraftModel must be 1–6 alphanumeric characters');
  }

  // Normalise onto req so controllers get clean values
  req.validatedQuery = {
    departure:    dep,
    arrival:      arr,
    date:         date || null,
    returnDate:   returnDate || null,
    passengers:   pax || 1,
    aircraftType: aircraftType?.toLowerCase() || null,
    aircraftModel: aircraftModel?.toUpperCase() || null,
    sanitisedCacheKey: `${dep}:${arr}:${date || ''}:${pax || 1}:${returnDate || ''}`,
  };

  next();
}

/**
 * Validate GET /api/flights/explore  query params
 */
function exploreQuery(req, res, next) {
  const { departure, date, aircraftType, aircraftModel } = req.query;

  if (!departure) return bad(res, 'departure is required');

  const dep = departure.toUpperCase().trim();
  if (!IATA_RE.test(dep)) return bad(res, 'departure must be a 2–3 letter IATA code');

  if (date) {
    if (!DATE_RE.test(date)) return bad(res, 'date must be YYYY-MM-DD');
    const d = new Date(date);
    if (isNaN(d.getTime())) return bad(res, 'date is not a valid date');
    const today = new Date(); today.setHours(0,0,0,0);
    if (d < today) return bad(res, 'date must not be in the past');
  }

  if (aircraftType && !VALID_AIRCRAFT_TYPES.has(aircraftType.toLowerCase())) {
    return bad(res, `aircraftType must be one of: ${[...VALID_AIRCRAFT_TYPES].join(', ')}`);
  }

  if (aircraftModel && !AIRCRAFT_MODEL_RE.test(aircraftModel.toUpperCase())) {
    return bad(res, 'aircraftModel must be 1–6 alphanumeric characters');
  }

  req.validatedQuery = {
    departure:    dep,
    date:         date || null,
    aircraftType: aircraftType?.toLowerCase() || null,
    aircraftModel: aircraftModel?.toUpperCase() || null,
    sanitisedCacheKey: `${dep}:${sanitiseKey(date)}:${sanitiseKey(aircraftType)}:${sanitiseKey(aircraftModel)}`,
  };

  next();
}

/**
 * Validate GET /api/flights/cheap-calendar  query params
 */
function cheapCalendarQuery(req, res, next) {
  const { departure, arrival, month, currency } = req.query;

  if (!departure || !arrival) {
    return bad(res, 'departure and arrival are required');
  }

  const dep = departure.toUpperCase().trim();
  const arr = arrival.toUpperCase().trim();

  if (!IATA_RE.test(dep)) return bad(res, 'departure must be a 2–3 letter IATA code');
  if (!IATA_RE.test(arr)) return bad(res, 'arrival must be a 2–3 letter IATA code');
  if (dep === arr)         return bad(res, 'departure and arrival cannot be the same airport');

  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return bad(res, 'month must be YYYY-MM');
  }

  const [y, m] = month.split('-').map(Number);
  if (m < 1 || m > 12) return bad(res, 'month is not a valid calendar month');

  const now = new Date();
  const monthStart = new Date(y, m - 1, 1);
  const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  if (monthStart < currentMonthStart) return bad(res, 'month must be the current month or later');

  const cur = (currency || 'usd').toLowerCase();
  if (cur !== 'usd' && cur !== 'eur') {
    return bad(res, 'currency must be usd or eur');
  }

  req.validatedQuery = {
    departure: dep,
    arrival:   arr,
    month,
    currency:  cur,
    sanitisedCacheKey: `${dep}:${arr}:${month}:${cur}`,
  };

  next();
}

/**
 * Validate POST /api/flights/book  body
 */
function bookBody(req, res, next) {
  const { offerId, passengerIds, passengerInfo, currency, totalAmount } = req.body;

  if (!offerId || typeof offerId !== 'string' || offerId.length > 100) {
    return bad(res, 'offerId is required and must be a string');
  }

  if (!Array.isArray(passengerInfo) || passengerInfo.length === 0) {
    return bad(res, 'passengerInfo must be a non-empty array');
  }

  if (passengerInfo.length > 9) {
    return bad(res, 'Maximum 9 passengers per booking');
  }

  for (let i = 0; i < passengerInfo.length; i++) {
    const p = passengerInfo[i];
    const idx = `passengerInfo[${i}]`;

    if (!p || typeof p !== 'object') return bad(res, `${idx} must be an object`);
    if (!p.firstName || !/^[a-zA-ZÀ-ÿ'\- ]{2,50}$/.test(p.firstName.trim())) {
      return bad(res, `${idx}.firstName is invalid`);
    }
    if (!p.lastName || !/^[a-zA-ZÀ-ÿ'\- ]{2,50}$/.test(p.lastName.trim())) {
      return bad(res, `${idx}.lastName is invalid`);
    }
    if (!p.email || !EMAIL_RE.test(p.email)) {
      return bad(res, `${idx}.email is invalid`);
    }
    if (!p.dateOfBirth || !DOB_RE.test(p.dateOfBirth)) {
      return bad(res, `${idx}.dateOfBirth must be YYYY-MM-DD`);
    }
    const age = (Date.now() - new Date(p.dateOfBirth)) / (365.25 * 24 * 3600 * 1000);
    if (age < 18) return bad(res, `${idx}: passenger must be 18 or older`);
    if (age > 100) return bad(res, `${idx}.dateOfBirth is not plausible`);

    if (!VALID_TITLES.has((p.title || '').toLowerCase())) {
      return bad(res, `${idx}.title must be one of: ${[...VALID_TITLES].join(', ')}`);
    }
    if (!VALID_GENDERS.has(p.gender)) {
      return bad(res, `${idx}.gender must be M or F`);
    }
    if (!p.phone || !PHONE_RE.test(p.phone.trim())) {
      return bad(res, `${idx}.phone is required by carrier (e.g. +1 555 000 0000)`);
    }
  }

  if (currency && !VALID_CURRENCIES.has(currency)) {
    return bad(res, `currency must be one of: ${[...VALID_CURRENCIES].join(', ')}`);
  }

  const amount = parseFloat(totalAmount);
  if (!totalAmount || isNaN(amount) || amount <= 0 || amount > 100000) {
    return bad(res, 'totalAmount must be a positive number (max 100,000)');
  }

  next();
}

// Auth body validators — reuses EMAIL_RE declared above

const authBody = {
  register(req, res, next) {
    const { email, password } = req.body || {};
    if (!email || !EMAIL_RE.test(email)) {
      return res.status(400).json({ success: false, message: 'Valid email is required' });
    }
    if (!password || password.length < 8) {
      return res.status(400).json({ success: false, message: 'Password must be at least 8 characters' });
    }
    if (password.length > 128) {
      return res.status(400).json({ success: false, message: 'Password too long' });
    }
    req.validatedBody = { email: email.toLowerCase().trim(), password };
    next();
  },
  login(req, res, next) {
    const { email, password } = req.body || {};
    if (!email || !EMAIL_RE.test(email)) {
      return res.status(400).json({ success: false, message: 'Valid email is required' });
    }
    if (!password) {
      return res.status(400).json({ success: false, message: 'Password is required' });
    }
    req.validatedBody = { email: email.toLowerCase().trim(), password };
    next();
  },
};

/**
 * Validate GET /api/flights/aircraft-search/stream  query params
 */
function aircraftSearchQuery(req, res, next) {
  const { familyName, city, radius, iata, date, passengers } = req.query;

  if (!familyName || typeof familyName !== 'string' || familyName.trim().length < 3) {
    return bad(res, 'familyName is required (e.g. "Boeing 737")');
  }

  // Must have either city or iata as origin
  if (!city && !iata) {
    return bad(res, 'city or iata (origin airport) is required');
  }

  if (iata && !IATA_RE.test(iata.toUpperCase().trim())) {
    return bad(res, 'iata must be a 2–3 letter airport code');
  }

  if (radius !== undefined) {
    const r = parseInt(radius, 10);
    if (isNaN(r) || r < 10 || r > 2000) {
      return bad(res, 'radius must be between 10 and 2000 km');
    }
  }

  if (date) {
    if (!DATE_RE.test(date)) return bad(res, 'date must be YYYY-MM-DD');
    const d = new Date(date);
    if (isNaN(d.getTime())) return bad(res, 'date is not a valid date');
    const today = new Date(); today.setHours(0, 0, 0, 0);
    if (d < today) return bad(res, 'date must not be in the past');
  }

  const pax = parseInt(passengers, 10);
  if (passengers !== undefined && (isNaN(pax) || pax < 1 || pax > 9)) {
    return bad(res, 'passengers must be between 1 and 9');
  }

  req.validatedQuery = {
    familyName: familyName.trim(),
    city:       city?.trim() || null,
    radius:     radius !== undefined ? parseInt(radius, 10) : 200,
    iata:       iata?.toUpperCase().trim() || null,
    date:       date || null,
    passengers: pax || 1,
  };

  next();
}

/**
 * Validate GET /api/flights/scheduled-aircraft  query params
 * Mirrors searchQuery but tighter: date is required and must be within 180 days.
 */
function scheduledAircraftQuery(req, res, next) {
  const { departure, arrival, date } = req.query;

  if (!departure || !arrival) {
    return bad(res, 'departure and arrival are required');
  }

  const dep = departure.toUpperCase().trim();
  const arr = arrival.toUpperCase().trim();

  if (!IATA_RE.test(dep)) return bad(res, 'departure must be a 2–3 letter IATA code');
  if (!IATA_RE.test(arr)) return bad(res, 'arrival must be a 2–3 letter IATA code');
  if (dep === arr)        return bad(res, 'departure and arrival cannot be the same airport');

  if (!date || !DATE_RE.test(date)) return bad(res, 'date is required as YYYY-MM-DD');
  const d = new Date(`${date}T00:00:00Z`);
  if (isNaN(d.getTime())) return bad(res, 'date is not a valid date');

  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  if (d < today) return bad(res, 'date must not be in the past');

  const maxDate = new Date(today);
  maxDate.setUTCDate(maxDate.getUTCDate() + 180);
  if (d > maxDate) return bad(res, 'date must be within the next 180 days');

  req.validatedQuery = {
    departure: dep,
    arrival:   arr,
    date,
    sanitisedCacheKey: `${dep}:${arr}:${date}`,
  };

  next();
}

module.exports = { searchQuery, exploreQuery, cheapCalendarQuery, bookBody, sanitiseKey, authBody, aircraftSearchQuery, scheduledAircraftQuery };
