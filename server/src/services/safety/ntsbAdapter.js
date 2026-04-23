'use strict';

const axios = require('axios');
const { normalizeSeverity, isHullLoss } = require('./severity');
const { mapCicttCategory, mapPhaseOfFlight } = require('./cicttCategory');
const openFlights = require('../openFlightsService');
const faaRegistry = require('../../models/faaRegistry');
const { resolveIcaoType } = require('./faaModelToIcao');

const ENDPOINT = 'https://data.ntsb.gov/carol-main-public/api/Query/Main';

/**
 * NTSB airport IDs are ICAO codes (KLAX US, CYUL Canada, 4-letter elsewhere) or
 * 3-letter IATA for some small US airports. Convert to IATA via OpenFlights
 * lookups; return null when unresolved.
 */
function airportIdToIata(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const code = raw.trim().toUpperCase();
  if (!code) return null;
  if (code.length === 3) {
    const a = openFlights.getAirport(code);
    return a ? code : null;
  }
  if (code.length === 4) {
    const iata = openFlights.iataForIcao?.(code);
    if (iata) return iata;
  }
  return null;
}

/**
 * Map a single NTSB row to a safety_events row. Returns null when the event
 * cannot be uniquely identified (no EventID).
 */
function mapToSafetyEvent(raw, observedAt) {
  if (!raw || typeof raw !== 'object') return null;
  const eventId = String(raw.EventID || '').trim();
  if (!eventId) return null;

  const severity    = normalizeSeverity(raw);
  const cictt       = mapCicttCategory(raw.OccurrenceType);
  const phase       = mapPhaseOfFlight(raw.PhaseOfFlight);
  const fatalities  = Number(raw.TotalFatalInjuries)   || 0;
  const seriousInj  = Number(raw.TotalSeriousInjuries) || 0;
  const minorInj    = Number(raw.TotalMinorInjuries)   || 0;
  const injuries    = seriousInj + minorInj;
  const dmg         = String(raw.AircraftDamage || '').trim().toLowerCase();
  const hullLoss    = (isHullLoss(severity) || (severity === 'fatal' && dmg === 'destroyed')) ? 1 : 0;

  const occurredAtMs = (() => {
    const t = Date.parse(raw.EventDate);
    return Number.isFinite(t) ? t : observedAt;
  })();

  // Resolve ICAO aircraft type for US N-number registrations via FAA Registry.
  // Falls back to null when the tail isn't in the registry or MFR+MODEL isn't mapped.
  let aircraftIcaoType = null;
  const regRaw = raw.AircraftRegistration ? String(raw.AircraftRegistration).toUpperCase() : null;
  if (regRaw && /^N[A-Z0-9]{1,5}$/.test(regRaw)) {
    const faaRow = faaRegistry.getByNNumber(regRaw);
    if (faaRow) {
      aircraftIcaoType = resolveIcaoType(faaRow.manufacturer, faaRow.model);
    }
  }

  return {
    source:             'ntsb',
    source_event_id:    eventId,
    occurred_at:        occurredAtMs,
    severity,
    fatalities,
    injuries,
    hull_loss:          hullLoss,
    cictt_category:     cictt,
    phase_of_flight:    phase,
    operator_iata:      raw.OperatorIATA || null,
    operator_icao:      raw.OperatorICAO || null,
    operator_name:      raw.OperatorName || null,
    aircraft_icao_type: aircraftIcaoType,
    registration:       regRaw,
    dep_iata:           airportIdToIata(raw.DepartureAirport),
    arr_iata:           airportIdToIata(raw.DestinationAirport),
    location_country:   raw.EventCountry || null,
    location_lat:       Number.isFinite(raw.Latitude)  ? raw.Latitude  : null,
    location_lon:       Number.isFinite(raw.Longitude) ? raw.Longitude : null,
    narrative:          raw.ProbableCause || null,
    report_url:         `https://data.ntsb.gov/carol-main-public/basic-search/Event/${encodeURIComponent(eventId)}`,
    ingested_at:        observedAt,
    updated_at:         observedAt,
  };
}

/**
 * Fetch one page from NTSB CAROL aviation search.
 * @returns {Promise<{rows: Array, hasMore: boolean}>}
 */
async function fetchPage({ sinceDays = 30, page = 0, pageSize = 50 }) {
  const dateFrom = new Date(Date.now() - sinceDays * 24 * 3600 * 1000)
    .toISOString().slice(0, 10);

  const body = {
    ResultSetSize: pageSize,
    ResultSetOffset: page * pageSize,
    QueryGroups: [
      {
        QueryRules: [
          { RuleType: 'Simple', Values: ['Aviation'], Columns: ['Event.Mode'], Operator: 'is' },
          { RuleType: 'Simple', Values: [dateFrom],   Columns: ['Event.EventDate'], Operator: 'isOnOrAfter' },
        ],
      },
    ],
    SortColumn: 'Event.EventDate',
    SortDescending: true,
  };

  const res = await axios.post(ENDPOINT, body, {
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    timeout: 30_000,
    validateStatus: () => true,
  });
  if (res.status !== 200) {
    throw new Error(`NTSB CAROL returned ${res.status}`);
  }
  const list = Array.isArray(res.data?.ResultList) ? res.data.ResultList : [];
  return { rows: list, hasMore: list.length >= pageSize };
}

module.exports = { fetchPage, mapToSafetyEvent };
