/**
 * Aircraft family groups — maps a user-facing family name to all IATA/Amadeus
 * codes that Amadeus may return for that family in dictionaries.aircraft.
 *
 * Used by aircraft-search to filter results after fan-out.
 */

const families = {
  // ── Boeing ────────────────────────────────────────────────────────────────
  'Boeing 737': {
    label: 'Boeing 737 (all variants)',
    manufacturer: 'Boeing',
    type: 'jet',
    maxRange: 6570, // MAX 9 — use widest range in family
    // ICAO: B737/B738/B739 (classic/NG), B38M/B39M (MAX 8/9). IATA: 737/738/739/73x/7Mx.
    codes: new Set(['B737','B738','B739','B38M','B39M','737','738','739','73H','73G','73J','73C','73W','7M7','7M8','7M9']),
  },
  'Boeing 757': {
    label: 'Boeing 757',
    manufacturer: 'Boeing',
    type: 'jet',
    maxRange: 7600,
    codes: new Set(['752','753','B752','B753']),
  },
  'Boeing 767': {
    label: 'Boeing 767',
    manufacturer: 'Boeing',
    type: 'wide-body',
    maxRange: 11093,
    codes: new Set(['763','764','B763','B764']),
  },
  'Boeing 777': {
    label: 'Boeing 777 (all variants)',
    manufacturer: 'Boeing',
    type: 'wide-body',
    maxRange: 13649,
    // ICAO: B772/B773/B77W/B77L/B778/B779. IATA: 777/772/773/77W/779.
    codes: new Set(['B777','B772','B773','B77W','B77L','B778','B779','772','773','77W','779']),
  },
  'Boeing 787': {
    label: 'Boeing 787 Dreamliner',
    manufacturer: 'Boeing',
    type: 'wide-body',
    maxRange: 14140,
    // ICAO: B788/B789/B78X (−8/−9/−10). IATA: 787/788/789/78J/78X.
    codes: new Set(['B788','B789','B78X','787','788','789','78J','78X']),
  },
  'Boeing 747': {
    label: 'Boeing 747',
    manufacturer: 'Boeing',
    type: 'wide-body',
    maxRange: 14816,
    codes: new Set(['744','748','B744','B748']),
  },

  // ── Airbus ────────────────────────────────────────────────────────────────
  'Airbus A340': {
    label: 'Airbus A340 (all variants)',
    manufacturer: 'Airbus',
    type: 'wide-body',
    maxRange: 13700,
    codes: new Set(['340','342','343','345','346','A340','A342','A343','A345','A346']),
  },
  'Airbus A220': {
    label: 'Airbus A220 (C Series)',
    manufacturer: 'Airbus',
    type: 'regional',
    maxRange: 6300,
    codes: new Set(['221','223','BCS1','BCS3','CS1','CS3']),
  },
  'Airbus A319': {
    label: 'Airbus A319',
    manufacturer: 'Airbus',
    type: 'jet',
    maxRange: 6300,
    // ICAO: A319 (ceo), A19N (neo). IATA: 319/31A.
    codes: new Set(['A319','A19N','319','31A']),
  },
  'Airbus A320': {
    label: 'Airbus A320 (all variants)',
    manufacturer: 'Airbus',
    type: 'jet',
    maxRange: 6300,
    // ICAO: A320 (ceo), A20N (neo). IATA: 320/32A/32B/32N/32Q.
    codes: new Set(['A320','A20N','320','32A','32B','32N','32Q']),
  },
  'Airbus A321': {
    label: 'Airbus A321 (all variants)',
    manufacturer: 'Airbus',
    type: 'jet',
    maxRange: 8700,
    // ICAO: A321 (ceo), A21N (neo). IATA: 321/32S/32T/31X.
    codes: new Set(['A321','A21N','321','32S','32T','31X']),
  },
  'Airbus A320 family': {
    label: 'Airbus A320 family (A319/A320/A321)',
    manufacturer: 'Airbus',
    type: 'jet',
    maxRange: 8700,
    // Full ceo + neo ICAO coverage plus legacy IATA-ish codes.
    codes: new Set([
      'A319','A320','A321',
      'A19N','A20N','A21N',
      '319','320','321','31A','32A','32B','32N','32Q','32S','32T','31X',
    ]),
  },
  'Airbus A330': {
    label: 'Airbus A330 (all variants)',
    manufacturer: 'Airbus',
    type: 'wide-body',
    maxRange: 15090,
    codes: new Set(['330','332','333','33E','338','339','A330','A332','A333','A338','A339']),
  },
  'Airbus A350': {
    label: 'Airbus A350',
    manufacturer: 'Airbus',
    type: 'wide-body',
    maxRange: 16100,
    codes: new Set(['A350','350','351','359','A359','A35K']),
  },
  'Airbus A380': {
    label: 'Airbus A380',
    manufacturer: 'Airbus',
    type: 'wide-body',
    maxRange: 15200,
    codes: new Set(['A380','380','388','A388']),
  },

  // ── Embraer ───────────────────────────────────────────────────────────────
  'Embraer E170/E175': {
    label: 'Embraer E170/E175',
    manufacturer: 'Embraer',
    type: 'regional',
    maxRange: 4260,
    codes: new Set(['ERJ','ER7','E70','E75','E7W','E75L','ERD']),
  },
  'Embraer E190/E195': {
    label: 'Embraer E190/E195',
    manufacturer: 'Embraer',
    type: 'regional',
    maxRange: 5278,
    codes: new Set(['ER9','E90','E95','E9W','E9X']),
  },

  // ── Bombardier ────────────────────────────────────────────────────────────
  'Bombardier CRJ': {
    label: 'Bombardier CRJ (all variants)',
    manufacturer: 'Bombardier',
    type: 'regional',
    maxRange: 4650,
    codes: new Set(['CRJ1','CRJ2','CRJ7','CRJ9','CR1','CR2','CR9','CRK']),
  },
  'Bombardier Dash 8': {
    label: 'Bombardier Dash 8 / Q400',
    manufacturer: 'Bombardier',
    type: 'turboprop',
    maxRange: 4400,
    codes: new Set(['Q400','DH4','DH8']),
  },

  // ── ATR ───────────────────────────────────────────────────────────────────
  'ATR 42/72': {
    label: 'ATR 42/72',
    manufacturer: 'ATR',
    type: 'turboprop',
    maxRange: 2750,
    codes: new Set(['ATR','AT7','AT4']),
  },
};

