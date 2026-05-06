'use strict';
const { db } = require('./db');

const stmts = {
  upsert: db.prepare(`
    INSERT INTO safety_events
      (source, source_event_id, occurred_at, severity, fatalities, injuries,
       hull_loss, cictt_category, phase_of_flight, operator_iata, operator_icao,
       operator_name, aircraft_icao_type, registration, dep_iata, arr_iata,
       location_country, location_lat, location_lon, narrative, report_url,
       ingested_at, updated_at)
    VALUES
      (@source, @source_event_id, @occurred_at, @severity, @fatalities, @injuries,
       @hull_loss, @cictt_category, @phase_of_flight, @operator_iata, @operator_icao,
       @operator_name, @aircraft_icao_type, @registration, @dep_iata, @arr_iata,
       @location_country, @location_lat, @location_lon, @narrative, @report_url,
       @ingested_at, @updated_at)
    ON CONFLICT(source, source_event_id) DO UPDATE SET
      occurred_at        = excluded.occurred_at,
      severity           = excluded.severity,
      fatalities         = excluded.fatalities,
      injuries           = excluded.injuries,
      hull_loss          = excluded.hull_loss,
      cictt_category     = excluded.cictt_category,
      phase_of_flight    = excluded.phase_of_flight,
      operator_iata      = COALESCE(excluded.operator_iata,      safety_events.operator_iata),
      operator_icao      = COALESCE(excluded.operator_icao,      safety_events.operator_icao),
      operator_name      = COALESCE(excluded.operator_name,      safety_events.operator_name),
      aircraft_icao_type = COALESCE(excluded.aircraft_icao_type, safety_events.aircraft_icao_type),
      registration       = COALESCE(excluded.registration,       safety_events.registration),
      dep_iata           = COALESCE(excluded.dep_iata,           safety_events.dep_iata),
      arr_iata           = COALESCE(excluded.arr_iata,           safety_events.arr_iata),
      location_country   = COALESCE(excluded.location_country,   safety_events.location_country),
      location_lat       = COALESCE(excluded.location_lat,       safety_events.location_lat),
      location_lon       = COALESCE(excluded.location_lon,       safety_events.location_lon),
      narrative          = COALESCE(excluded.narrative,          safety_events.narrative),
      report_url         = excluded.report_url,
      updated_at         = excluded.updated_at
  `),
  recent: db.prepare(`
    SELECT * FROM safety_events
    WHERE (@severity IS NULL OR severity = @severity)
      AND (@country  IS NULL OR location_country = @country)
    ORDER BY occurred_at DESC
    LIMIT @limit OFFSET @offset
  `),
  byId: db.prepare('SELECT * FROM safety_events WHERE id = ?'),
  byOperatorIcao: db.prepare(`
    SELECT * FROM safety_events
    WHERE operator_icao = ? AND occurred_at >= ?
    ORDER BY occurred_at DESC
    LIMIT 100
  `),
  byOperatorIata: db.prepare(`
    SELECT * FROM safety_events
    WHERE operator_iata = ? AND occurred_at >= ?
    ORDER BY occurred_at DESC
    LIMIT 100
  `),
  byRegistration: db.prepare(`
    SELECT * FROM safety_events
    WHERE registration = ? AND occurred_at >= ?
    ORDER BY occurred_at DESC
    LIMIT 100
  `),
  countByOperatorIata: db.prepare(`
    SELECT severity, COUNT(*) AS n
    FROM safety_events
    WHERE operator_iata = ? AND occurred_at >= ?
    GROUP BY severity
  `),
  countByOperatorIcao: db.prepare(`
    SELECT severity, COUNT(*) AS n
    FROM safety_events
    WHERE operator_icao = ? AND occurred_at >= ?
    GROUP BY severity
  `),
  countTotal: db.prepare('SELECT COUNT(*) AS n FROM safety_events'),
  countByAircraftCode: db.prepare(`
    SELECT COUNT(*) AS n FROM safety_events
    WHERE aircraft_icao_type = ? AND occurred_at >= ?
  `),

  // Related events: by aircraft ICAO type
  byAircraftType: db.prepare(`
    SELECT * FROM safety_events
    WHERE aircraft_icao_type = @aircraft AND id != @exclude
    ORDER BY occurred_at DESC
    LIMIT @limit
  `),
  // Related events: by airport (dep_iata or arr_iata)
  byAirport: db.prepare(`
    SELECT * FROM safety_events
    WHERE (dep_iata = @airport OR arr_iata = @airport) AND id != @exclude
    ORDER BY occurred_at DESC
    LIMIT @limit
  `),
  // Quality-gated indexable events for sitemap.
  // Includes events where: severity='fatal' OR hull_loss=1.
  // Sub-conditions (narrative, related count) evaluated in app code to keep SQL portable.
  indexableCandidates: db.prepare(`
    SELECT * FROM safety_events
    WHERE severity = 'fatal' OR hull_loss = 1
    ORDER BY occurred_at DESC
    LIMIT @limit
  `),
  countByAircraftType: db.prepare(`
    SELECT COUNT(*) AS n FROM safety_events
    WHERE aircraft_icao_type = ? AND id != ?
  `),
  countByOperatorIcaoSimple: db.prepare(`
    SELECT COUNT(*) AS n FROM safety_events
    WHERE operator_icao = ? AND id != ?
  `),
  countByAirport: db.prepare(`
    SELECT COUNT(*) AS n FROM safety_events
    WHERE (dep_iata = ? OR arr_iata = ?) AND id != ?
  `),
};

