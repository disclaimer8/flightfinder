'use strict';

const { getFamilyList } = require('../models/aircraftFamilies');

describe('aircraftFamilies.getFamilyList — canonicalIcao field', () => {
  const list = getFamilyList();

  it('all families expose a non-empty canonicalIcao', () => {
    for (const fam of list) {
      expect(fam.canonicalIcao).toBeTruthy();
      expect(typeof fam.canonicalIcao).toBe('string');
      expect(fam.canonicalIcao).toMatch(/^[A-Z][A-Z0-9]{2,4}$/);
    }
  });

  it('Boeing 787 → B789 (canonical mainline variant)', () => {
    const fam = list.find(f => f.name === 'Boeing 787');
    expect(fam?.canonicalIcao).toBe('B789');
  });

  it('Airbus A320 → A320', () => {
    const fam = list.find(f => f.name === 'Airbus A320');
    expect(fam?.canonicalIcao).toBe('A320');
  });

  it('Boeing 777 → B77W (most common variant)', () => {
    const fam = list.find(f => f.name === 'Boeing 777');
    expect(fam?.canonicalIcao).toBe('B77W');
  });
});
