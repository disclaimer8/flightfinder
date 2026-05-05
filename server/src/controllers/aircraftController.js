const aircraftData = require('../models/aircraftData');
const { resolveFamily, slugify, families: famDict, getFamilyList } = require('../models/aircraftFamilies');
const openFlights  = require('../services/openFlightsService');
const geocoding    = require('../services/geocodingService');
const cacheService = require('../services/cacheService');
const db           = require('../models/db');
const safety       = require('../models/safetyEvents');

exports.getAllAircraft = (req, res) => {
  const aircraft = Object.entries(aircraftData).map(([code, data]) => ({
    code,
    ...data
  }));

  res.json({
    success: true,
    count: aircraft.length,
    data: aircraft
  });
};

exports.getAircraftByCode = (req, res) => {
  const { iataCode } = req.params;
  const aircraft = aircraftData[iataCode.toUpperCase()];

  if (!aircraft) {
    return res.status(404).json({
      success: false,
      message: 'Aircraft not found'
    });
  }

  res.json({
    success: true,
    data: {
      code: iataCode.toUpperCase(),
      ...aircraft
    }
  });
};

/**
 * GET /api/aircraft/routes?family=<slug>&origins=PRG,VIE&windowDays=14
 * Backs the "map-as-output" by-aircraft search — returns observed routes for
 * the chosen family from the chosen origins within a rolling window.
 * See project spec; route is registered before /:iataCode catchall.
 */
exports.getAircraftRoutes = async (req, res) => {
  const { family: famInput, origins: requested, windowDays } = req.validatedQuery;

  const fam = resolveFamily(famInput);
  if (!fam) return res.status(400).json({ success: false, message: 'unknown aircraft family' });
  const slug = slugify(fam.name);

  const globalMode = !requested || requested.length === 0;

  // Resolve requested IATAs to airports; drop unknown silently.
  const origins = [];
  if (!globalMode) {
    for (const iata of requested) {
      const ap = openFlights.getAirport(iata);
      if (ap && ap.lat != null && ap.lon != null) {
        origins.push({ iata: ap.iata, lat: ap.lat, lon: ap.lon, name: ap.name });
      }
    }
    if (origins.length === 0) {
      return res.status(400).json({ success: false, message: 'no valid origins' });
    }
  }

  const originIatas = origins.map(o => o.iata);
  const cacheKey = `aircraft-routes:v2:${slug}:${[...originIatas].sort().join(',')}:${windowDays}${globalMode ? ':GLOBAL' : ''}`;

  try {
    const { data } = await cacheService.getOrFetch(cacheKey, async () => {
      const cutoffMs = Date.now() - windowDays * 24 * 60 * 60 * 1000;
      const rows = db.getAircraftRoutes({ icaoList: fam.icaoList, origins: originIatas, cutoffMs });

      const routes = rows.map(r => ({
        dep:       r.dep,
        arr:       r.arr,
        icaoTypes: (r.icaoTypes || '').split(',').filter(Boolean).sort(),
        count:     r.count,
        lastSeen:  new Date(r.lastSeen).toISOString(),
      }));

      // Build a dictionary of every airport referenced by routes[] so the
      // client can render dots without a second /api/map/airports roundtrip.
      // Include origins even if they have no routes (for the origin dots).
      const airportsMap = new Map();
      for (const o of origins) {
        airportsMap.set(o.iata, { iata: o.iata, lat: o.lat, lon: o.lon, name: o.name });
      }
      for (const r of routes) {
        for (const iata of [r.dep, r.arr]) {
          if (airportsMap.has(iata)) continue;
          const ap = openFlights.getAirport(iata);
          if (ap && ap.lat != null && ap.lon != null) {
            airportsMap.set(iata, { iata: ap.iata, lat: ap.lat, lon: ap.lon, name: ap.name });
          }
        }
      }
      const airports = [...airportsMap.values()];

      // In global mode, synthesise origins[] from the top unique `dep` airports
      // that appeared in the results, ranked by total route count. This gives
      // the client a stable palette assignment without asking the user.
      let outOrigins = origins.map(o => ({ iata: o.iata, lat: o.lat, lon: o.lon, name: o.name }));
      if (globalMode && routes.length > 0) {
        const depCounts = new Map();
        for (const r of routes) {
          depCounts.set(r.dep, (depCounts.get(r.dep) || 0) + r.count);
        }
        const topDeps = [...depCounts.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10)
          .map(([iata]) => iata);
        outOrigins = topDeps
          .map(iata => airportsMap.get(iata))
          .filter(Boolean)
          .map(a => ({ iata: a.iata, lat: a.lat, lon: a.lon, name: a.name }));
      }

      let suggestions = [];
      if (!globalMode && routes.length === 0) {
        // Find up to 5 nearby airports (within 1000 km of any origin) that DO
        // have routes for this family in the same window.
        const seen  = new Set(originIatas);
        const cand  = [];
        for (const o of origins) {
          const nearby = geocoding.nearbyAirports(o.lat, o.lon, 1000, 30);
          for (const n of nearby) {
            if (seen.has(n.iata)) continue;
            seen.add(n.iata);
            const routeCount = db.countFamilyRoutesFromOrigin({
              icaoList: fam.icaoList, origin: n.iata, cutoffMs,
            });
            if (routeCount > 0) {
              cand.push({
                iata:       n.iata,
                name:       n.name,
                distanceKm: n.distanceKm,
                routeCount,
              });
            }
            if (cand.length >= 25) break; // bound work for cold caches
          }
          if (cand.length >= 25) break;
        }
        cand.sort((a, b) => b.routeCount - a.routeCount || a.distanceKm - b.distanceKm);
        suggestions = cand.slice(0, 5);
      }

      return {
        family:      slug,
        familyName:  fam.family.label || fam.name,
        icaoTypes:   fam.icaoList.slice().sort(),
        windowDays,
        origins:     outOrigins,
        airports,
        routes,
        suggestions,
        global:      globalMode,
      };
    }, 1800);

    res.json(data);
  } catch (err) {
    console.error('[aircraft] getAircraftRoutes error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to fetch aircraft routes' });
  }
};

