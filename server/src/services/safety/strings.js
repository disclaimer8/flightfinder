'use strict';

// All UI/SEO strings exposed by the safety surface live here so a future i18n
// layer (e.g. server-side resolve(locale)) only touches one file. Keep keys
// stable and plain; do not interpolate raw NTSB text — escape at render time.

const SEVERITY_LABEL = {
  fatal:            'Fatal accident',
  hull_loss:        'Hull loss',
  serious_incident: 'Serious incident',
  incident:         'Incident',
  minor:            'Minor occurrence',
  unknown:          'Unclassified',
};

const CICTT_LABEL = {
  'LOC-I':  'Loss of control in flight',
  'LOC-G':  'Loss of control on ground',
  'RE':     'Runway excursion',
  'RI':     'Runway incursion',
  'CFIT':   'Controlled flight into terrain',
  'MAC':    'Midair collision',
  'BIRD':   'Bird/animal strike',
  'TURB':   'Turbulence encounter',
  'FUEL':   'Fuel-related',
  'SCF-PP': 'Powerplant failure',
  'SCF-NP': 'System/component failure (non-powerplant)',
  'ICE':    'Icing',
  'USOS':   'Undershoot/overshoot',
  'ARC':    'Abnormal runway contact',
  'LALT':   'Low-altitude operations',
  'EVAC':   'Evacuation',
  'F-NI':   'Fire/smoke (non-impact)',
  'F-POST': 'Fire/smoke (post-impact)',
  'UNK':    'Unknown',
  'OTHR':   'Other',
};

module.exports = {
  feedTitle:        'Aviation safety feed',
  feedDescription:  'Recent aviation accidents and incidents from official NTSB records.',
  detailTitlePrefix: 'Aviation safety event',
  paywallCTA:       'Upgrade to Pro for full operator and aircraft history',
  attributionsTitle: 'Data attributions',
  ntsbCredit:       'Aviation accident data: U.S. National Transportation Safety Board (NTSB) — public domain.',
  coverageUsNtsb:   'Coverage: US NTSB only',
  coverageUnknown:  'Global safety data unavailable — our source (NTSB) only tracks US events.',
  severityLabel:    (code) => SEVERITY_LABEL[code] || SEVERITY_LABEL.unknown,
  cicttLabel:       (code) => CICTT_LABEL[code] || CICTT_LABEL.OTHR,
};
