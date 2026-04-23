'use strict';
const { resolveIcaoType } = require('../../src/services/safety/faaModelToIcao');

describe('resolveIcaoType', () => {
  test.each([
    ['BOEING',  '737-800',   'B738'],
    ['Boeing',  '737-800',   'B738'], // case-insensitive
    ['BOEING',  '  737-800 ', 'B738'], // whitespace-tolerant
    ['CESSNA',  '172',       'C172'],
    ['PIPER',   'PA-28',     'P28A'],
    ['CIRRUS',  'SR22',      'SR22'],
    ['EMBRAER', 'ERJ-145',   'E145'],
    ['AIRBUS',  'A320-200',  'A320'],
    ['BOMBARDIER', 'CRJ-700', 'CRJ7'],
  ])('(%s, %s) → %s', (mfr, model, expected) => {
    expect(resolveIcaoType(mfr, model)).toBe(expected);
  });

  test('unknown → null', () => {
    expect(resolveIcaoType('EXPERIMENTAL', 'HOMEBUILT-1')).toBeNull();
  });
  test('null/empty → null', () => {
    expect(resolveIcaoType(null, null)).toBeNull();
    expect(resolveIcaoType('', '')).toBeNull();
  });
});
