'use strict';
const { db } = require('../models/db');
const model  = require('../models/accidentNarratives');

jest.mock('../services/sidecarAccidentsClient', () => ({
  getAccidentById: jest.fn(),
  getAccidentIdBySourceEventId: jest.fn(),
  findRelatedByAircraft: jest.fn(),
  findRelatedByOperator: jest.fn(),
}));
const sidecar = require('../services/sidecarAccidentsClient');
const svc = require('../services/accidentNarrativeService');

const NOW = 1715500000;

beforeEach(() => {
  db.exec(`DELETE FROM accident_narratives`);
  jest.clearAllMocks();
});

describe('accidentNarrativeService.getBySlug', () => {
  it('merges narrative + sidecar facts + related events', () => {
    model.upsert({
      accident_id: 42, source: 'ntsb', source_event_id: 'E42',
      source_url: 'https://carol.ntsb.gov/event/E42',
      slug: 'test-slug', narrative_text: 'x'.repeat(400),
      probable_cause: 'y'.repeat(150), factors_json: '["A"]',
      phase_of_flight: 'CRUISE', weather_summary: 'VMC',
      fetched_at: NOW, ingested_at: NOW, updated_at: NOW,
    });
    sidecar.getAccidentById.mockReturnValue({
      id: 42, date: '25 Apr 2026', aircraft_model: 'BEECH F33A',
      operator: 'Private', fatalities: '2', location: 'Minneapolis, MN',
      lat: 44.97, lon: -93.26, source_url: 'https://carol.ntsb.gov/event/E42',
    });
    sidecar.findRelatedByAircraft.mockReturnValue([{ id: 100, aircraft_model: 'BEECH F33A' }]);
    sidecar.findRelatedByOperator.mockReturnValue([{ id: 200, operator: 'Private' }]);

    const res = svc.getBySlug('test-slug');
    expect(res.slug).toBe('test-slug');
    expect(res.narrative_text).toBe('x'.repeat(400));
    expect(res.facts.aircraft_model).toBe('BEECH F33A');
    expect(res.facts.fatalities).toBe('2');
    expect(res.related.byAircraft).toHaveLength(1);
    expect(res.related.byOperator).toHaveLength(1);
    expect(res.factors).toEqual(['A']);
  });

  it('returns null when slug not found', () => {
    expect(svc.getBySlug('does-not-exist')).toBeNull();
  });

  it('returns null when sidecar accident missing (orphan narrative)', () => {
    model.upsert({
      accident_id: 99, source: 'ntsb', source_event_id: 'E99',
      source_url: 'http://x', slug: 'orphan', narrative_text: null,
      probable_cause: null, factors_json: null, phase_of_flight: null,
      weather_summary: null, fetched_at: NOW, ingested_at: NOW, updated_at: NOW,
    });
    sidecar.getAccidentById.mockReturnValue(null);
    expect(svc.getBySlug('orphan')).toBeNull();
  });
});
