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
};
