'use strict';

const safety      = require('../models/safetyEvents');
const sidecar     = require('../services/sidecarAccidentsClient');
const aircraftSafetyService = require('../services/aircraftSafetyService');
const STR         = require('../services/safety/strings');
const openFlights = require('../services/openFlightsService');

const NINETY_DAYS_MS  = 90 * 24 * 60 * 60 * 1000;
const ONE_YEAR_MS     = 365 * 24 * 60 * 60 * 1000;
const THREE_YEARS_MS  = 3 * 365 * 24 * 60 * 60 * 1000;

function isPro(req) {
  const u = req.user;
  if (!u) return false;
  const tier = u.subscription_tier || 'free';
  if (!tier.startsWith('pro_')) return false;
  if (tier === 'pro_lifetime') return true;
  return Number.isFinite(u.sub_valid_until) && u.sub_valid_until > Date.now();
}

function shapeEvent(row) {
  if (!row) return null;
  return {
    id: row.id,
    source: row.source,
    sourceEventId: row.source_event_id,
    occurredAt: row.occurred_at,
    severity: row.severity,
    severityLabel: STR.severityLabel(row.severity),
    fatalities: row.fatalities,
    injuries: row.injuries,
    hullLoss: !!row.hull_loss,
    cicttCategory: row.cictt_category,
    cicttLabel: STR.cicttLabel(row.cictt_category),
    phaseOfFlight: row.phase_of_flight,
    operator: {
      iata: row.operator_iata,
      icao: row.operator_icao,
      name: row.operator_name,
    },
    aircraft: {
      icaoType: row.aircraft_icao_type,
      registration: row.registration,
    },
    route: { dep: row.dep_iata, arr: row.arr_iata },
    location: {
      country: row.location_country,
      lat: row.location_lat,
      lon: row.location_lon,
    },
    narrative: row.narrative,
    reportUrl: row.report_url,
  };
}

// AirCrash sidecar row → safety_events shaped response. The adapter in
// aircraftSafetyService already lifts the raw row into the right intermediate
// shape; this wrapper just renames/adds the API-facing camelCase fields the
// React detail page expects.
function shapeAircrashEvent(row) {
  if (!row) return null;
  const ev = aircraftSafetyService.adaptAccidentToEvent(row);
  if (!ev) return null;
  return {
    id: ev.id,                          // 'ac_<int>'
    source: ev.source,                  // 'aircrash'
    sourceEventId: ev.source_event_id,
    occurredAt: ev.occurred_at,
    severity: ev.severity,
    severityLabel: STR.severityLabel(ev.severity),
    fatalities: ev.fatalities,
    injuries: null,
    hullLoss: !!ev.hull_loss,
    cicttCategory: null,
    cicttLabel: null,
    phaseOfFlight: null,
    operator: {
      iata: null,
      icao: null,
      name: ev.operator_name,
    },
    aircraft: {
      icaoType: null,
      modelText: ev.aircraft_model_text, // AirCrash carries free-text only
      registration: null,
    },
    route: { dep: null, arr: null },
    location: {
      country: null,
      text: ev.location_text,            // free-text fallback for the UI
      lat: row.lat ?? null,
      lon: row.lon ?? null,
    },
    narrative: null,
    reportUrl: ev.report_url,
  };
}

// NTSB publishes US-only aviation events. For non-US operators the zero-count
// response would mislead users into thinking "no incidents" instead of
// "we don't track this". We surface the coverage state explicitly.
function resolveOperatorCoverage({ iata, icao }) {
  let airline = iata ? openFlights.getAirline(iata) : null;
  if (!airline && icao) {
    airline = openFlights.getAirlineByIcao(icao);
  }
  const country = airline?.country || null;
  const coverage = country === 'United States' ? 'us-ntsb' : 'unknown';
  return { country, coverage };
}

exports.listEvents = (req, res) => {
  const { limit, offset, severity, country } = req.validatedQuery;
  const rows = safety.getRecent({ limit, offset, severity, country });
  res.json({
    success: true,
    count: rows.length,
    limit, offset,
    data: rows.map(shapeEvent),
  });
};

