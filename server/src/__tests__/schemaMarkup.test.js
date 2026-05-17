'use strict';
const sm = require('../services/schemaMarkup');

describe('schemaMarkup.airport', () => {
  const ork = { iata: 'ORK', icao: 'EICK', name: 'Cork', city: 'Cork', country: 'Ireland',
                country_code: 'IE', latitude: 51.85, longitude: -8.49, elevation: 502 };

  it('builds Airport JSON-LD with required fields', () => {
    const obj = sm.airport(ork);
    expect(obj['@type']).toBe('Airport');
    expect(obj.iataCode).toBe('ORK');
    expect(obj.icaoCode).toBe('EICK');
    expect(obj.geo['@type']).toBe('GeoCoordinates');
    expect(obj.geo.latitude).toBe(51.85);
    expect(obj.address.addressCountry).toBe('IE');
  });

  it('uses Place not Country for spatialCoverage (memory trap)', () => {
    const obj = sm.airport(ork);
    if (obj.spatialCoverage) {
      expect(obj.spatialCoverage['@type']).toBe('Place');
    }
  });
});

describe('schemaMarkup.breadcrumb', () => {
  it('builds BreadcrumbList with 3 levels', () => {
    const obj = sm.breadcrumb([
      { name: 'Home', url: 'https://himaxym.com/' },
      { name: 'Airports', url: 'https://himaxym.com/flights-from' },
      { name: 'Cork (ORK)', url: 'https://himaxym.com/flights-from/ORK' },
    ]);
    expect(obj['@type']).toBe('BreadcrumbList');
    expect(obj.itemListElement).toHaveLength(3);
    expect(obj.itemListElement[2].position).toBe(3);
  });
});

describe('schemaMarkup.faqPage', () => {
  it('builds FAQPage with Q/A pairs', () => {
    const obj = sm.faqPage([
      { question: 'How many airlines fly from Cork?', answer: '8 airlines operate non-stop flights from Cork Airport.' },
    ]);
    expect(obj['@type']).toBe('FAQPage');
    expect(obj.mainEntity[0]['@type']).toBe('Question');
    expect(obj.mainEntity[0].acceptedAnswer['@type']).toBe('Answer');
  });
});

describe('schemaMarkup safety against memory traps', () => {
  it('aircraft schema uses Thing, never Vehicle', () => {
    const obj = sm.aircraftType({ code: 'A320', name: 'Airbus A320' });
    expect(obj['@type']).toBe('Thing');
  });

  it('flight route schema does NOT emit Offer', () => {
    const obj = sm.route({ origin_iata: 'ORK', dest_iata: 'LHR', km: 557, duration_min: 78 });
    expect(JSON.stringify(obj)).not.toMatch(/"Offer"/);
  });
});
