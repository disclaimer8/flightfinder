const { resolve } = require('../services/seoMetaService');

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
});
