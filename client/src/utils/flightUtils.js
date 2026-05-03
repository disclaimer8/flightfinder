/** Parse "2h 35m" → total minutes. Returns Infinity for missing values. */
export function parseDurationMins(str) {
  if (!str) return Infinity;
  const h = str.match(/(\d+)h/);
  const m = str.match(/(\d+)m/);
  return (h ? +h[1] * 60 : 0) + (m ? +m[1] : 0);
}

/** Classify an ISO timestamp into a time-of-day slot. */
export function getTimeSlot(isoString) {
  const h = new Date(isoString).getHours();
  if (h < 6)  return 'night';
  if (h < 12) return 'morning';
  if (h < 18) return 'afternoon';
  return 'evening';
}

// Manufacturer + family pairs the /aircraft/:slug landing pages exist for.
// Derived from /api/aircraft/families — kept inline so we don't have to fetch
// the families list just to render a flight card. Order matters: longer,
// more-specific matches first (e.g. "boeing 747" before "boeing 7"). We only
// emit a slug when the aircraft display name starts with one of these stems —
// any unrecognised string yields null so the FlightCard quietly omits the link
// rather than producing a 404 to /aircraft/<garbage>.
const AIRCRAFT_FAMILY_STEMS = [
  ['airbus a220',     'airbus-a220'],
  ['airbus a318',     'airbus-a320'],
  ['airbus a319',     'airbus-a320'],
  ['airbus a320',     'airbus-a320'],
  ['airbus a321',     'airbus-a320'],
  ['airbus a330',     'airbus-a330'],
  ['airbus a340',     'airbus-a340'],
  ['airbus a350',     'airbus-a350'],
  ['airbus a380',     'airbus-a380'],
  ['boeing 717',      'boeing-717'],
  ['boeing 737',      'boeing-737'],
  ['boeing 747',      'boeing-747'],
  ['boeing 757',      'boeing-757'],
  ['boeing 767',      'boeing-767'],
  ['boeing 777',      'boeing-777'],
  ['boeing 787',      'boeing-787'],
  ['embraer e',       'embraer-e-jet'],
  ['embraer 170',     'embraer-e-jet'],
  ['embraer 175',     'embraer-e-jet'],
  ['embraer 190',     'embraer-e-jet'],
  ['embraer 195',     'embraer-e-jet'],
];

/** Resolve "Boeing 737-800" / "Airbus A320neo" → landing-page slug, or null. */
export function aircraftDisplayToFamilySlug(displayName) {
  if (!displayName) return null;
  const lower = String(displayName).toLowerCase().trim();
  for (const [stem, slug] of AIRCRAFT_FAMILY_STEMS) {
    if (lower.startsWith(stem)) return slug;
  }
  return null;
}

/** Build URLSearchParams from a search-form filters object. */
export function buildFlightParams(filters) {
  const params = new URLSearchParams();
  if (filters.departure)    params.append('departure',    filters.departure);
  if (filters.arrival)      params.append('arrival',      filters.arrival);
  if (filters.date)         params.append('date',         filters.date);
  if (filters.passengers)   params.append('passengers',   filters.passengers);
  if (filters.aircraftType)  params.append('aircraftType',  filters.aircraftType);
  if (filters.aircraftModel) params.append('aircraftModel', filters.aircraftModel);
  if (filters.familyName)    params.append('familyName',    filters.familyName);
  if (filters.returnDate)   params.append('returnDate',   filters.returnDate);
  if (filters.directOnly)   params.append('directOnly',   '1');
  return params;
}
