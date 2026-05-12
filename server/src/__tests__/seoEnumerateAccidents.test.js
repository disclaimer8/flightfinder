'use strict';
const { db } = require('../models/db');
const model = require('../models/accidentNarratives');
const { enumerateAccidents } = require('../services/seoUrlEnumerator');

const NOW = 1715500000;

beforeEach(() => {
  db.exec(`DELETE FROM accident_narratives`);
});

describe('enumerateAccidents', () => {
  it('emits one entry per indexable=1 row, /accidents/{slug}', () => {
    model.upsert({
      accident_id: 1, source: 'ntsb', source_event_id: 'a',
      source_url: 'http://x', slug: 'hi',
      narrative_text: 'x'.repeat(400), probable_cause: 'y'.repeat(150),
      factors_json: '["a"]', phase_of_flight: 'CRUISE', weather_summary: 'VMC',
      fetched_at: NOW, ingested_at: NOW, updated_at: NOW,
    });
    model.upsert({
      accident_id: 2, source: 'ntsb', source_event_id: 'b',
      source_url: 'http://x', slug: 'lo',
      narrative_text: null, probable_cause: null, factors_json: null,
      phase_of_flight: null, weather_summary: null,
      fetched_at: NOW, ingested_at: NOW, updated_at: NOW,
    });
    const out = enumerateAccidents();
    expect(out).toHaveLength(1);
    expect(out[0].loc).toBe('https://himaxym.com/accidents/hi');
    expect(out[0].changefreq).toBe('monthly');
    expect(out[0].priority).toBe('0.6');
  });

  it('empty DB → empty array', () => {
    db.exec(`DELETE FROM accident_narratives`);
    expect(enumerateAccidents()).toEqual([]);
  });
});
