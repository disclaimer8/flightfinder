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
    codes: new Set(['B737','B738','B739','737','738','739','73H','73G','73J','73C','73W','7M7','7M8','7M9']),
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
    codes: new Set(['B777','772','773','77W','779']),
  },
  'Boeing 787': {
    label: 'Boeing 787 Dreamliner',
    manufacturer: 'Boeing',
    type: 'wide-body',
    maxRange: 14140,
    codes: new Set(['B788','787','788','789','78J']),
  },
  'Boeing 747': {
    label: 'Boeing 747',
    manufacturer: 'Boeing',
    type: 'wide-body',
    maxRange: 14816,
    codes: new Set(['744','748','B744','B748']),
  },

  // ── Airbus ────────────────────────────────────────────────────────────────
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
    codes: new Set(['A319','319','31A']),
  },
  'Airbus A320': {
    label: 'Airbus A320 (all variants)',
    manufacturer: 'Airbus',
    type: 'jet',
    maxRange: 6300,
    codes: new Set(['A320','320','32A','32B','32N','32Q']),
  },
  'Airbus A321': {
    label: 'Airbus A321 (all variants)',
    manufacturer: 'Airbus',
    type: 'jet',
    maxRange: 8700,
    codes: new Set(['A321','321','32S','32T','31X']),
  },
  'Airbus A320 family': {
    label: 'Airbus A320 family (A319/A320/A321)',
    manufacturer: 'Airbus',
    type: 'jet',
    maxRange: 8700,
    codes: new Set(['A319','A320','A321','319','320','321','31A','32A','32B','32N','32Q','32S','32T','31X']),
  },
  'Airbus A330': {
    label: 'Airbus A330 (all variants)',
    manufacturer: 'Airbus',
    type: 'wide-body',
    maxRange: 15090,
    codes: new Set(['330','332','333','33E','338','339']),
  },
  'Airbus A350': {
    label: 'Airbus A350',
    manufacturer: 'Airbus',
    type: 'wide-body',
    maxRange: 16100,
    codes: new Set(['A350','350','351','359']),
  },
  'Airbus A380': {
    label: 'Airbus A380',
    manufacturer: 'Airbus',
    type: 'wide-body',
    maxRange: 15200,
    codes: new Set(['A380','380','388']),
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
    label: families[name].label,
    manufacturer: families[name].manufacturer,
    type: families[name].type,
    maxRange: families[name].maxRange,
  }));
}

module.exports = { families, familyNames, getFamilyCodes, getFamilyRange, getFamilyList };