const upsertMany = db.transaction((rows) => {
  let n = 0;
  for (const r of rows) {
    if (!r) continue;
    stmts.upsert.run(r);
    n++;
  }
  return n;
});

module.exports = {
  upsertEvent(row) { return stmts.upsert.run(row); },
  upsertMany,

  getRecent({ limit = 50, offset = 0, severity = null, country = null } = {}) {
    return stmts.recent.all({
      limit:  Math.min(Math.max(Number(limit) || 50, 1), 200),
      offset: Math.max(Number(offset) || 0, 0),
      severity, country,
    });
  },
  getById(id) { return stmts.byId.get(id); },

  getByOperator({ iata, icao, sinceMs }) {
    if (iata) return stmts.byOperatorIata.all(String(iata).toUpperCase(), sinceMs);
    if (icao) return stmts.byOperatorIcao.all(String(icao).toUpperCase(), sinceMs);
    return [];
  },
  getByRegistration(reg, sinceMs) {
    if (!reg) return [];
    return stmts.byRegistration.all(String(reg).toUpperCase(), sinceMs);
  },

  /**
   * Returns { fatal, hull_loss, serious_incident, incident, minor, unknown, total }.
   * Used by GET /api/safety/operators/:icao for the free 90d count tile and by
   * <OperatorSafetyBlock>.
   */
  countByOperator({ iata, icao, sinceMs }) {
    let rows = [];
    if (iata) rows = stmts.countByOperatorIata.all(String(iata).toUpperCase(), sinceMs);
    else if (icao) rows = stmts.countByOperatorIcao.all(String(icao).toUpperCase(), sinceMs);
    const base = { fatal: 0, hull_loss: 0, serious_incident: 0, incident: 0, minor: 0, unknown: 0, total: 0 };
    for (const r of rows) {
      base[r.severity] = r.n;
      base.total += r.n;
    }
    return base;
  },

  getStats() { return { total: stmts.countTotal.get().n }; },

  countByAircraftCodes(codes, sinceMs) {
    let total = 0;
    for (const code of codes) {
      total += stmts.countByAircraftCode.get(code, sinceMs)?.n ?? 0;
    }
    return total;
  },

  getByAircraftType(aircraft, { exclude = 0, limit = 5 } = {}) {
    if (!aircraft) return [];
    // Accept array (e.g. [id]) or scalar for exclude; use first element or 0
    const excludeId = Array.isArray(exclude) ? (Number(exclude[0]) || 0) : (Number(exclude) || 0);
    return stmts.byAircraftType.all({
      aircraft: String(aircraft).toUpperCase(),
      exclude:  excludeId,
      limit:    Math.min(Math.max(Number(limit) || 5, 1), 50),
    });
  },

  getByAirport(airport, { exclude = 0, limit = 5 } = {}) {
    if (!airport) return [];
    const excludeId = Array.isArray(exclude) ? (Number(exclude[0]) || 0) : (Number(exclude) || 0);
    return stmts.byAirport.all({
      airport: String(airport).toUpperCase(),
      exclude: excludeId,
      limit:   Math.min(Math.max(Number(limit) || 5, 1), 50),
    });
  },

  /**
   * Quality-gated indexable events — for sitemap inclusion.
   * Must be fatal or hull_loss, AND have narrative OR ≥3 events on same
   * aircraft type OR ≥3 events with same operator OR ≥3 events at same airport.
   */
  listIndexable({ limit = 500 } = {}) {
    const candidates = stmts.indexableCandidates.all({
      limit: Math.min(Math.max(Number(limit) * 4, 100), 5000), // overfetch ~4x to allow filtering
    });
    const out = [];
    for (const ev of candidates) {
      if (out.length >= limit) break;
      const hasNarrative = ev.narrative && ev.narrative.length > 50;
      if (hasNarrative) { out.push(ev); continue; }
      const acCount = ev.aircraft_icao_type ? stmts.countByAircraftType.get(ev.aircraft_icao_type, ev.id)?.n || 0 : 0;
      if (acCount >= 3) { out.push(ev); continue; }
      const opCount = ev.operator_icao ? stmts.countByOperatorIcaoSimple.get(ev.operator_icao, ev.id)?.n || 0 : 0;
      if (opCount >= 3) { out.push(ev); continue; }
      const apCount = (ev.dep_iata || ev.arr_iata) ? stmts.countByAirport.get(ev.dep_iata || ev.arr_iata, ev.dep_iata || ev.arr_iata, ev.id)?.n || 0 : 0;
      if (apCount >= 3) { out.push(ev); continue; }
    }
    return out;
  },

  getRelatedEventsCount(eventId) {
    const ev = stmts.byId.get(eventId);
    if (!ev) return 0;
    let count = 0;
    if (ev.aircraft_icao_type) {
      count += stmts.countByAircraftType.get(ev.aircraft_icao_type, eventId)?.n || 0;
    }
    if (ev.operator_icao) {
      count += stmts.countByOperatorIcaoSimple.get(ev.operator_icao, eventId)?.n || 0;
    }
    const airport = ev.dep_iata || ev.arr_iata;
    if (airport) {
      count += stmts.countByAirport.get(airport, airport, eventId)?.n || 0;
    }
    return count;
  },
};
