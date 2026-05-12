'use strict';
const { detectFamily, severityBand, buildSvg } = require('../services/accidentOgImage');

describe('detectFamily', () => {
  it('Boeing variants', () => {
    expect(detectFamily('Boeing 767-424ER')).toBe('boeing');
    expect(detectFamily('BOEING 777 236')).toBe('boeing');
    expect(detectFamily('B737-800')).toBe('boeing');
  });
  it('Airbus variants', () => {
    expect(detectFamily('Airbus A321-271NX')).toBe('airbus');
    expect(detectFamily('A350-900')).toBe('airbus');
  });
  it('General aviation', () => {
    expect(detectFamily('PIPER PA 28-180')).toBe('piper');
    expect(detectFamily('CESSNA 208')).toBe('cessna');
    expect(detectFamily('BEECH F33A')).toBe('beechcraft');
  });
  it('Regional', () => {
    expect(detectFamily('ATR 72-600')).toBe('atr');
    expect(detectFamily('Embraer EMB-120RT Brasilia')).toBe('embraer');
    expect(detectFamily('Bombardier DHC-8-402Q Dash 8')).toBe('bombardier');
    expect(detectFamily('Canadair CRJ-900LR')).toBe('bombardier');
  });
  it('Generic fallback', () => {
    expect(detectFamily('Unknown make')).toBe('generic');
    expect(detectFamily(null)).toBe('generic');
    expect(detectFamily('')).toBe('generic');
  });
});

describe('severityBand', () => {
  it('positive fatality count → red + plural', () => {
    expect(severityBand('14')).toEqual({ color: '#C0392B', label: '14 FATALITIES' });
  });
  it('singular grammar at exactly 1', () => {
    expect(severityBand('1')).toEqual({ color: '#C0392B', label: '1 FATALITY' });
  });
  it("ASN '0+1' sums to 1 fatality (red)", () => {
    expect(severityBand('0+1').label).toBe('1 FATALITY');
  });
  it("'0' string → green", () => {
    expect(severityBand('0')).toEqual({ color: '#1E8449', label: 'NO FATALITIES' });
  });
  it('null / unknown → gray', () => {
    expect(severityBand(null).label).toBe('CASUALTIES UNKNOWN');
    expect(severityBand('Unknown').label).toBe('CASUALTIES UNKNOWN');
  });
});

describe('buildSvg', () => {
  const sample = {
    facts: {
      aircraft_model: 'PIPER PA 28-180',
      operator: 'Timothy Bennett',
      fatalities: '0',
      date: '1 Jan 2008',
      location: 'Sonoma, CA, United States',
      registration: 'N8037W',
    },
  };

  it('produces 1200×630 SVG with required text', () => {
    const svg = buildSvg(sample);
    expect(svg).toMatch(/width="1200"/);
    expect(svg).toMatch(/height="630"/);
    expect(svg).toContain('PIPER PA 28-180');
    expect(svg).toContain('Timothy Bennett');
    expect(svg).toContain('1 Jan 2008');
    expect(svg).toContain('Sonoma, CA, United States');
    expect(svg).toContain('(N8037W)');
    expect(svg).toContain('NO FATALITIES');
    expect(svg).toContain('FlightFinder');
  });

  it('escapes HTML chars in text fields', () => {
    const evil = {
      facts: {
        aircraft_model: 'Boeing <script>alert(1)</script>',
        operator: 'A & B',
        fatalities: '0',
        date: '2020-01-01',
        location: '"quoted"',
      },
    };
    const svg = buildSvg(evil);
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&lt;script&gt;');
    expect(svg).toContain('A &amp; B');
    expect(svg).toContain('&quot;quoted&quot;');
  });
});
