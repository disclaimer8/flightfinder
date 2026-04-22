'use strict';

const openFlights = require('./openFlightsService');
const ourAirports = require('./ourAirportsService');

const THRESHOLD_DEG = 0.05; // ≈ 5.5 km at equator

function greatCircleKm(lat1, lon1, lat2, lon2) {
  const R = 6371, toRad = (d) => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// One-shot audit — runs after both services are loaded. Logs only; does not
// mutate either dataset. Intended for ops-level awareness, not runtime behaviour.
function runAudit({ sampleSize = 500 } = {}) {
  if (!ourAirports.isLoaded()) return { checked: 0, conflicts: 0 };
  const openFlightsAll = openFlights.getAllAirports ? openFlights.getAllAirports() : [];
  if (!openFlightsAll.length) return { checked: 0, conflicts: 0 };
  const sample = openFlightsAll.slice(0, sampleSize);
  let conflicts = 0;
  for (const of of sample) {
    const oa = ourAirports.getAirport(of.iata);
    if (!oa || !Number.isFinite(oa.lat) || !Number.isFinite(of.lat)) continue;
    const dLat = Math.abs(oa.lat - of.lat);
    const dLon = Math.abs(oa.lon - of.lon);
    if (dLat > THRESHOLD_DEG || dLon > THRESHOLD_DEG) {
      conflicts++;
      const km = greatCircleKm(oa.lat, oa.lon, of.lat, of.lon).toFixed(1);
      console.warn(
        `[airport-validation] ${of.iata}: OurAirports=${oa.lat.toFixed(3)},${oa.lon.toFixed(3)} ` +
        `vs OpenFlights=${of.lat.toFixed(3)},${of.lon.toFixed(3)} (Δ ${km}km)`
      );
    }
  }
  console.log(`[airport-validation] audit: checked=${sample.length} conflicts=${conflicts}`);
  return { checked: sample.length, conflicts };
}

module.exports = { runAudit };
