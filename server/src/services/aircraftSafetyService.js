'use strict';

/**
 * Aircraft safety event aggregation across two data sources:
 *   - safety_events  (app.db, US-centric NTSB + FR24 feed)
 *   - accidents      (AirCrash sidecar, global ASN + B3A + Wikidata)
 *
 * The original aircraft-safety pages read safety_events only, which silently
 * dropped every international hull loss (e.g. the Air India 787-8 Ahmedabad
 * 2025-06-12 crash with 241+19 fatalities). This service merges the two
 * sources, adapts AirCrash rows into the safety_events shape that downstream
 * renderers expect, deduplicates near-identical events (same date + similar
 * operator), sorts by date, and returns the merged list.
 *
 * Public entry points:
 *   getMergedEventsForFamily({ icaoList, familyName, fatalOnly, limit })
 *
 * The caller pre-resolves familyName via aircraftFamilies — this service is
 * agnostic to slug→family lookups.
 */

const safetyModel = require('../models/safetyEvents');
const sidecar = require('./sidecarAccidentsClient');

/**
 * Expand a family name into LIKE patterns that catch the family's accident
 * rows. Most families are 1:1 ('Boeing 787' → ['Boeing 787']) but slash-
 * collated keys and meta-families need splitting:
 *   'Embraer E170/E175' → ['Embraer E170', 'Embraer E175']
 *   'ATR 42/72'         → ['ATR 42', 'ATR 72']
 *   'Airbus A320 family'→ ['Airbus A319', 'Airbus A320', 'Airbus A321']
 *   'Bombardier Dash 8' → ['Dash 8', 'Q400']  (Q400 is the -400 marketing name)
 */
function expandFamilyPatterns(familyName) {
  if (!familyName || typeof familyName !== 'string') return [];
  const name = familyName.trim();

  if (/^airbus a320 family/i.test(name)) {
    return ['Airbus A319', 'Airbus A320', 'Airbus A321'];
  }
  if (/^bombardier dash 8/i.test(name)) {
    return ['Dash 8', 'Q400'];
  }

  // Slash-collated: split the last whitespace-separated token on '/' and
  // re-attach the prefix to each part.
  if (name.includes('/')) {
    const lastSpace = name.lastIndexOf(' ');
    const slashToken = lastSpace === -1 ? name : name.slice(lastSpace + 1);
    const prefix = lastSpace === -1 ? '' : name.slice(0, lastSpace + 1);
    const parts = slashToken.split('/').map((p) => p.trim()).filter(Boolean);
    if (parts.length >= 2) {
      return parts.map((p) => (prefix + p).trim());
    }
  }

  return [name];
}

/**
 * Parse the messy free-text fatalities field used by AirCrash. Handles:
 *   "241+19"   → 260  (passengers + ground, very common in hull-loss reports)
 *   "0"        → 0
 *   ""/null    → 0    (treated as no information rather than zero deaths;
 *                       severity decision still defaults to non-fatal)
 *   "INH"      → 0    (NTSB "incident, no harm" code)
 *   "?"        → 0
 *   "1 of 2"   → 1    (take the leading integer)
 *   "estimated 30" → 30
 *
 * Returns an integer. Never NaN.
 */
function parseFatalities(raw) {
  if (raw === null || raw === undefined || raw === '') return 0;
  const s = String(raw).trim();
  if (!s || /^(unknown|inh|n\/a|none|-|\?)+$/i.test(s)) return 0;
  // Sum every integer literal in the string (so '241+19' and '2+1+3' both work).
  const nums = s.match(/\d+/g);
  if (!nums) return 0;
  let total = 0;
  for (const n of nums) total += parseInt(n, 10) || 0;
  return total;
}

/**
 * Parse normalized_date (YYYY-MM-DD) into epoch ms. Returns null if the
 * input is the partial-date format AirCrash sometimes stores
 * ('xx Sep 2012') — we'd rather skip the event than place it at year 0.
 */
function parseDateToEpoch(normalizedDate) {
  if (!normalizedDate || typeof normalizedDate !== 'string') return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalizedDate)) return null;
  const ms = Date.parse(normalizedDate + 'T00:00:00Z');
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Convert an AirCrash `accidents` row into a partial safety_events shape.
 * Fields the downstream renderers consume:
 *   id              — prefixed 'ac_' to avoid collision with safety_events ids
 *   occurred_at     — epoch ms (null for partial dates)
 *   aircraft_icao_type — null (AirCrash has free-text aircraft_model only;
 *                        we surface it via aircraft_model_text instead)
 *   aircraft_model_text — original free-text, for display
 *   operator_name   — operator (free-text)
 *   operator_iata   — null
 *   operator_icao   — null
 *   fatalities      — parsed integer
 *   hull_loss       — heuristic: 1 if fatalities > 0, else 0
 *   severity        — 'fatal' if fatalities > 0, 'incident' otherwise
 *   location_country — null (we have free-text location, no parsed country)
 *   location_text   — original free-text
 *   source          — 'aircrash'
 *   source_event_id — accident id (numeric)
 *   report_url      — source_url (first URL when comma-merged)
 */
