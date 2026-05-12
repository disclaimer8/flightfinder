'use strict';

// FAA N-number tail registration: 'N' + 1-5 digits, optionally followed by
// 1-2 letters. Examples: N12345, N123AB, N1, N99999AA.
// Picks the FIRST occurrence in narrative_text — NTSB narratives typically
// open with "...airplane, N1234X, collided..." so first hit is the subject.
const N_NUMBER_RE = /\bN\d{1,5}[A-Z]{0,2}\b/;

function extractRegistration(text) {
  if (!text) return null;
  const m = String(text).match(N_NUMBER_RE);
  return m ? m[0] : null;
}

module.exports = { extractRegistration };