/** Array of family names for the UI dropdown */
const familyNames = Object.keys(families);

/**
 * Derive a URL-safe slug from a family name. Keeps the manufacturer prefix so
 * URLs like /aircraft/boeing-737 match what users actually search for — that
 * keyword alignment matters a lot more for SEO than a tighter URL.
 *   'Airbus A380'          → 'airbus-a380'
 *   'Boeing 747'           → 'boeing-747'
 *   'Airbus A320 family'   → 'airbus-a320-family'
 *   'Embraer E170/E175'    → 'embraer-e170-e175'
 *   'Bombardier Dash 8'    → 'bombardier-dash-8'
 */
// Linear slugifier — single pass, no regex. CodeQL js/polynomial-redos
// flags /[^a-z0-9]+/g on user-reachable input (resolveFamily takes an
// untrusted query string), and these helpers are on that path. The char
// scan is also faster for typical inputs.
function slugifyChars(input) {
  let out = '';
  let prevDash = true; // leading non-alnum runs are collapsed away
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    const isAlnum =
      (c >= 97 && c <= 122) || // a-z
      (c >= 48 && c <=  57);   // 0-9
    if (isAlnum) {
      out += input[i];
      prevDash = false;
    } else if (!prevDash) {
      out += '-';
      prevDash = true;
    }
  }
  if (prevDash && out.length > 0) out = out.slice(0, -1);
  return out;
}

function slugify(name) {
  return slugifyChars(String(name).toLowerCase());
}

// Legacy short slug — previously exposed by the API ('737', 'a340'). Kept as
// an alias so any old link, saved search, or webarchive URL still resolves.
const LEGACY_PREFIXES = ['boeing ', 'airbus ', 'embraer ', 'bombardier ', 'atr '];
function legacySlug(name) {
  let lower = String(name).toLowerCase();
  for (const p of LEGACY_PREFIXES) {
    if (lower.startsWith(p)) { lower = lower.slice(p.length); break; }
  }
  return slugifyChars(lower);
}

// Pre-compute slug → family name lookup (families are static at module load).
// Register both the canonical (manufacturer-prefixed) slug AND the legacy
// short slug — getFamilyBySlug accepts either.
const slugToName = {};
for (const name of familyNames) {
  slugToName[slugify(name)] = name;
  const legacy = legacySlug(name);
  if (!slugToName[legacy]) slugToName[legacy] = name;
}

/**
 * Resolve a slug back to a family record plus its name and ICAO-only code list
 * (the 4-letter ICAO type designators that show up in observed_routes.aircraft_icao).
 * Returns null if the slug is unknown.
 */
function getFamilyBySlug(slug) {
  if (!slug || typeof slug !== 'string') return null;
  const name = slugToName[slug.toLowerCase()];
  if (!name) return null;
  const fam = families[name];
  // observed_routes.aircraft_icao stores ICAO type designators (4 chars, e.g. B738, A320).
  // Families include both IATA-ish (320, 32N) and ICAO (A320, B738) codes; keep only ICAO.
  const icaoList = [...fam.codes].filter(c => /^[A-Z][A-Z0-9]{3}$/.test(c));
  return { name, family: fam, icaoList };
}

/**
 * Get all Amadeus aircraft codes for a given family name.
 * Returns null if family not found.
 * @param {string} familyName
 * @returns {Set<string>|null}
 */
function getFamilyCodes(familyName) {
  return families[familyName]?.codes || null;
}

/**
 * Get the max operational range (km) for a family.
 * Used to pre-filter irrelevant long/short routes.
 * @param {string} familyName
 * @returns {number}
 */
function getFamilyRange(familyName) {
  return families[familyName]?.maxRange || 20000;
}

/**
 * Return a flat list of families suitable for the UI.
 */
function getFamilyList() {
  return familyNames.map(name => ({
    name,
    slug: slugify(name),
    label: families[name].label,
    manufacturer: families[name].manufacturer,
    type: families[name].type,
    maxRange: families[name].maxRange,
  }));
}

/**
 * Resolve an arbitrary user input (slug or display name) to the family record.
 * Accepts "a340", "A340", "Airbus A340", "Airbus A340 family".
 */
function resolveFamily(input) {
  if (!input || typeof input !== 'string') return null;
  const trimmed = input.trim();
  // First try direct slug lookup.
  const direct = getFamilyBySlug(trimmed);
  if (direct) return direct;
  // Otherwise try slugifying the input (handles display names).
  return getFamilyBySlug(slugify(trimmed));
}

module.exports = { families, familyNames, getFamilyCodes, getFamilyRange, getFamilyList, getFamilyBySlug, resolveFamily, slugify };