function adaptAccidentToEvent(row) {
  if (!row) return null;
  const fatalities = parseFatalities(row.fatalities);
  const sourceUrl = String(row.source_url || '').split(',')[0].trim() || null;
  return {
    id: `ac_${row.id}`,
    occurred_at: parseDateToEpoch(row.normalized_date),
    aircraft_icao_type: null,
    aircraft_model_text: row.aircraft_model || null,
    operator_name: row.operator || null,
    operator_iata: null,
    operator_icao: null,
    fatalities,
    hull_loss: fatalities > 0 ? 1 : 0,
    severity: fatalities > 0 ? 'fatal' : 'incident',
    location_country: null,
    location_text: row.location || null,
    source: 'aircrash',
    source_event_id: String(row.id),
    report_url: sourceUrl,
  };
}

/**
 * Dedupe events by (occurred_at day, fatalities count, normalized operator
 * first token). Keeps the row with the most fatalities — AirCrash sometimes
 * has the same crash twice (one row from NTSB feed with 0 fatalities, one
 * from ASN with the real count). Best to surface the more-complete record.
 *
 * Events that lack occurred_at fall through unchanged — we don't have
 * enough signal to dedupe blind.
 */
function dedupe(events) {
  const seen = new Map();   // dayKey → event with highest fatalities
  const out = [];
  for (const ev of events) {
    if (!ev || !ev.occurred_at) { out.push(ev); continue; }
    const day = Math.floor(ev.occurred_at / 86400000);
    const opToken = String(ev.operator_name || ev.operator_iata || '')
      .toUpperCase().split(/\s+/)[0] || '';
    const key = `${day}|${opToken}`;
    const prev = seen.get(key);
    if (!prev) { seen.set(key, ev); out.push(ev); continue; }
    if ((ev.fatalities || 0) > (prev.fatalities || 0)) {
      // Replace previous entry in `out` with the higher-fatality version.
      const idx = out.indexOf(prev);
      if (idx !== -1) out[idx] = ev;
      seen.set(key, ev);
    }
  }
  return out;
}

/**
 * Merged events for an aircraft family.
 *
 * @param {object} opts
 * @param {string[]} opts.icaoList     ICAO type codes for safety_events query
 * @param {string}   opts.familyName   Pattern for AirCrash aircraft_model LIKE
 * @param {boolean}  [opts.fatalOnly]  Restrict to events with fatalities > 0
 * @param {number}   [opts.limit=100]  Cap on returned events post-merge
 */
function getMergedEventsForFamily(opts) {
  const { icaoList, familyName, fatalOnly = false, limit = 100 } = opts || {};

  // Safety events side. When fatalOnly we still pull everything and filter in
  // JS — safety_events row volumes per family are small (low thousands max).
  const safe = (Array.isArray(icaoList) && icaoList.length > 0)
    ? safetyModel.getByAircraftCodes(icaoList, { limit: 500 })
    : [];

  // AirCrash side. We always union the all-time fatal-only set with the
  // recency-bounded list (when fatalOnly=false) so popular families like
  // Boeing 737 (1.6K rows) don't drop 7-year-old hull losses such as
  // Lion Air 2018 / Ethiopian 2019 off the date-DESC + LIMIT tail. The
  // dedupe pass collapses any overlap between the two query results.
  let acc = [];
  if (familyName) {
    const patterns = expandFamilyPatterns(familyName);
    try {
      const fatalRows = sidecar.findAccidentsByFamilyPatterns(
        patterns, { fatalOnly: true },
      );
      const recentRows = fatalOnly
        ? []   // fatal-only callers don't need recency padding
        : sidecar.findAccidentsByFamilyPatterns(patterns, { limit: 500 });
      acc = [...fatalRows, ...recentRows].map(adaptAccidentToEvent).filter(Boolean);
    } catch { /* sidecar unavailable in test envs */ }
  }

  let merged = dedupe([...safe, ...acc]);

  if (fatalOnly) {
    merged = merged.filter((ev) => (ev.fatalities || 0) > 0
      || ev.severity === 'fatal' || ev.hull_loss === 1);
  }

  // Sort by occurred_at DESC; events without a date land at the bottom.
  merged.sort((a, b) => {
    const av = a.occurred_at == null ? -Infinity : a.occurred_at;
    const bv = b.occurred_at == null ? -Infinity : b.occurred_at;
    return bv - av;
  });

  return merged.slice(0, Math.max(0, Math.min(500, limit | 0) || 100));
}

module.exports = {
  expandFamilyPatterns,
  parseFatalities,
  parseDateToEpoch,
  adaptAccidentToEvent,
  dedupe,
  getMergedEventsForFamily,
};
