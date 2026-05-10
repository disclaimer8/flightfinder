// server/src/__tests__/safetyRating.test.js
const { colorBand, topNotable, groupByDecade, breakdownByVariant } =
  require('../services/safetyRating');

const NOW = Date.parse('2026-05-10T00:00:00Z');

function ev(date, fatalities = 1, icao = 'B789', narrative = '') {
  return {
    occurred_at: Date.parse(date),
    fatalities,
    aircraft_icao_type: icao,
    severity: 'fatal',
    narrative,
  };
}

describe('colorBand', () => {
  it('returns green when no fatal events on record', () => {
    expect(colorBand([], NOW)).toMatchObject({
      bucket: 'green',
      label: 'No fatal hull losses on record',
      lastFatalDate: null,
    });
  });

  it('returns light-green when last fatal was >20 years ago', () => {
    const out = colorBand([ev('2003-01-01')], NOW);
    expect(out.bucket).toBe('light-green');
    expect(out.label).toMatch(/20\+ years/);
  });

  it('returns yellow when last fatal was 5-20 years ago', () => {
    const out = colorBand([ev('2010-01-01')], NOW);
    expect(out.bucket).toBe('yellow');
    expect(out.label).toMatch(/2010/);
  });

  it('returns orange when last fatal was 1-5 years ago', () => {
    const out = colorBand([ev('2024-01-01')], NOW);
    expect(out.bucket).toBe('orange');
    expect(out.label).toMatch(/2024/);
  });

  it('returns red when last fatal was less than 1 year ago', () => {
    const out = colorBand([ev('2025-12-01')], NOW);
    expect(out.bucket).toBe('red');
    expect(out.label).toMatch(/2025-12-01/);
  });

  it('uses the most recent event when many are present', () => {
    const out = colorBand(
      [ev('2003-01-01'), ev('2010-01-01'), ev('2024-01-01')],
      NOW,
    );
    expect(out.bucket).toBe('orange');
  });
});

describe('topNotable', () => {
  it('sorts by fatalities DESC, then occurred_at DESC', () => {
    const a = ev('2010-01-01', 100);
    const b = ev('2020-01-01', 200);
    const c = ev('2024-01-01', 100);
    const out = topNotable([a, b, c], 5);
    expect(out).toEqual([b, c, a]);
  });

  it('caps at n', () => {
    const events = Array.from({ length: 10 }, (_, i) => ev('2020-01-01', i + 1));
    expect(topNotable(events, 3)).toHaveLength(3);
  });

  it('returns [] for empty input', () => {
    expect(topNotable([], 5)).toEqual([]);
  });
});

describe('groupByDecade', () => {
  it('groups events by decade label', () => {
    const out = groupByDecade([
      ev('1985-01-01'),
      ev('1992-01-01'),
      ev('2008-01-01'),
      ev('2024-01-01'),
    ]);
    expect(Object.keys(out).sort()).toEqual(['1980s', '1990s', '2000s', '2020s']);
    expect(out['1980s']).toHaveLength(1);
  });

  it('handles empty input', () => {
    expect(groupByDecade([])).toEqual({});
  });
});

describe('breakdownByVariant', () => {
  it('counts events per aircraft_icao_type', () => {
    const out = breakdownByVariant([
      ev('2020-01-01', 1, 'B788'),
      ev('2021-01-01', 1, 'B789'),
      ev('2022-01-01', 1, 'B788'),
    ]);
    expect(out).toEqual({ B788: 2, B789: 1 });
  });
});
