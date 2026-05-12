'use strict';
const { extractRegistration } = require('../utils/extractRegistration');

describe('extractRegistration', () => {
  it('finds N-number in middle of narrative', () => {
    expect(extractRegistration(
      'On January 1, a Piper PA 28-180, N8037W, collided in flight at Sonoma.'
    )).toBe('N8037W');
  });

  it('returns first match when multiple present (two aircraft collision)', () => {
    expect(extractRegistration(
      'A Piper PA 28-180, N8037W, and a Glastar, N15EX, collided at Sonoma.'
    )).toBe('N8037W');
  });

  it('matches N + 1-5 digits + 1-2 letters', () => {
    expect(extractRegistration('Cessna N123AB')).toBe('N123AB');
    expect(extractRegistration('Beech N99999AA')).toBe('N99999AA');
    expect(extractRegistration('Piper N1 attempted')).toBe('N1');
  });

  it('does not match non-N tail (G-, EI-, etc.)', () => {
    expect(extractRegistration('G-BOAA was the registration')).toBeNull();
    expect(extractRegistration('Just N or N alone')).toBeNull();
  });

  it('null / empty / non-string → null', () => {
    expect(extractRegistration(null)).toBeNull();
    expect(extractRegistration('')).toBeNull();
    expect(extractRegistration(undefined)).toBeNull();
  });

  it('does not match N in random word (Newcastle, NTSB)', () => {
    // No digits after N → no match.
    expect(extractRegistration('NTSB Newcastle November')).toBeNull();
  });
});