exports.getAircraftByType = (req, res) => {
  const { type } = req.params;

  const filtered = Object.entries(aircraftData)
    .filter(([, data]) => data.type === type.toLowerCase())
    .map(([code, data]) => ({
      code,
      ...data
    }));

  res.json({
    success: true,
    count: filtered.length,
    data: filtered
  });
};

exports.getIndexStats = (_req, res) => {
  const cacheKey = 'aircraft:index-stats';
  const cached = cacheService.get(cacheKey);
  if (cached) return res.json(cached);

  try {
    const sinceMs90d = Date.now() - 90 * 86400000;
    const sinceMs14d = Date.now() - 14 * 86400000;
    const list = getFamilyList();
    const stats = {};
    const popularRaw = [];

    for (const fam of list) {
      const fd = famDict[fam.label] || famDict[fam.name] || {};
      const codes = fd.codes ? Array.from(fd.codes) : [];
      if (codes.length === 0) continue;

      const routeCount     = db.countRoutesByAircraft(codes, sinceMs90d);
      const operatorCount  = db.countOperatorsByAircraft(codes, sinceMs90d);
      const safetyCount90d = safety.countByAircraftCodes(codes, sinceMs90d);
      const routes14d      = db.countRoutesByAircraft(codes, sinceMs14d);

      stats[fam.slug] = { routeCount, operatorCount, safetyCount90d };
      popularRaw.push({ slug: fam.slug, label: fam.label, routes14d });
    }

    const popular = popularRaw
      .filter(p => p.routes14d > 0)
      .sort((a, b) => b.routes14d - a.routes14d)
      .slice(0, 8);

    const payload = { success: true, stats, popular };
    cacheService.set(cacheKey, payload, 60 * 60 * 1000);
    res.json(payload);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
