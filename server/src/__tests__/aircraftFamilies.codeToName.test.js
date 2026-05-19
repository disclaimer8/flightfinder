'use strict';

const { getFamilyByCode } = require('../models/aircraftFamilies');

describe('aircraftFamilies — code → family precedence', () => {
  it('A319 resolves to specific "Airbus A319" family, not umbrella', () => {
    const fam = getFamilyByCode('A319');
    expect(fam?.name).toBe('Airbus A319');
    expect(fam?.label).toBe('Airbus A319');
  });

  it('A320 resolves to specific "Airbus A320" family', () => {
    const fam = getFamilyByCode('A320');
    expect(fam?.name).toBe('Airbus A320');
  });

  it('A321 resolves to specific "Airbus A321" family', () => {
    const fam = getFamilyByCode('A321');
    expect(fam?.name).toBe('Airbus A321');
  });

  it('B789 resolves to "Boeing 787"', () => {
    const fam = getFamilyByCode('B789');
    expect(fam?.name).toBe('Boeing 787');
  });

  it('Unknown code returns null', () => {
    expect(getFamilyByCode('XXXX')).toBeNull();
  });
});
