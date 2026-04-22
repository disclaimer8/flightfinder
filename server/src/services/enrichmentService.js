'use strict';

const openFlights      = require('./openFlightsService');      // airports + airlines
const aerodatabox      = require('./aerodataboxService');
const openWeather      = require('./openWeatherService');      // defineDataSource
const liveries         = require('./wikimediaLiveryService');  // defineDataSource
const amenities        = require('./amenitiesService');
const fleet            = require('../models/fleet');
const { predictDelay } = require('./delayPredictionService');
const { co2PerPax, greatCircleKm } = require('./co2Service');
const obsModel         = require('../models/observations');

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

// Input: { id, airline, flightNumber, departure:{code}, arrival:{code}, aircraft:{icaoType?, registration?} }
async function enrichFlight(flight) {
  const [weatherOrigin, weatherDest, livery, gateInfo] = await Promise.all([
    safeWeatherForIata(flight.departure?.code),
    safeWeatherForIata(flight.arrival?.code),
    safeLivery(flight.airline, flight.aircraft?.icaoType),
    safeGateInfo(flight.airline, flight.flightNumber),
  ]);

  const onTime = computeOnTimeStats({
    airline: flight.airline,
    flightNumber: flight.flightNumber,
    dep: flight.departure?.code,
    arr: flight.arrival?.code,
  });

  const prediction = predictDelay({
    airline: flight.airline,
    flightNumber: flight.flightNumber,
    dep: flight.departure?.code,
    arr: flight.arrival?.code,
  });

  const co2 = computeCo2(flight);
  const am = amenities.getAmenities(flight.airline, flight.aircraft?.icaoType);

  const tailInfo = flight.aircraft?.registration
    ? fleet.getByRegistration(flight.aircraft.registration)
    : null;

  return {
    livery: livery ? { imageUrl: livery.image_url, attribution: livery.attribution } : null,
    aircraft: tailInfo ? {
      registration: tailInfo.registration,
      icaoType: tailInfo.icao_type,
      buildYear: tailInfo.build_year,
      ageYears: tailInfo.build_year ? new Date().getFullYear() - tailInfo.build_year : null,
    } : null,
    onTime,
    delayForecast: prediction,
    co2,
    amenities: am,
    gate: gateInfo,
    weather: { origin: weatherOrigin, destination: weatherDest },
  };
}

function computeOnTimeStats({ airline, flightNumber, dep, arr }) {
  const since = Date.now() - NINETY_DAYS_MS;
  const rows = obsModel.getByExactFlight(airline, flightNumber, since);
  const delays = rows.length >= 10 ? rows : obsModel.getByRouteAirline(dep, arr, airline, since);
  if (delays.length < 10) return null;
  const nums = delays.map(r => r.delay_minutes);
  const onTime = nums.filter(d => d < 15).length;
  const sorted = [...nums].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length * 0.5)];
  const p75    = sorted[Math.floor(sorted.length * 0.75)];
  return {
    pct90d: Math.round((onTime / nums.length) * 100),
    medianDelay: median,
    p75Delay: p75,
    sample: nums.length,
    confidence: nums.length >= 30 ? 'high' : 'medium',
    scope: rows.length >= 10 ? 'exact-flight' : 'route-airline',
  };
}

function computeCo2(flight) {
  const type = flight.aircraft?.icaoType;
  if (!type) return null;
  const dep = openFlights.getAirport(flight.departure?.code);
  const arr = openFlights.getAirport(flight.arrival?.code);
  if (!dep || !arr || !Number.isFinite(dep.lat) || !Number.isFinite(arr.lat)) return null;
  const km = greatCircleKm(dep.lat, dep.lon, arr.lat, arr.lon);
  const kg = co2PerPax({ icaoType: type, distanceKm: km });
  if (kg == null) return null;
  return { kgPerPax: kg, distanceKm: Math.round(km) };
}

async function safeWeatherForIata(iata) {
  try {
    const a = openFlights.getAirport(iata);
    if (!a || !Number.isFinite(a.lat) || !Number.isFinite(a.lon)) return null;
    return await openWeather.fetch({ lat: a.lat, lon: a.lon });
  } catch (err) {
    console.warn('[enrich] weather fail:', err.message);
    return null;
  }
}

async function safeLivery(airlineIata, icaoType) {
  if (!airlineIata || !icaoType) return null;
  try {
    const airline = openFlights.getAirline(airlineIata);
    const airlineName = airline?.name || airlineIata;
    return await liveries.fetch({ airlineIata, icaoType, airlineName });
  } catch (err) {
    console.warn('[enrich] livery fail:', err.message);
    return null;
  }
}

async function safeGateInfo(airline, flightNumber) {
  if (!aerodatabox.isEnabled?.() || !airline || !flightNumber) return null;
  try {
    const today = new Date().toISOString().slice(0, 10);
    const f = await aerodatabox.getFlightByNumber(`${airline}${flightNumber}`, today);
    if (!f) return null;
    return {
      originTerminal: f.departure?.terminal || null,
      originGate:     f.departure?.gate || null,
      destTerminal:   f.arrival?.terminal || null,
      destGate:       f.arrival?.gate || null,
    };
  } catch (err) {
    console.warn('[enrich] gate fail:', err.message);
    return null;
  }
}

module.exports = { enrichFlight };
