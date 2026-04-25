'use strict';

const axios = require('axios');
const faaRegistry = require('../../models/faaRegistry');
const { resolveIcaoType } = require('./faaModelToIcao');

// NTSB upgraded CAROL to "Enhanced CAROL" 2026; legacy data.ntsb.gov/carol-main-public
// API was deprecated. New endpoint: api.ntsb.gov/searchpub/api/Carol/v2/GetInvestigationsCustom
// behind Azure APIM, requires the public subscription key the my.ntsb.gov frontend
// embeds in its bundle.
const ENDPOINT = 'https://api.ntsb.gov/searchpub/api/Carol/v2/GetInvestigationsCustom';

// Public subscription key from my.ntsb.gov frontend (visible in browser network tab).
// Not a secret — anyone visiting my.ntsb.gov sends it. Allow override via env so we
// can rotate if NTSB ever rotates without redeploying server code.
const SUBSCRIPTION_KEY = process.env.NTSB_API_KEY || 'bdac93fd72d246b58145894fd0f50262';

/**
 * Map "MM/DD/YYYY" date string to epoch ms. Returns null on parse failure.
 */
function parseUSDate(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return null;
  const m = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) {
    const t = Date.parse(dateStr);
    return Number.isFinite(t) ? t : null;
  }
  const [, mm, dd, yyyy] = m;
  const t = Date.parse(`${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}T00:00:00Z`);
  return Number.isFinite(t) ? t : null;
}

/**
 * "vehicleDetails" is a colon-separated string like "PH-EME : TEXTRON/182T" or
 * "N12345 : BOEING/737". Pull out registration + manufacturer + model.
 */
function parseVehicleDetails(s) {
  if (!s || typeof s !== 'string') return { registration: null, manufacturer: null, model: null };
  const [regPart, mfrModelPart] = s.split(':').map(p => p.trim());
  const registration = regPart && regPart !== '-' ? regPart.toUpperCase() : null;
  let manufacturer = null, model = null;
  if (mfrModelPart) {
    const slash = mfrModelPart.indexOf('/');
    if (slash >= 0) {
      manufacturer = mfrModelPart.slice(0, slash).trim().toUpperCase();
      model = mfrModelPart.slice(slash + 1).trim().toUpperCase();
    } else {
      manufacturer = mfrModelPart.toUpperCase();
    }
  }
  return { registration, manufacturer, model };
}

/**
 * "location" is "City, ST" for US, "City, FR" for foreign (2-letter ISO country).
 * Pull out the country part.
 */
function parseLocation(s) {
  if (!s || typeof s !== 'string') return null;
  const parts = s.split(',').map(p => p.trim());
  if (parts.length < 2) return null;
  const last = parts[parts.length - 1];
  // US states are 2 chars uppercase. Country codes are 2 chars or full names.
  // For US accidents NTSB uses "City, AK" etc. — we treat that as country=USA.
  // For foreign use country code/name as-is.
  if (/^[A-Z]{2}$/.test(last)) {
    // 2-letter — could be US state OR ISO country code. Use a small US state set.
    const US_STATES = new Set(['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC','PR','VI','AS','GU','MP']);
    return US_STATES.has(last) ? 'USA' : last;
  }
  return last;
}

/**
 * Convert NTSB "injuries" + "eventType" into our 6-tier severity taxonomy.
 *
 * NTSB injuries values: 'Fatal' | 'Serious' | 'Minor' | 'None' | 'Unknown' | ''
 * NTSB eventType:       'Accident' | 'Incident' | etc.
 *
 * Old API gave us TotalFatalInjuries + AircraftDamage fields — new list-view
 * API doesn't, so this is necessarily coarser.
 */
function severityFromNew(row) {
  const inj = String(row.injuries || '').trim();
  const ev  = String(row.eventType || '').trim().toLowerCase();
  if (inj === 'Fatal') return 'fatal';
  if (inj === 'Serious') return 'serious_incident';
  if (inj === 'Minor') return 'incident';
  if (inj === 'None') {
    // "Accident" with no reported injuries usually means substantial damage —
    // map to 'incident'. "Incident" means something less severe.
    return ev === 'accident' ? 'incident' : 'minor';
  }
  return 'unknown';
}

