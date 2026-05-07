// Static list of 17 aircraft families for client-side filter chips.
// Mirrors server-side aircraftFamilies + LegacyRedirect.jsx FAMILY_SLUGS.
// Used to render aircraft checkbox lists without an extra HTTP round-trip.

export const AIRCRAFT_FAMILIES = Object.freeze([
  { slug: 'boeing-787',     label: 'Boeing 787 Dreamliner', category: 'wide-body' },
  { slug: 'boeing-777',     label: 'Boeing 777',            category: 'wide-body' },
  { slug: 'boeing-767',     label: 'Boeing 767',            category: 'wide-body' },
  { slug: 'boeing-747',     label: 'Boeing 747',            category: 'wide-body' },
  { slug: 'airbus-a380',    label: 'Airbus A380',           category: 'wide-body' },
  { slug: 'airbus-a350',    label: 'Airbus A350',           category: 'wide-body' },
  { slug: 'airbus-a330',    label: 'Airbus A330',           category: 'wide-body' },
  { slug: 'airbus-a340',    label: 'Airbus A340',           category: 'wide-body' },
  { slug: 'boeing-737',     label: 'Boeing 737',            category: 'narrow-body' },
  { slug: 'boeing-757',     label: 'Boeing 757',            category: 'narrow-body' },
  { slug: 'airbus-a320',    label: 'Airbus A320',           category: 'narrow-body' },
  { slug: 'airbus-a319',    label: 'Airbus A319',           category: 'narrow-body' },
  { slug: 'airbus-a321',    label: 'Airbus A321',           category: 'narrow-body' },
  { slug: 'airbus-a220',    label: 'Airbus A220',           category: 'narrow-body' },
  { slug: 'embraer-e-jet',  label: 'Embraer E-Jet',         category: 'regional' },
  { slug: 'bombardier-crj', label: 'Bombardier CRJ',        category: 'regional' },
  { slug: 'atr-72',         label: 'ATR 72',                category: 'turboprop' },
]);

export function getFamily(slug) {
  return AIRCRAFT_FAMILIES.find(f => f.slug === slug);
}

// ─── Async fetch-based utility (for aircraft family model-prefix matching) ───

let _families = null;
let _promise = null;

export function loadFamilies() {
  if (_families) return Promise.resolve(_families);
  if (_promise) return _promise;
  _promise = fetch('/content/aircraft-family-models.json')
    .then(r => r.ok ? r.json() : [])
    .then(data => { _families = Array.isArray(data) ? data : []; return _families; })
    .catch(() => { _families = []; return _families; });
  return _promise;
}

export function findFamilySlugForModel(model, families) {
  if (!model || !Array.isArray(families)) return null;
  const m = String(model).toLowerCase();
  for (const fam of families) {
    if (!Array.isArray(fam.modelPrefixes)) continue;
    for (const prefix of fam.modelPrefixes) {
      if (m.startsWith(String(prefix).toLowerCase())) return fam.slug;
    }
  }
  return null;
}

export function _resetForTests() {
  _families = null;
  _promise = null;
}