exports.getEvent = (req, res) => {
  const { id, source } = req.validatedParams;
  if (source === 'aircrash') {
    const row = sidecar.getAccidentById(id);
    if (!row) return res.status(404).json({ success: false, message: 'Event not found' });
    return res.json({ success: true, data: shapeAircrashEvent(row) });
  }
  const row = safety.getById(id);
  if (!row) return res.status(404).json({ success: false, message: 'Event not found' });
  res.json({ success: true, data: shapeEvent(row) });
};

exports.getOperator = (req, res) => {
  const { iata, icao } = req.validatedParams;
  const free90 = safety.countByOperator({ iata, icao, sinceMs: Date.now() - NINETY_DAYS_MS });
  const { country, coverage } = resolveOperatorCoverage({ iata, icao });
  const payload = {
    success: true,
    operator: { iata, icao },
    operatorCountry: country,
    coverage,
    period: '90d',
    counts: free90,
  };
  if (isPro(req)) {
    payload.proStats = {
      lastYear:       safety.countByOperator({ iata, icao, sinceMs: Date.now() - ONE_YEAR_MS }),
      lastThreeYears: safety.countByOperator({ iata, icao, sinceMs: Date.now() - THREE_YEARS_MS }),
      recentEvents:   safety.getByOperator({ iata, icao, sinceMs: Date.now() - ONE_YEAR_MS }).map(shapeEvent),
    };
  } else {
    payload.upgrade = { upgradeUrl: '/pricing', cta: STR.paywallCTA };
  }
  res.json(payload);
};

exports.getEventRelated = (req, res) => {
  const { id, source } = req.validatedParams;
  if (source === 'aircrash') {
    const row = sidecar.getAccidentById(id);
    if (!row) return res.status(404).json({ success: false, message: 'Event not found' });
    // AirCrash sidecar has byAircraft + byOperator already (used by NTSB
    // narrative pages); reuse and shape via the AirCrash adapter so the
    // related sidebar still renders meaningful entries.
    const sameAircraftType = sidecar.findRelatedByAircraft(row.aircraft_model || '', row.id)
      .map(shapeAircrashEvent).filter(Boolean);
    const sameOperator = row.operator
      ? sidecar.findRelatedByOperator(row.operator, row.id).map(shapeAircrashEvent).filter(Boolean)
      : [];
    return res.json({
      success: true,
      data: { sameAircraftType, sameOperator, sameAirport: [] },
    });
  }
  const ev = safety.getById(id);
  if (!ev) return res.status(404).json({ success: false, message: 'Event not found' });
  const { buildEventSlug } = require('../utils/eventSlug');
  const result = {
    sameAircraftType: ev.aircraft_icao_type
      ? safety.getByAircraftType(ev.aircraft_icao_type, { exclude: id, limit: 5 }).map(shapeEvent)
      : [],
    sameOperator: (ev.operator_icao || ev.operator_iata)
      ? safety.getByOperator({
          icao: ev.operator_icao,
          iata: ev.operator_iata,
          sinceMs: 0, // all-time
        }).filter(r => r.id !== id).slice(0, 5).map(shapeEvent)
      : [],
    sameAirport: (ev.dep_iata || ev.arr_iata)
      ? safety.getByAirport(ev.dep_iata || ev.arr_iata, { exclude: id, limit: 5 }).map(shapeEvent)
      : [],
  };
  // Augment each related event with slug for client routing.
  // Re-fetch raw row for slug construction (≤15 lookups/page load — acceptable cost).
  for (const list of [result.sameAircraftType, result.sameOperator, result.sameAirport]) {
    for (const e of list) {
      const raw = safety.getById(e.id);
      if (raw) e.slug = buildEventSlug(raw);
    }
  }
  res.json({ success: true, data: result });
};

exports.getAircraft = (req, res) => {
  const { registration } = req.validatedParams;
  const events = safety.getByRegistration(registration, Date.now() - 10 * ONE_YEAR_MS);
  res.json({
    success: true,
    registration,
    count: events.length,
    data: events.map(shapeEvent),
  });
};