/**
 * Map a single new-API record to a safety_events row. Returns null when the
 * event has no usable identifier.
 */
function mapToSafetyEvent(raw, observedAt) {
  if (!raw || typeof raw !== 'object') return null;
  const eventId = String(raw.ntsbNumber || '').trim();
  if (!eventId) return null;

  const occurredAtMs = parseUSDate(raw.date) || observedAt;
  const severity     = severityFromNew(raw);

  const fatalities = severity === 'fatal' ? 1 : 0;
  const injuries   = severity === 'serious_incident' || severity === 'incident' ? 1 : 0;

  const { registration, manufacturer, model } = parseVehicleDetails(raw.vehicleDetails);

  // Resolve ICAO aircraft type via FAA Registry (US N-numbers) or via the
  // parsed manufacturer/model directly (works for non-US tails too if MFR+MODEL
  // matches our seed dictionary).
  let aircraftIcaoType = null;
  if (registration && /^N[A-Z0-9]{1,5}$/.test(registration)) {
    const faa = faaRegistry.getByNNumber(registration);
    if (faa) aircraftIcaoType = resolveIcaoType(faa.manufacturer, faa.model);
  }
  if (!aircraftIcaoType && manufacturer && model) {
    aircraftIcaoType = resolveIcaoType(manufacturer, model);
  }

  const reportUrl = raw.reportUrl
    || raw.docketUrl
    || `https://my.ntsb.gov/aviation/${encodeURIComponent(eventId)}`;

  return {
    source:             'ntsb',
    source_event_id:    eventId,
    occurred_at:        occurredAtMs,
    severity,
    fatalities,
    injuries,
    hull_loss:          0, // new API doesn't expose AircraftDamage; default 0
    cictt_category:     null, // OccurrenceType no longer in list view
    phase_of_flight:    null, // PhaseOfFlight no longer in list view
    operator_iata:      null, // not in new shape
    operator_icao:      null,
    operator_name:      null,
    aircraft_icao_type: aircraftIcaoType,
    registration,
    dep_iata:           null, // location is free text "City, ST" — not airport
    arr_iata:           null,
    location_country:   parseLocation(raw.location),
    location_lat:       null, // not in new shape
    location_lon:       null,
    narrative:          raw.probableCause || null,
    report_url:         reportUrl,
    ingested_at:        observedAt,
    updated_at:         observedAt,
  };
}

/**
 * Fetch one page from new NTSB Carol v2 API.
 * @returns {Promise<{rows: Array, hasMore: boolean}>}
 */
async function fetchPage({ sinceDays = 30, page = 0, pageSize = 50 }) {
  const dateFromISO = new Date(Date.now() - sinceDays * 24 * 3600 * 1000).toISOString();

  const body = {
    userName: 'anonymous',
    paging: { pageSize, startIndex: page * pageSize },
    sorting: { sortingFilters: [] },
    filter: {
      operator: 'All',
      groups: [
        {
          operator: 'All',
          associations: [
            {
              operator: 'All',
              criteria: [
                { field: 'EventDate', operator: 'GreaterThanEqualTo', value: dateFromISO },
              ],
            },
            {
              operator: 'All',
              criteria: [
                { field: 'casedetail.TopicMode', operator: 'Contains', value: 'Aviation' },
              ],
            },
          ],
        },
      ],
    },
  };

  const res = await axios.post(ENDPOINT, body, {
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Ocp-Apim-Subscription-Key': SUBSCRIPTION_KEY,
      'Origin': 'https://my.ntsb.gov',
      'Referer': 'https://my.ntsb.gov/',
    },
    timeout: 30_000,
    validateStatus: () => true,
  });
  if (res.status !== 200) {
    throw new Error(`NTSB Carol v2 returned ${res.status}`);
  }
  const list = Array.isArray(res.data?.results) ? res.data.results : [];
  const total = res.data?.paging?.totalCount;
  const seen  = (page + 1) * pageSize;
  const hasMore = Number.isFinite(total) ? seen < total : list.length >= pageSize;
  return { rows: list, hasMore };
}

module.exports = { fetchPage, mapToSafetyEvent, parseVehicleDetails, parseLocation, parseUSDate, severityFromNew };
