/**
 * Hand-curated catalog of aircraft variants. Each entry is a single ICAO
 * code that we expose as a dedicated /aircraft/{family}/variants/{slug}
 * SEO landing page.
 *
 * Adding a new variant: pick the ICAO code from aircraftFamilies.js
 * `codes` Set, choose a URL-safe slug, write a 1-paragraph description
 * referencing the manufacturer's spec sheet or Wikipedia.
 */

const VARIANTS = [
  // ── Boeing 787 ──────────────────────────────────────────────────────
  {
    familySlug: 'boeing-787',
    icao: 'B788',
    iata: '788',
    slug: '787-8',
    shortName: '787-8',
    fullName: 'Boeing 787-8 Dreamliner',
    firstFlight: '2009-12-15',
    capacity: '242 pax (typical 2-class)',
    range_km: 13620,
    engines: ['GE GEnx-1B', 'Rolls-Royce Trent 1000'],
    description:
      'Original variant of the Boeing 787 Dreamliner family. Twin-aisle wide-body designed for long-range routes that previously required four-engine aircraft, with composite fuselage and high-bypass engines that cut fuel burn by ~20% versus the 767 it replaced.',
  },
  {
    familySlug: 'boeing-787',
    icao: 'B789',
    iata: '789',
    slug: '787-9',
    shortName: '787-9',
    fullName: 'Boeing 787-9 Dreamliner',
    firstFlight: '2013-09-17',
    capacity: '290 pax (typical 2-class)',
    range_km: 14140,
    engines: ['GE GEnx-1B', 'Rolls-Royce Trent 1000'],
    description:
      'Stretched variant of the 787 family, 6m longer than the 787-8 with higher MTOW and longer range. Most-produced 787 variant; operated by the majority of Dreamliner customers worldwide.',
  },
  {
    familySlug: 'boeing-787',
    icao: 'B78X',
    iata: '78J',
    slug: '787-10',
    shortName: '787-10',
    fullName: 'Boeing 787-10 Dreamliner',
    firstFlight: '2017-03-31',
    capacity: '330 pax (typical 2-class)',
    range_km: 11910,
    engines: ['GE GEnx-1B', 'Rolls-Royce Trent 1000'],
    description:
      'Further-stretched variant, 5.5m longer than the 787-9. Trades range for capacity, optimised for high-density medium- to long-haul markets in Asia and Europe.',
  },

  // ── Boeing 737 ──────────────────────────────────────────────────────
  {
    familySlug: 'boeing-737',
    icao: 'B737',
    iata: '733',
    slug: '737-classic',
    shortName: '737 Classic',
    fullName: 'Boeing 737 Classic (300/400/500)',
    firstFlight: '1984-02-24',
    capacity: '108-188 pax',
    range_km: 5000,
    engines: ['CFM56-3'],
    description:
      'Second generation of the 737 family. Re-engined with high-bypass CFM56 turbofans and aerodynamic refinements over the original 737-100/200. Largely retired from passenger service; some still flying as freighters.',
  },
  {
    familySlug: 'boeing-737',
    icao: 'B738',
    iata: '738',
    slug: '737-800',
    shortName: '737-800',
    fullName: 'Boeing 737-800 (Next Generation)',
    firstFlight: '1997-07-31',
    capacity: '162-189 pax',
    range_km: 5765,
    engines: ['CFM56-7B'],
    description:
      'Most-produced 737 Next Generation variant. Workhorse of low-cost carriers worldwide; over 5,000 delivered. Stretched 737-700 with winglets, modern flight deck, and CFM56-7B engines.',
  },
  {
    familySlug: 'boeing-737',
    icao: 'B739',
    iata: '739',
    slug: '737-900',
    shortName: '737-900',
    fullName: 'Boeing 737-900 / 900ER',
    firstFlight: '2000-08-03',
    capacity: '177-220 pax',
    range_km: 5925,
    engines: ['CFM56-7B'],
    description:
      'Largest 737 NG variant. Stretched 737-800 with extended-range option (737-900ER) used by Delta, United, Alaska, and Lion Air.',
  },
  {
    familySlug: 'boeing-737',
    icao: 'B38M',
    iata: '7M8',
    slug: '737-max-8',
    shortName: '737 MAX 8',
    fullName: 'Boeing 737 MAX 8',
    firstFlight: '2016-01-29',
    capacity: '162-200 pax',
    range_km: 6570,
    engines: ['CFM LEAP-1B'],
    description:
      'Fourth-generation 737 with CFM LEAP-1B engines and improved aerodynamics, marketed as 14% more fuel-efficient than the 737-800. Grounded worldwide March 2019 to December 2020 following two fatal crashes (Lion Air 610, Ethiopian 302); returned to service after MCAS software and crew training revisions.',
  },
  {
    familySlug: 'boeing-737',
    icao: 'B39M',
    iata: '7M9',
    slug: '737-max-9',
    shortName: '737 MAX 9',
    fullName: 'Boeing 737 MAX 9',
    firstFlight: '2017-04-13',
    capacity: '178-220 pax',
    range_km: 6570,
    engines: ['CFM LEAP-1B'],
    description:
      'Stretched MAX variant competing with the Airbus A321neo. Operated by United, Alaska, Copa, Lion Air. Subject to door-plug inspection orders following the January 2024 Alaska Airlines 1282 incident.',
  },

  // ── Boeing 757 ──────────────────────────────────────────────────────
  {
    familySlug: 'boeing-757',
    icao: 'B752',
    iata: '752',
    slug: '757-200',
    shortName: '757-200',
    fullName: 'Boeing 757-200',
    firstFlight: '1982-02-19',
    capacity: '200-239 pax',
    range_km: 7250,
    engines: ['Rolls-Royce RB211-535', 'Pratt & Whitney PW2000'],
    description:
      'Most-produced 757 variant. Narrow-body twinjet with the range and runway performance of a wide-body; used by Delta, United, Icelandair, and many cargo operators. No direct successor until the A321XLR; widely seen as the aircraft Boeing failed to replace.',
  },

  // ── Boeing 777 ──────────────────────────────────────────────────────
  {
    familySlug: 'boeing-777',
    icao: 'B772',
    iata: '772',
    slug: '777-200',
    shortName: '777-200',
    fullName: 'Boeing 777-200',
    firstFlight: '1994-06-12',
    capacity: '305-400 pax',
    range_km: 9700,
    engines: ['Pratt & Whitney PW4000', 'Rolls-Royce Trent 800', 'GE90'],
    description:
      'Original Boeing 777 variant. First commercial twinjet to enter service with full ETOPS clearance for trans-oceanic routes.',
  },
  {
    familySlug: 'boeing-777',
    icao: 'B77L',
    iata: '77L',
    slug: '777-200lr',
    shortName: '777-200LR',
    fullName: 'Boeing 777-200LR Worldliner',
    firstFlight: '2005-03-08',
    capacity: '301 pax',
    range_km: 17370,
    engines: ['GE90-110B1L', 'GE90-115BL'],
    description:
      'Ultra-long-range variant. Held the record for longest commercial flight (17,000+ km, ~19 hours) for over a decade until the A350-900ULR.',
  },
  {
    familySlug: 'boeing-777',
    icao: 'B77W',
    iata: '77W',
    slug: '777-300er',
    shortName: '777-300ER',
    fullName: 'Boeing 777-300ER',
    firstFlight: '2003-02-24',
    capacity: '396 pax',
    range_km: 13650,
    engines: ['GE90-115BL'],
    description:
      'Best-selling 777 variant. Twin-engine wide-body of choice for 6,000-13,000 km routes. Operated by Emirates (largest fleet), Cathay Pacific, Air France, ANA, and most flag carriers.',
  },

  // ── Boeing 747 ──────────────────────────────────────────────────────
  {
    familySlug: 'boeing-747',
    icao: 'B744',
    iata: '744',
    slug: '747-400',
    shortName: '747-400',
    fullName: 'Boeing 747-400',
    firstFlight: '1988-04-29',
    capacity: '416-660 pax',
    range_km: 13450,
    engines: ['Pratt & Whitney PW4000', 'GE CF6-80C2', 'Rolls-Royce RB211-524'],
    description:
      'Most successful 747 variant with over 690 built. Glass cockpit, two-pilot crew, winglets, extended range. Largely retired from passenger service in the 2010s; still active as freighter.',
  },
  {
    familySlug: 'boeing-747',
    icao: 'B748',
    iata: '74H',
    slug: '747-8',
    shortName: '747-8',
    fullName: 'Boeing 747-8 Intercontinental',
    firstFlight: '2010-02-08',
    capacity: '410-605 pax',
    range_km: 14320,
    engines: ['GEnx-2B67'],
    description:
      'Final and largest 747 variant. Stretched fuselage, GEnx engines (shared with the 787), redesigned wing. Production ended 2022; remaining passenger fleet flown by Lufthansa, Korean Air, Air China.',
  },

  // ── Airbus A320 family ──────────────────────────────────────────────
  {
    familySlug: 'airbus-a319',
    icao: 'A319',
    iata: '319',
    slug: 'a319',
    shortName: 'A319',
    fullName: 'Airbus A319',
    firstFlight: '1995-08-25',
    capacity: '124-156 pax',
    range_km: 6850,
    engines: ['CFM56-5B', 'IAE V2500'],
    description:
      'Shortened variant of the A320. Operated by easyJet, American, Frontier, and many smaller carriers. Replaced in production by the A319neo.',
  },
  {
    familySlug: 'airbus-a320',
    icao: 'A320',
    iata: '320',
    slug: 'a320ceo',
    shortName: 'A320ceo',
    fullName: 'Airbus A320 (current engine option)',
    firstFlight: '1987-02-22',
    capacity: '150-186 pax',
    range_km: 6150,
    engines: ['CFM56-5B', 'IAE V2500'],
    description:
      'Best-selling Airbus narrow-body. Original A320 variant with CFM56 or V2500 engines. Replaced in production by the A320neo from 2016 onwards but remains in widespread service.',
  },
  {
    familySlug: 'airbus-a320',
    icao: 'A20N',
    iata: '32N',
    slug: 'a320neo',
    shortName: 'A320neo',
    fullName: 'Airbus A320neo (new engine option)',
    firstFlight: '2014-09-25',
    capacity: '150-194 pax',
    range_km: 6300,
    engines: ['CFM LEAP-1A', 'Pratt & Whitney PW1100G'],
    description:
      'Re-engined A320. PW1100G geared turbofan or CFM LEAP-1A; ~15% lower fuel burn than the A320ceo. Best-selling commercial aircraft of the late 2010s.',
  },
  {
    familySlug: 'airbus-a321',
    icao: 'A321',
    iata: '321',
    slug: 'a321ceo',
    shortName: 'A321ceo',
    fullName: 'Airbus A321 (current engine option)',
    firstFlight: '1993-03-11',
    capacity: '185-236 pax',
    range_km: 5950,
    engines: ['CFM56-5B', 'IAE V2500'],
    description:
      'Stretched A320 variant. Operated by American, Lufthansa, Turkish, JetBlue, and many narrow-body operators needing 200+ seats.',
  },
  {
    familySlug: 'airbus-a321',
    icao: 'A21N',
    iata: '32Q',
    slug: 'a321neo',
    shortName: 'A321neo',
    fullName: 'Airbus A321neo',
    firstFlight: '2016-02-09',
    capacity: '180-244 pax',
    range_km: 7400,
    engines: ['CFM LEAP-1A', 'Pratt & Whitney PW1100G'],
    description:
      'Re-engined A321 with extended-range option (A321LR) and ultra-long-range option (A321XLR). Designed to replace 757-200 on transatlantic routes.',
  },

  // ── Airbus A330 ─────────────────────────────────────────────────────
  {
    familySlug: 'airbus-a330',
    icao: 'A332',
    iata: '332',
    slug: 'a330-200',
    shortName: 'A330-200',
    fullName: 'Airbus A330-200',
    firstFlight: '1997-08-13',
    capacity: '247-293 pax',
    range_km: 13450,
    engines: ['Pratt & Whitney PW4000', 'Rolls-Royce Trent 700', 'GE CF6-80E1'],
    description:
      'Shorter, longer-range variant of the A330. Twin-engine wide-body for medium-to-long-haul routes that don\'t fill the larger -300.',
  },
  {
    familySlug: 'airbus-a330',
    icao: 'A333',
    iata: '333',
    slug: 'a330-300',
    shortName: 'A330-300',
    fullName: 'Airbus A330-300',
    firstFlight: '1992-11-02',
    capacity: '277-440 pax',
    range_km: 11750,
    engines: ['Pratt & Whitney PW4000', 'Rolls-Royce Trent 700', 'GE CF6-80E1'],
    description:
      'Larger of the two original A330 variants. High-capacity twin-aisle for short-to-medium long-haul, especially popular in Asia.',
  },

  // ── Airbus A350 ─────────────────────────────────────────────────────
  {
    familySlug: 'airbus-a350',
    icao: 'A359',
    iata: '359',
    slug: 'a350-900',
    shortName: 'A350-900',
    fullName: 'Airbus A350-900',
    firstFlight: '2013-06-14',
    capacity: '300-410 pax',
    range_km: 15000,
    engines: ['Rolls-Royce Trent XWB-84'],
    description:
      'Original A350 variant. Composite fuselage, all-new wing, Rolls-Royce Trent XWB. Direct competitor to the 787-9; operated by Singapore, Cathay, Qatar, Lufthansa.',
  },
  {
    familySlug: 'airbus-a350',
    icao: 'A35K',
    iata: '351',
    slug: 'a350-1000',
    shortName: 'A350-1000',
    fullName: 'Airbus A350-1000',
    firstFlight: '2016-11-24',
    capacity: '350-480 pax',
    range_km: 16100,
    engines: ['Rolls-Royce Trent XWB-97'],
    description:
      'Stretched A350 variant. 7m longer than the -900, higher MTOW, more powerful Trent XWB-97 engines. Replaces 777-300ER on the highest-density long-haul routes.',
  },

  // ── Airbus A380 ─────────────────────────────────────────────────────
  {
    familySlug: 'airbus-a380',
    icao: 'A388',
    iata: '388',
    slug: 'a380-800',
    shortName: 'A380-800',
    fullName: 'Airbus A380-800',
    firstFlight: '2005-04-27',
    capacity: '525 pax (typical 3-class)',
    range_km: 15200,
    engines: ['Rolls-Royce Trent 900', 'Engine Alliance GP7200'],
    description:
      'Largest passenger aircraft in service. Full-length double-deck quadjet. Production ended 2021; primarily operated by Emirates (largest fleet), Singapore, British Airways, Qantas, Korean Air.',
  },

  // ── Embraer E-Jets ──────────────────────────────────────────────────
  {
    familySlug: 'embraer-e170-e175',
    icao: 'E170',
    iata: 'E70',
    slug: 'e170',
    shortName: 'E170',
    fullName: 'Embraer 170',
    firstFlight: '2002-02-19',
    capacity: '70-78 pax',
    range_km: 3892,
    engines: ['GE CF34-8E'],
    description:
      'Smallest E-Jet. Regional twinjet, popular with US scope-clause-bound regionals (SkyWest, Republic) and European regional carriers.',
  },
  {
    familySlug: 'embraer-e170-e175',
    icao: 'E75L',
    iata: 'E75',
    slug: 'e175',
    shortName: 'E175',
    fullName: 'Embraer 175',
    firstFlight: '2003-06-14',
    capacity: '78-88 pax',
    range_km: 3704,
    engines: ['GE CF34-8E'],
    description:
      'Most-produced E-Jet variant. Workhorse of US regional fleets operating under American Eagle, Delta Connection, United Express, Alaska Horizon brands.',
  },
  {
    familySlug: 'embraer-e190-e195',
    icao: 'E190',
    iata: 'E90',
    slug: 'e190',
    shortName: 'E190',
    fullName: 'Embraer 190',
    firstFlight: '2004-03-12',
    capacity: '94-114 pax',
    range_km: 4537,
    engines: ['GE CF34-10E'],
    description:
      'Larger E-Jet variant. Operated by JetBlue, KLM Cityhopper, Air Canada, Helvetic.',
  },
  {
    familySlug: 'embraer-e190-e195',
    icao: 'E195',
    iata: 'E95',
    slug: 'e195',
    shortName: 'E195',
    fullName: 'Embraer 195',
    firstFlight: '2004-12-07',
    capacity: '100-124 pax',
    range_km: 4260,
    engines: ['GE CF34-10E'],
    description:
      'Largest first-generation E-Jet. Replaced in production by the second-generation E195-E2 (E290 ICAO).',
  },

  // ── ATR ─────────────────────────────────────────────────────────────
  {
    familySlug: 'atr-42-72',
    icao: 'AT72',
    iata: 'AT7',
    slug: 'atr-72',
    shortName: 'ATR 72',
    fullName: 'ATR 72-600',
    firstFlight: '1988-10-27',
    capacity: '70-78 pax',
    range_km: 1528,
    engines: ['Pratt & Whitney Canada PW127'],
    description:
      'Stretched ATR variant. Most successful Western turboprop in production. Operated by Wings Air, Air New Zealand, Aer Lingus Regional, Bangkok Airways.',
  },
  {
    familySlug: 'atr-42-72',
    icao: 'AT45',
    iata: 'AT4',
    slug: 'atr-42',
    shortName: 'ATR 42',
    fullName: 'ATR 42-600',
    firstFlight: '1984-08-16',
    capacity: '40-50 pax',
    range_km: 1480,
    engines: ['Pratt & Whitney Canada PW127'],
    description:
      'Original ATR turboprop. Smaller than the 72; serves thin regional routes.',
  },
];

const BY_KEY = new Map(VARIANTS.map((v) => [`${v.familySlug}/${v.slug}`, v]));
const BY_ICAO = new Map(VARIANTS.map((v) => [v.icao, v]));
const BY_FAMILY = VARIANTS.reduce((acc, v) => {
  (acc[v.familySlug] = acc[v.familySlug] || []).push(v);
  return acc;
}, {});

function getVariantBySlug(familySlug, variantSlug) {
  return BY_KEY.get(`${familySlug}/${variantSlug}`) || null;
}
function getVariantsByFamilySlug(familySlug) {
  return BY_FAMILY[familySlug] || [];
}
function getAllVariants() {
  return VARIANTS;
}
function getVariantByIcao(icao) {
  return BY_ICAO.get(icao) || null;
}

module.exports = {
  getVariantBySlug,
  getVariantsByFamilySlug,
  getAllVariants,
  getVariantByIcao,
};
