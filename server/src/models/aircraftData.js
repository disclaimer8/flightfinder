// Aircraft database with IATA codes, models, types, and specifications
module.exports = {
  // Turboprops
  'Q400': {
    name: 'Bombardier Dash 8 Q400',
    manufacturer: 'Bombardier',
    type: 'turboprop',
    capacity: 90,
    range: 4400,
    cruiseSpeed: 667
  },
  'ATR': {
    name: 'ATR 72',
    manufacturer: 'ATR',
    type: 'turboprop',
    capacity: 78,
    range: 2750,
    cruiseSpeed: 511
  },
  'DH4': {
    name: 'Dash 8-100',
    manufacturer: 'Bombardier',
    type: 'turboprop',
    capacity: 37,
    range: 1300,
    cruiseSpeed: 452
  },

  // Regional Jets
  'CRJ1': {
    name: 'Bombardier CRJ100',
    manufacturer: 'Bombardier',
    type: 'regional',
    capacity: 50,
    range: 2680,
    cruiseSpeed: 740
  },
  'CRJ2': {
    name: 'Bombardier CRJ200',
    manufacturer: 'Bombardier',
    type: 'regional',
    capacity: 50,
    range: 3230,
    cruiseSpeed: 740
  },
  'CRJ7': {
    name: 'Bombardier CRJ700',
    manufacturer: 'Bombardier',
    type: 'regional',
    capacity: 70,
    range: 3650,
    cruiseSpeed: 870
  },
  'CRJ9': {
    name: 'Bombardier CRJ900',
    manufacturer: 'Bombardier',
    type: 'regional',
    capacity: 90,
    range: 3650,
    cruiseSpeed: 870
  },
  'CR1': {
    name: 'Bombardier CRJ1000',
    manufacturer: 'Bombardier',
    type: 'regional',
    capacity: 100,
    range: 4650,
    cruiseSpeed: 870
  },
  'ERJ': {
    name: 'Embraer E170',
    manufacturer: 'Embraer',
    type: 'regional',
    capacity: 70,
    range: 4260,
    cruiseSpeed: 840
  },
  'ER7': {
    name: 'Embraer E175',
    manufacturer: 'Embraer',
    type: 'regional',
    capacity: 78,
    range: 4260,
    cruiseSpeed: 840
  },
  'ER9': {
    name: 'Embraer E190',
    manufacturer: 'Embraer',
    type: 'regional',
    capacity: 100,
    range: 4630,
    cruiseSpeed: 870
  },

  // Narrow-body Jets
  'B737': {
    name: 'Boeing 737',
    manufacturer: 'Boeing',
    type: 'jet',
    capacity: 189,
    range: 5570,
    cruiseSpeed: 903
  },
  'B738': {
    name: 'Boeing 737-800',
    manufacturer: 'Boeing',
    type: 'jet',
    capacity: 189,
    range: 5436,
    cruiseSpeed: 903
  },
  'B739': {
    name: 'Boeing 737-900',
    manufacturer: 'Boeing',
    type: 'jet',
    capacity: 189,
    range: 5570,
    cruiseSpeed: 903
  },
  'A320': {
    name: 'Airbus A320',
    manufacturer: 'Airbus',
    type: 'jet',
    capacity: 194,
    range: 6300,
    cruiseSpeed: 903
  },
  'A321': {
    name: 'Airbus A321',
    manufacturer: 'Airbus',
    type: 'jet',
    capacity: 220,
    range: 7900,
    cruiseSpeed: 903
  },
  'A319': {
    name: 'Airbus A319',
    manufacturer: 'Airbus',
    type: 'jet',
    capacity: 156,
    range: 6300,
    cruiseSpeed: 903
  },

  // Wide-body Jets
  'B777': {
    name: 'Boeing 777',
    manufacturer: 'Boeing',
    type: 'wide-body',
    capacity: 396,
    range: 8680,
    cruiseSpeed: 956
  },
  'B788': {
    name: 'Boeing 787 Dreamliner',
    manufacturer: 'Boeing',
    type: 'wide-body',
    capacity: 330,
    range: 14685,
    cruiseSpeed: 956
  },
  'A350': {
    name: 'Airbus A350',
    manufacturer: 'Airbus',
    type: 'wide-body',
    capacity: 366,
    range: 15000,
    cruiseSpeed: 956
  },
  'A380': {
    name: 'Airbus A380',
    manufacturer: 'Airbus',
    type: 'wide-body',
    capacity: 555,
    range: 15000,
    cruiseSpeed: 956
  },

  // ── Amadeus numeric IATA codes (same data, different key format) ──

  // Turboprops
  'DH8': { name: 'Bombardier Dash 8', manufacturer: 'Bombardier', type: 'turboprop', capacity: 37, range: 1300, cruiseSpeed: 452 },
  'AT7': { name: 'ATR 72', manufacturer: 'ATR', type: 'turboprop', capacity: 78, range: 2750, cruiseSpeed: 511 },
  'AT4': { name: 'ATR 42', manufacturer: 'ATR', type: 'turboprop', capacity: 50, range: 1555, cruiseSpeed: 510 },
  'DH4': { name: 'Dash 8 Q400', manufacturer: 'Bombardier', type: 'turboprop', capacity: 90, range: 4400, cruiseSpeed: 667 },

  // Regional Jets
  'CR2': { name: 'Bombardier CRJ200', manufacturer: 'Bombardier', type: 'regional', capacity: 50, range: 3230, cruiseSpeed: 740 },
  'CR9': { name: 'Bombardier CRJ900', manufacturer: 'Bombardier', type: 'regional', capacity: 90, range: 3650, cruiseSpeed: 870 },
  'CRK': { name: 'Bombardier CRJ1000', manufacturer: 'Bombardier', type: 'regional', capacity: 100, range: 4650, cruiseSpeed: 870 },
  'E70': { name: 'Embraer E170', manufacturer: 'Embraer', type: 'regional', capacity: 70, range: 4260, cruiseSpeed: 840 },
  'E75': { name: 'Embraer E175', manufacturer: 'Embraer', type: 'regional', capacity: 78, range: 4260, cruiseSpeed: 840 },
  'E90': { name: 'Embraer E190', manufacturer: 'Embraer', type: 'regional', capacity: 100, range: 4630, cruiseSpeed: 870 },
  'E95': { name: 'Embraer E195', manufacturer: 'Embraer', type: 'regional', capacity: 120, range: 4260, cruiseSpeed: 870 },
  'ERD': { name: 'Embraer E175-E2', manufacturer: 'Embraer', type: 'regional', capacity: 80, range: 4260, cruiseSpeed: 870 },

  // Narrow-body Jets — Amadeus uses numeric codes
  '319': { name: 'Airbus A319', manufacturer: 'Airbus', type: 'jet', capacity: 156, range: 6300, cruiseSpeed: 903 },
  '320': { name: 'Airbus A320', manufacturer: 'Airbus', type: 'jet', capacity: 194, range: 6300, cruiseSpeed: 903 },
  '321': { name: 'Airbus A321', manufacturer: 'Airbus', type: 'jet', capacity: 220, range: 7900, cruiseSpeed: 903 },
  '32A': { name: 'Airbus A320', manufacturer: 'Airbus', type: 'jet', capacity: 194, range: 6300, cruiseSpeed: 903 },
  '32B': { name: 'Airbus A320neo', manufacturer: 'Airbus', type: 'jet', capacity: 194, range: 6300, cruiseSpeed: 903 },
  '32N': { name: 'Airbus A320neo', manufacturer: 'Airbus', type: 'jet', capacity: 194, range: 6300, cruiseSpeed: 903 },
  '32Q': { name: 'Airbus A320neo', manufacturer: 'Airbus', type: 'jet', capacity: 194, range: 6300, cruiseSpeed: 903 },
  '31A': { name: 'Airbus A319neo', manufacturer: 'Airbus', type: 'jet', capacity: 160, range: 6300, cruiseSpeed: 903 },
  '32S': { name: 'Airbus A321neo', manufacturer: 'Airbus', type: 'jet', capacity: 244, range: 7400, cruiseSpeed: 903 },
  '737': { name: 'Boeing 737', manufacturer: 'Boeing', type: 'jet', capacity: 149, range: 5000, cruiseSpeed: 903 },
  '738': { name: 'Boeing 737-800', manufacturer: 'Boeing', type: 'jet', capacity: 189, range: 5436, cruiseSpeed: 903 },
  '739': { name: 'Boeing 737-900', manufacturer: 'Boeing', type: 'jet', capacity: 220, range: 5570, cruiseSpeed: 903 },
  '73H': { name: 'Boeing 737-800', manufacturer: 'Boeing', type: 'jet', capacity: 189, range: 5436, cruiseSpeed: 903 },
  '73G': { name: 'Boeing 737-700', manufacturer: 'Boeing', type: 'jet', capacity: 149, range: 5000, cruiseSpeed: 903 },
  '7M8': { name: 'Boeing 737 MAX 8', manufacturer: 'Boeing', type: 'jet', capacity: 210, range: 6480, cruiseSpeed: 903 },
  '7M9': { name: 'Boeing 737 MAX 9', manufacturer: 'Boeing', type: 'jet', capacity: 220, range: 6570, cruiseSpeed: 903 },
  '752': { name: 'Boeing 757-200', manufacturer: 'Boeing', type: 'jet', capacity: 200, range: 7600, cruiseSpeed: 903 },
  '753': { name: 'Boeing 757-300', manufacturer: 'Boeing', type: 'jet', capacity: 280, range: 6400, cruiseSpeed: 903 },

  // Wide-body Jets — Amadeus numeric codes
  '330': { name: 'Airbus A330', manufacturer: 'Airbus', type: 'wide-body', capacity: 277, range: 11750, cruiseSpeed: 926 },
  '332': { name: 'Airbus A330-200', manufacturer: 'Airbus', type: 'wide-body', capacity: 246, range: 13450, cruiseSpeed: 926 },
  '333': { name: 'Airbus A330-300', manufacturer: 'Airbus', type: 'wide-body', capacity: 277, range: 11750, cruiseSpeed: 926 },
  '33E': { name: 'Airbus A330-300', manufacturer: 'Airbus', type: 'wide-body', capacity: 277, range: 11750, cruiseSpeed: 926 },
  '338': { name: 'Airbus A330-800neo', manufacturer: 'Airbus', type: 'wide-body', capacity: 257, range: 15090, cruiseSpeed: 926 },
  '339': { name: 'Airbus A330-900neo', manufacturer: 'Airbus', type: 'wide-body', capacity: 287, range: 13334, cruiseSpeed: 926 },
  '350': { name: 'Airbus A350', manufacturer: 'Airbus', type: 'wide-body', capacity: 315, range: 15000, cruiseSpeed: 956 },
  '351': { name: 'Airbus A350-1000', manufacturer: 'Airbus', type: 'wide-body', capacity: 369, range: 16100, cruiseSpeed: 956 },
  '359': { name: 'Airbus A350-900', manufacturer: 'Airbus', type: 'wide-body', capacity: 315, range: 15000, cruiseSpeed: 956 },
  '380': { name: 'Airbus A380', manufacturer: 'Airbus', type: 'wide-body', capacity: 555, range: 15200, cruiseSpeed: 956 },
  '388': { name: 'Airbus A380-800', manufacturer: 'Airbus', type: 'wide-body', capacity: 555, range: 15200, cruiseSpeed: 956 },
  '744': { name: 'Boeing 747-400', manufacturer: 'Boeing', type: 'wide-body', capacity: 416, range: 13450, cruiseSpeed: 956 },
  '748': { name: 'Boeing 747-8', manufacturer: 'Boeing', type: 'wide-body', capacity: 467, range: 14816, cruiseSpeed: 956 },
  '763': { name: 'Boeing 767-300', manufacturer: 'Boeing', type: 'wide-body', capacity: 218, range: 11093, cruiseSpeed: 851 },
  '764': { name: 'Boeing 767-400', manufacturer: 'Boeing', type: 'wide-body', capacity: 245, range: 10415, cruiseSpeed: 851 },
  '772': { name: 'Boeing 777-200', manufacturer: 'Boeing', type: 'wide-body', capacity: 314, range: 9700, cruiseSpeed: 956 },
  '773': { name: 'Boeing 777-300', manufacturer: 'Boeing', type: 'wide-body', capacity: 396, range: 11121, cruiseSpeed: 956 },
  '77W': { name: 'Boeing 777-300ER', manufacturer: 'Boeing', type: 'wide-body', capacity: 396, range: 13649, cruiseSpeed: 956 },
  '779': { name: 'Boeing 777X', manufacturer: 'Boeing', type: 'wide-body', capacity: 426, range: 13500, cruiseSpeed: 956 },
  '787': { name: 'Boeing 787 Dreamliner', manufacturer: 'Boeing', type: 'wide-body', capacity: 296, range: 13621, cruiseSpeed: 956 },
  '788': { name: 'Boeing 787-8', manufacturer: 'Boeing', type: 'wide-body', capacity: 248, range: 13621, cruiseSpeed: 956 },
  '789': { name: 'Boeing 787-9', manufacturer: 'Boeing', type: 'wide-body', capacity: 296, range: 14140, cruiseSpeed: 956 },
  '78J': { name: 'Boeing 787-10', manufacturer: 'Boeing', type: 'wide-body', capacity: 336, range: 11910, cruiseSpeed: 956 },

  // Airbus A220 family (formerly Bombardier C Series)
  '221': { name: 'Airbus A220-100', manufacturer: 'Airbus', type: 'regional', capacity: 135, range: 5920, cruiseSpeed: 871 },
  '223': { name: 'Airbus A220-300', manufacturer: 'Airbus', type: 'regional', capacity: 160, range: 6300, cruiseSpeed: 871 },
  'BCS1': { name: 'Airbus A220-100', manufacturer: 'Airbus', type: 'regional', capacity: 135, range: 5920, cruiseSpeed: 871 },
  'BCS3': { name: 'Airbus A220-300', manufacturer: 'Airbus', type: 'regional', capacity: 160, range: 6300, cruiseSpeed: 871 },
  'CS1': { name: 'Airbus A220-100', manufacturer: 'Airbus', type: 'regional', capacity: 135, range: 5920, cruiseSpeed: 871 },
  'CS3': { name: 'Airbus A220-300', manufacturer: 'Airbus', type: 'regional', capacity: 160, range: 6300, cruiseSpeed: 871 },

  // Boeing 737 variants
  '73J': { name: 'Boeing 737-900ER', manufacturer: 'Boeing', type: 'jet', capacity: 220, range: 5460, cruiseSpeed: 903 },
  '73C': { name: 'Boeing 737-300', manufacturer: 'Boeing', type: 'jet', capacity: 149, range: 4400, cruiseSpeed: 903 },
  '73W': { name: 'Boeing 737-700', manufacturer: 'Boeing', type: 'jet', capacity: 149, range: 5000, cruiseSpeed: 903 },
  '7M7': { name: 'Boeing 737 MAX 7', manufacturer: 'Boeing', type: 'jet', capacity: 172, range: 7130, cruiseSpeed: 903 },

  // Embraer E-jet E2 family
  'E7W': { name: 'Embraer E175-E2', manufacturer: 'Embraer', type: 'regional', capacity: 80, range: 4260, cruiseSpeed: 870 },
  'E9W': { name: 'Embraer E190-E2', manufacturer: 'Embraer', type: 'regional', capacity: 114, range: 5278, cruiseSpeed: 870 },
  'E9X': { name: 'Embraer E195-E2', manufacturer: 'Embraer', type: 'regional', capacity: 146, range: 4206, cruiseSpeed: 870 },
  'E75L': { name: 'Embraer E175-E2', manufacturer: 'Embraer', type: 'regional', capacity: 80, range: 4260, cruiseSpeed: 870 },

  // Airbus A321 variants
  '31X': { name: 'Airbus A321XLR', manufacturer: 'Airbus', type: 'jet', capacity: 244, range: 8700, cruiseSpeed: 903 },
  '32T': { name: 'Airbus A321neo (LR)', manufacturer: 'Airbus', type: 'jet', capacity: 206, range: 7400, cruiseSpeed: 903 },

  // Misc
  'SU9': { name: 'Sukhoi Superjet 100', manufacturer: 'Sukhoi', type: 'regional', capacity: 98, range: 4578, cruiseSpeed: 830 },
  'AN4': { name: 'Antonov AN-148', manufacturer: 'Antonov', type: 'regional', capacity: 75, range: 4400, cruiseSpeed: 835 },
};
