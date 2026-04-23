'use strict';
const { mapCicttCategory, mapPhaseOfFlight } = require('../../src/services/safety/cicttCategory');

describe('mapCicttCategory', () => {
  test.each([
    ['LOSS OF CONTROL - INFLIGHT',           'LOC-I'],
    ['LOSS OF CONTROL - GROUND',             'LOC-G'],
    ['RUNWAY EXCURSION',                     'RE'],
    ['RUNWAY INCURSION',                     'RI'],
    ['CONTROLLED FLIGHT INTO TERRAIN',       'CFIT'],
    ['MIDAIR COLLISION',                     'MAC'],
    ['BIRD STRIKE',                          'BIRD'],
    ['BIRD/ANIMAL STRIKE',                   'BIRD'],
    ['TURBULENCE ENCOUNTER',                 'TURB'],
    ['FUEL EXHAUSTION',                      'FUEL'],
    ['FUEL STARVATION',                      'FUEL'],
    ['POWERPLANT FAILURE',                   'SCF-PP'],
    ['SYSTEM/COMPONENT FAILURE - NON-PP',    'SCF-NP'],
    ['ICING',                                'ICE'],
    ['UNDERSHOOT/OVERSHOOT',                 'USOS'],
    ['ABNORMAL RUNWAY CONTACT',              'ARC'],
    ['LOW ALTITUDE OPERATIONS',              'LALT'],
    ['UNKNOWN OR UNDETERMINED',              'UNK'],
    ['FUEL CONTAMINATION',                      'FUEL'],
    ['SYSTEM/COMPONENT FAILURE - POWERPLANT',   'SCF-PP'],
    ['EVACUATION',                              'EVAC'],
    ['FIRE/SMOKE (NON-IMPACT)',                 'F-NI'],
    ['FIRE/SMOKE (POST-IMPACT)',                'F-POST'],
    ['',                                     'OTHR'],
    [null,                                   'OTHR'],
    [undefined,                              'OTHR'],
    ['some completely freeform thing',       'OTHR'],
  ])('%s → %s', (input, expected) => {
    expect(mapCicttCategory(input)).toBe(expected);
  });

  test('case-insensitive', () => {
    expect(mapCicttCategory('runway excursion')).toBe('RE');
    expect(mapCicttCategory('Runway Excursion')).toBe('RE');
  });

  test('whitespace-tolerant', () => {
    expect(mapCicttCategory('  Runway Excursion  ')).toBe('RE');
  });
});

describe('mapPhaseOfFlight', () => {
  test.each([
    ['TAKEOFF',     'TOF'],
    ['INITIAL CLIMB', 'ICL'],
    ['CLIMB',       'CLB'],
    ['CRUISE',      'CRZ'],
    ['DESCENT',     'DST'],
    ['APPROACH',    'APR'],
    ['LANDING',     'LDG'],
    ['TAXI',        'TXI'],
    ['STANDING',    'STD'],
    ['MANEUVERING', 'MNV'],
    ['EMERGENCY DESCENT', 'EMD'],
    ['',            'UNK'],
    [null,          'UNK'],
  ])('%s → %s', (input, expected) => {
    expect(mapPhaseOfFlight(input)).toBe(expected);
  });

  test('whitespace-tolerant', () => {
    expect(mapPhaseOfFlight('  Landing  ')).toBe('LDG');
  });
});
