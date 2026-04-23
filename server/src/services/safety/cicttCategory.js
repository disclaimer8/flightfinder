'use strict';

// CICTT category lookup. Keys are normalized (uppercase, trimmed). When NTSB
// adds new occurrence_type strings we don't recognize we return 'OTHR' so the
// pipeline never crashes — track unknown values via Sentry breadcrumbs at the
// adapter level.
const CICTT = new Map([
  ['LOSS OF CONTROL - INFLIGHT',        'LOC-I'],
  ['LOSS OF CONTROL - GROUND',          'LOC-G'],
  ['RUNWAY EXCURSION',                  'RE'],
  ['RUNWAY INCURSION',                  'RI'],
  ['CONTROLLED FLIGHT INTO TERRAIN',    'CFIT'],
  ['MIDAIR COLLISION',                  'MAC'],
  ['BIRD STRIKE',                       'BIRD'],
  ['BIRD/ANIMAL STRIKE',                'BIRD'],
  ['TURBULENCE ENCOUNTER',              'TURB'],
  ['FUEL EXHAUSTION',                   'FUEL'],
  ['FUEL STARVATION',                   'FUEL'],
  ['FUEL CONTAMINATION',                'FUEL'],
  ['POWERPLANT FAILURE',                'SCF-PP'],
  ['SYSTEM/COMPONENT FAILURE - NON-PP', 'SCF-NP'],
  ['SYSTEM/COMPONENT FAILURE - POWERPLANT', 'SCF-PP'],
  ['ICING',                             'ICE'],
  ['UNDERSHOOT/OVERSHOOT',              'USOS'],
  ['ABNORMAL RUNWAY CONTACT',           'ARC'],
  ['LOW ALTITUDE OPERATIONS',           'LALT'],
  ['EVACUATION',                        'EVAC'],
  ['FIRE/SMOKE (NON-IMPACT)',           'F-NI'],
  ['FIRE/SMOKE (POST-IMPACT)',          'F-POST'],
  ['UNKNOWN OR UNDETERMINED',           'UNK'],
]);

function mapCicttCategory(occurrenceType) {
  const key = String(occurrenceType || '').trim().toUpperCase();
  if (!key) return 'OTHR';
  return CICTT.get(key) || 'OTHR';
}

const PHASES = new Map([
  ['STANDING',      'STD'],
  ['TAXI',          'TXI'],
  ['TAKEOFF',       'TOF'],
  ['INITIAL CLIMB', 'ICL'],
  ['CLIMB',         'CLB'],
  ['CRUISE',        'CRZ'],
  ['DESCENT',       'DST'],
  ['APPROACH',      'APR'],
  ['LANDING',       'LDG'],
  ['MANEUVERING',   'MNV'],
  ['EMERGENCY DESCENT', 'EMD'],
]);

function mapPhaseOfFlight(phase) {
  const key = String(phase || '').trim().toUpperCase();
  if (!key) return 'UNK';
  return PHASES.get(key) || 'UNK';
}

module.exports = { mapCicttCategory, mapPhaseOfFlight };
