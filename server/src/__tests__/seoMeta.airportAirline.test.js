const { resolve, inject } = require('../services/seoMetaService');

function extractJsonLd(html) {
  const m = /<script type="application\/ld\+json">([^<]+)<\/script>/.exec(html);
  return m ? JSON.parse(m[1]) : null;
}

describe('airport meta', () => {
  test('/airport/jfk resolves to kind=airport with uppercased IATA', () => {
    const m = resolve('/airport/jfk');
    expect(m.kind).toBe('airport');
    expect(m.iata).toBe('JFK');
    expect(m.canonical).toBe('https://himaxym.com/airport/jfk');
    expect(m.robots).toBe('index, follow');
    expect(m.title).toMatch(/JFK/);
  });

  test('/airport/toolongiata does not match airport kind', () => {
    const m = resolve('/airport/toolongiata');
    expect(m.kind).not.toBe('airport');
  });

  test('/airport/jfk surfaces real airport name from OpenFlights', () => {
    const m = resolve('/airport/jfk');
    expect(m.airportName).toMatch(/Kennedy/i);
    expect(m.h1).toMatch(/Kennedy/i);
    expect(m.h1).toMatch(/\(JFK\)/);
    expect(m.title).toMatch(/Kennedy/i);
  });

  test('/airport/zzz (unknown IATA) falls back to IATA-only labels', () => {
    const m = resolve('/airport/zzz');
    expect(m.kind).toBe('airport');
    expect(m.airportName).toBe('ZZZ airport');
    expect(m.h1).toContain('ZZZ');
  });
});

describe('airline meta', () => {
  test('/airline/ba resolves to kind=airline', () => {
    const m = resolve('/airline/ba');
    expect(m.kind).toBe('airline');
    expect(m.iata).toBe('BA');
    expect(m.canonical).toBe('https://himaxym.com/airline/ba');
    expect(m.robots).toBe('index, follow');
  });

  test('/airline/abcd (4 chars) does not match airline kind', () => {
    const m = resolve('/airline/abcd');
    expect(m.kind).not.toBe('airline');
  });

  test('/airline/ba surfaces real airline name from OpenFlights', () => {
    const m = resolve('/airline/ba');
    expect(m.airlineName).toMatch(/British Airways/i);
    expect(m.h1).toMatch(/British Airways/i);
    expect(m.title).toMatch(/British Airways/i);
  });

  test('/airline/q1 (unknown IATA) falls back to IATA-only labels', () => {
    // Q1 is not in OpenFlights at fixture-load time; if a future seed adds
    // it, swap to another genuinely-empty 2-char code. The fallback shape is
    // what's being tested, not Q1 itself.
    const m = resolve('/airline/q1');
    expect(m.kind).toBe('airline');
    expect(m.airlineName).toBe('Q1 airline');
    expect(m.h1).toContain('Q1');
  });
});

describe('airline / airport JSON-LD', () => {
  // Minimal HTML shell so inject() can find the head + subtitle anchor.
  const shell = `<!doctype html><html><head><title>x</title></head><body>
    <p style="font-size:clamp(16px,2.2vw,20px)">subtitle</p>
  </body></html>`;

  test('/airline/ba emits Airline schema with iataCode and breadcrumbs', () => {
    const meta = resolve('/airline/ba');
    const html = inject(shell, meta);
    const ld = extractJsonLd(html);
    expect(ld).toBeTruthy();
    expect(ld['@graph']).toBeDefined();
    const airlineNode = ld['@graph'].find((n) => n['@type'] === 'Airline');
    expect(airlineNode).toBeDefined();
    expect(airlineNode.iataCode).toBe('BA');
    expect(airlineNode.name).toMatch(/British Airways/i);
    expect(airlineNode.url).toBe('https://himaxym.com/airline/ba');
    const crumbs = ld['@graph'].find((n) => n['@type'] === 'BreadcrumbList');
    expect(crumbs).toBeDefined();
    expect(crumbs.itemListElement).toHaveLength(2);   // Home → Entity (no broken /airline parent)
  });

  test('/airport/jfk emits Airport schema with iataCode, address, geo', () => {
    const meta = resolve('/airport/jfk');
    const html = inject(shell, meta);
    const ld = extractJsonLd(html);
    expect(ld).toBeTruthy();
    const airportNode = ld['@graph'].find((n) => n['@type'] === 'Airport');
    expect(airportNode).toBeDefined();
    expect(airportNode.iataCode).toBe('JFK');
    expect(airportNode.name).toMatch(/Kennedy/i);
    expect(airportNode.url).toBe('https://himaxym.com/airport/jfk');
    expect(airportNode.address).toBeDefined();
    expect(airportNode.address['@type']).toBe('PostalAddress');
    expect(airportNode.geo).toBeDefined();
    expect(airportNode.geo['@type']).toBe('GeoCoordinates');
    expect(typeof airportNode.geo.latitude).toBe('number');
    expect(typeof airportNode.geo.longitude).toBe('number');
  });
});

describe('safety/global record-count copy', () => {
  test('title cites 40,000+ records since 1980 (not 35K / 5,200 / 1962)', () => {
    const m = resolve('/safety/global');
    expect(m.title).toMatch(/40,000\+ records/);
    expect(m.title).toMatch(/since 1980/);
    expect(m.title).not.toMatch(/35,000|5,200|1962/);
    expect(m.description).toMatch(/40,000\+ records/);
  });
});
