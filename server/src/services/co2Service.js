'use strict';

// ICAO-style simplified fuel-burn table, kg-fuel per km per aircraft.
// Seat counts are typical 1-class equivalents. Sources: IATA/ICAO publications
// and manufacturer spec sheets; v1 approximation — not a certified footprint.
const FLEET = {
  // narrow-body
  'A319': { fuelKgPerKm: 3.2,  seats: 124 },
  'A320': { fuelKgPerKm: 3.9,  seats: 150 },
  'A321': { fuelKgPerKm: 4.2,  seats: 185 },
  'A19N': { fuelKgPerKm: 2.8,  seats: 124 },
  'A20N': { fuelKgPerKm: 3.2,  seats: 150 },
  'A21N': { fuelKgPerKm: 3.7,  seats: 185 },
  'B737': { fuelKgPerKm: 3.4,  seats: 130 },
  'B738': { fuelKgPerKm: 3.7,  seats: 162 },
  'B739': { fuelKgPerKm: 3.9,  seats: 178 },
  'B38M': { fuelKgPerKm: 3.1,  seats: 162 },
  'B39M': { fuelKgPerKm: 3.3,  seats: 178 },
  'BCS1': { fuelKgPerKm: 2.9,  seats: 110 },
  'BCS3': { fuelKgPerKm: 3.1,  seats: 130 },
  // wide-body
  'A332': { fuelKgPerKm: 5.6,  seats: 247 },
  'A333': { fuelKgPerKm: 5.9,  seats: 277 },
  'A338': { fuelKgPerKm: 5.0,  seats: 247 },
  'A339': { fuelKgPerKm: 5.3,  seats: 287 },
  'A342': { fuelKgPerKm: 6.5,  seats: 263 },
  'A343': { fuelKgPerKm: 6.9,  seats: 295 },
  'A345': { fuelKgPerKm: 7.6,  seats: 313 },
  'A346': { fuelKgPerKm: 8.0,  seats: 380 },
  'A359': { fuelKgPerKm: 5.8,  seats: 315 },
  'A35K': { fuelKgPerKm: 6.4,  seats: 369 },
  'A388': { fuelKgPerKm: 11.5, seats: 555 },
  'B763': { fuelKgPerKm: 5.1,  seats: 218 },
  'B764': { fuelKgPerKm: 5.4,  seats: 245 },
  'B772': { fuelKgPerKm: 7.3,  seats: 305 },
  'B77W': { fuelKgPerKm: 8.0,  seats: 365 },
  'B773': { fuelKgPerKm: 7.7,  seats: 365 },
  'B788': { fuelKgPerKm: 5.2,  seats: 242 },
  'B789': { fuelKgPerKm: 5.5,  seats: 290 },
  'B78X': { fuelKgPerKm: 6.0,  seats: 330 },
  'B748': { fuelKgPerKm: 10.9, seats: 467 },
  // regional
  'E170': { fuelKgPerKm: 1.6,  seats: 72  },
  'E190': { fuelKgPerKm: 1.9,  seats: 100 },
  'E195': { fuelKgPerKm: 2.0,  seats: 120 },
  'E290': { fuelKgPerKm: 1.5,  seats: 100 },
  'E295': { fuelKgPerKm: 1.7,  seats: 132 },
  'CRJ7': { fuelKgPerKm: 1.3,  seats: 70  },
  'CRJ9': { fuelKgPerKm: 1.4,  seats: 90  },
  'DH8D': { fuelKgPerKm: 1.1,  seats: 78  },
  'AT72': { fuelKgPerKm: 0.9,  seats: 70  },
  'AT76': { fuelKgPerKm: 1.0,  seats: 78  },
};

const CO2_PER_KG_FUEL = 3.16; // EEA jet-A1 emissions factor

function greatCircleKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = (deg) => deg * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat/2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon/2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function co2PerPax({ icaoType, distanceKm }) {
  if (!Number.isFinite(distanceKm) || distanceKm <= 0) return null;
  const spec = FLEET[icaoType?.toUpperCase()];
  if (!spec) return null;
  const totalFuelKg = distanceKm * spec.fuelKgPerKm;
  const totalCo2Kg  = totalFuelKg * CO2_PER_KG_FUEL;
  return Math.round((totalCo2Kg / spec.seats) * 10) / 10;
}

module.exports = { co2PerPax, greatCircleKm, FLEET };
