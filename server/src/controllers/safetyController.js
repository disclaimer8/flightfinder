'use strict';

const safety = require('../models/safetyEvents');
const STR    = require('../services/safety/strings');

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
  const row = safety.getById(req.validatedParams.id);
  if (!row) return res.status(404).json({ success: false, message: 'Event not found' });
  res.json({ success: true, data: shapeEvent(row) });
};

exports.getOperator = (req, res) => {
  const { iata, icao } = req.validatedParams;
  const free90 = safety.countByOperator({ iata, icao, sinceMs: Date.now() - NINETY_DAYS_MS });
  const payload = {
    success: true,
    operator: { iata, icao },
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
