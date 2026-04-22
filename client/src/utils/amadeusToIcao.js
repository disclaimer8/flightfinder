// Amadeus/Duffel flight-search results use a 3-char aircraftCode (e.g. "223"
// for Airbus A220-300, "738" for Boeing 737-800). Our enrichment backend
// keyes CO₂, livery and amenities lookups by ICAO type designator (A20N,
// B738, BCS3, etc.), so we translate before calling /enriched.
//
// Sources: IATA aircraft-type codes cross-referenced with ICAO designators.
// Extend as new types show up in production.
const MAP = {
  // Airbus narrow-body
  '319': 'A319',
  '320': 'A320',
  '321': 'A321',
  '32A': 'A320', '32B': 'A321', '32S': 'A320',
  '32N': 'A20N', '32Q': 'A21N',    // neo
  '223': 'BCS3', '221': 'BCS1',    // A220
  // Airbus wide-body
  '332': 'A332', '333': 'A333', '338': 'A338', '339': 'A339',
  '342': 'A342', '343': 'A343', '345': 'A345', '346': 'A346',
  '359': 'A359', '35K': 'A35K',
  '388': 'A388',
  // Boeing narrow-body
  '737': 'B737', '738': 'B738', '739': 'B739',
  '73G': 'B738', '73H': 'B738', '73J': 'B738',
  '7M8': 'B38M', '7M9': 'B39M',    // MAX
  // Boeing wide-body
  '763': 'B763', '764': 'B764',
  '772': 'B772', '773': 'B773', '77L': 'B77L', '77W': 'B77W',
  '788': 'B788', '789': 'B789', '78X': 'B78X',
  '744': 'B744', '748': 'B748',
  // Embraer / Bombardier regional
  'E70': 'E170', 'E75': 'E175', 'E90': 'E190', 'E95': 'E195',
  'E7W': 'E75L', '290': 'E290', '295': 'E295',
  'CR7': 'CRJ7', 'CR9': 'CRJ9', 'CRK': 'CRJX',
  'DH4': 'DH8D', 'DH8': 'DH8D',
  'AT7': 'AT72', 'ATR': 'AT76',
};

export function amadeusToIcao(code) {
  if (!code) return null;
  const key = String(code).toUpperCase().trim();
  // Already an ICAO designator (4 letters/digits) — pass through.
  if (/^[A-Z0-9]{4}$/.test(key)) return key;
  return MAP[key] || null;
}
