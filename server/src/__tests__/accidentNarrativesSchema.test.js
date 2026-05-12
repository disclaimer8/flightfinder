'use strict';
const { db } = require('../models/db');

describe('accident_narratives schema', () => {
  it('table exists with all required columns', () => {
    const cols = db.prepare(`PRAGMA table_info('accident_narratives')`).all();
    const names = cols.map(c => c.name);
    expect(names).toEqual(expect.arrayContaining([
      'accident_id', 'source', 'source_event_id', 'source_url', 'slug',
      'narrative_text', 'probable_cause', 'factors_json', 'phase_of_flight',
      'weather_summary', 'fetched_at', 'quality_score', 'indexable',
      'ingested_at', 'updated_at',
    ]));
  });

  it('accident_id is PRIMARY KEY', () => {
    const cols = db.prepare(`PRAGMA table_info('accident_narratives')`).all();
    const pk = cols.find(c => c.pk === 1);
    expect(pk.name).toBe('accident_id');
  });

  it('slug has UNIQUE index', () => {
    const indexes = db.prepare(`PRAGMA index_list('accident_narratives')`).all();
    const slugIndex = indexes.find(i => i.unique === 1 && i.origin === 'u');
    expect(slugIndex).toBeTruthy();
  });

  it('indexable + source_event composite indexes exist', () => {
    const indexes = db.prepare(`PRAGMA index_list('accident_narratives')`).all().map(i => i.name);
    expect(indexes).toEqual(expect.arrayContaining([
      'idx_an_slug', 'idx_an_indexable', 'idx_an_source_event',
    ]));
  });
});
