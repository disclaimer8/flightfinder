'use strict';
const { db } = require('../models/db');
const model = require('../models/accidentNarratives');

beforeEach(() => {
  db.exec(`DELETE FROM accident_narratives`);
});

const NOW = 1715500000;

describe('accidentNarratives model', () => {
  it('upsert inserts row + computes quality_score + indexable', () => {
    model.upsert({
      accident_id: 5564,
      source: 'ntsb',
      source_event_id: '20260425202884',
      source_url: 'https://carol.ntsb.gov/event/20260425202884',
      slug: '2024-10-15-fokker-50-rudufu-air-nairobi',
      narrative_text: 'x'.repeat(400),
      probable_cause: 'y'.repeat(150),
      factors_json: '["Loss of power"]',
      phase_of_flight: 'TAKEOFF',
      weather_summary: 'VMC wind 270/09',
      fetched_at: NOW,
      ingested_at: NOW,
      updated_at: NOW,
    });
    const row = model.getBySlug('2024-10-15-fokker-50-rudufu-air-nairobi');
    expect(row.accident_id).toBe(5564);
    expect(row.quality_score).toBe(100);
    expect(row.indexable).toBe(1);
  });

  it('upsert updates existing row + recomputes quality_score', () => {
    const base = {
      accident_id: 1, source: 'ntsb', source_event_id: 'e1',
      source_url: 'http://x/1', slug: 'aaa-1', narrative_text: null,
      probable_cause: null, factors_json: null, phase_of_flight: null,
      weather_summary: null, fetched_at: NOW, ingested_at: NOW, updated_at: NOW,
    };
    model.upsert(base);
    expect(model.getBySlug('aaa-1').quality_score).toBe(0);
    model.upsert({ ...base, narrative_text: 'x'.repeat(400), updated_at: NOW + 1 });
    const row = model.getBySlug('aaa-1');
    expect(row.quality_score).toBe(30);
    expect(row.updated_at).toBe(NOW + 1);
  });

  it('getById returns row by accident_id', () => {
    model.upsert({
      accident_id: 42, source: 'wikidata', source_event_id: 'Q123',
      source_url: 'http://x/2', slug: 'bbb-42', narrative_text: 'short',
      probable_cause: null, factors_json: null, phase_of_flight: null,
      weather_summary: null, fetched_at: NOW, ingested_at: NOW, updated_at: NOW,
    });
    expect(model.getById(42).slug).toBe('bbb-42');
    expect(model.getById(999)).toBeUndefined();
  });

  it('listIndexable returns only indexable=1 rows', () => {
    model.upsert({
      accident_id: 1, source: 'ntsb', source_event_id: 'a',
      source_url: 'http://x/1', slug: 'lo',
      narrative_text: null, probable_cause: null, factors_json: null,
      phase_of_flight: null, weather_summary: null,
      fetched_at: NOW, ingested_at: NOW, updated_at: NOW,
    });
    model.upsert({
      accident_id: 2, source: 'ntsb', source_event_id: 'b',
      source_url: 'http://x/2', slug: 'hi',
      narrative_text: 'x'.repeat(400), probable_cause: 'y'.repeat(150),
      factors_json: '["a"]', phase_of_flight: 'CRUISE', weather_summary: 'VMC',
      fetched_at: NOW, ingested_at: NOW, updated_at: NOW,
    });
    const list = model.listIndexable({ limit: 50 });
    expect(list).toHaveLength(1);
    expect(list[0].slug).toBe('hi');
  });

  it('slugTaken returns true for slug bound to different accident_id', () => {
    model.upsert({
      accident_id: 1, source: 'ntsb', source_event_id: 'x',
      source_url: 'http://x', slug: 'shared',
      narrative_text: null, probable_cause: null, factors_json: null,
      phase_of_flight: null, weather_summary: null,
      fetched_at: NOW, ingested_at: NOW, updated_at: NOW,
    });
    expect(model.slugTaken('shared', 1)).toBe(false);
    expect(model.slugTaken('shared', 2)).toBe(true);
    expect(model.slugTaken('unused', 999)).toBe(false);
  });

  it('finalSlug appends -2 -3 when collision', () => {
    model.upsert({
      accident_id: 1, source: 'ntsb', source_event_id: 'a',
      source_url: 'http://x', slug: 'collide',
      narrative_text: null, probable_cause: null, factors_json: null,
      phase_of_flight: null, weather_summary: null,
      fetched_at: NOW, ingested_at: NOW, updated_at: NOW,
    });
    expect(model.finalSlug('collide', 2)).toBe('collide-2');
    model.upsert({
      accident_id: 2, source: 'ntsb', source_event_id: 'b',
      source_url: 'http://x', slug: 'collide-2',
      narrative_text: null, probable_cause: null, factors_json: null,
      phase_of_flight: null, weather_summary: null,
      fetched_at: NOW, ingested_at: NOW, updated_at: NOW,
    });
    expect(model.finalSlug('collide', 3)).toBe('collide-3');
  });

  it('statsByScore returns score distribution', () => {
    for (let i = 0; i < 3; i++) {
      model.upsert({
        accident_id: i + 10, source: 'ntsb', source_event_id: `e${i}`,
        source_url: 'http://x', slug: `lo-${i}`,
        narrative_text: null, probable_cause: null, factors_json: null,
        phase_of_flight: null, weather_summary: null,
        fetched_at: NOW, ingested_at: NOW, updated_at: NOW,
      });
    }
    model.upsert({
      accident_id: 100, source: 'ntsb', source_event_id: 'big',
      source_url: 'http://x', slug: 'hi-100',
      narrative_text: 'x'.repeat(400), probable_cause: 'y'.repeat(150),
      factors_json: '["a"]', phase_of_flight: 'CRUISE', weather_summary: 'VMC',
      fetched_at: NOW, ingested_at: NOW, updated_at: NOW,
    });
    const dist = model.statsByScore();
    expect(dist['0-29']).toBe(3);
    expect(dist['90-100']).toBe(1);
  });
});
