'use strict';
const { db } = require('./db');
const { computeQualityScore, INDEXABLE_THRESHOLD } = require('../utils/accidentQualityScore');

const stmts = {
  upsert: db.prepare(`
    INSERT INTO accident_narratives
      (accident_id, source, source_event_id, source_url, slug,
       narrative_text, probable_cause, factors_json, phase_of_flight,
       weather_summary, fetched_at, quality_score, indexable,
       ingested_at, updated_at)
    VALUES
      (@accident_id, @source, @source_event_id, @source_url, @slug,
       @narrative_text, @probable_cause, @factors_json, @phase_of_flight,
       @weather_summary, @fetched_at, @quality_score, @indexable,
       @ingested_at, @updated_at)
    ON CONFLICT(accident_id) DO UPDATE SET
      source           = excluded.source,
      source_event_id  = excluded.source_event_id,
      source_url       = excluded.source_url,
      slug             = excluded.slug,
      narrative_text   = excluded.narrative_text,
      probable_cause   = excluded.probable_cause,
      factors_json     = excluded.factors_json,
      phase_of_flight  = excluded.phase_of_flight,
      weather_summary  = excluded.weather_summary,
      fetched_at       = excluded.fetched_at,
      quality_score    = excluded.quality_score,
      indexable        = excluded.indexable,
      updated_at       = excluded.updated_at
  `),
  getBySlug: db.prepare(`SELECT * FROM accident_narratives WHERE slug = ?`),
  getById:   db.prepare(`SELECT * FROM accident_narratives WHERE accident_id = ?`),
  listIndexable: db.prepare(`
    SELECT * FROM accident_narratives
    WHERE indexable = 1
    ORDER BY updated_at DESC
    LIMIT @limit OFFSET @offset
  `),
  slugTaken: db.prepare(`
    SELECT 1 FROM accident_narratives WHERE slug = ? AND accident_id != ? LIMIT 1
  `),
  statsByScore: db.prepare(`
    SELECT
      SUM(CASE WHEN quality_score BETWEEN 0  AND 29  THEN 1 ELSE 0 END) AS r0,
      SUM(CASE WHEN quality_score BETWEEN 30 AND 49  THEN 1 ELSE 0 END) AS r30,
      SUM(CASE WHEN quality_score BETWEEN 50 AND 69  THEN 1 ELSE 0 END) AS r50,
      SUM(CASE WHEN quality_score BETWEEN 70 AND 89  THEN 1 ELSE 0 END) AS r70,
      SUM(CASE WHEN quality_score BETWEEN 90 AND 100 THEN 1 ELSE 0 END) AS r90,
      COUNT(*) AS total,
      SUM(CASE WHEN indexable = 1 THEN 1 ELSE 0 END) AS indexable_count,
      SUM(CASE WHEN source = 'ntsb' THEN 1 ELSE 0 END) AS by_ntsb,
      SUM(CASE WHEN source = 'wikidata' THEN 1 ELSE 0 END) AS by_wikidata
    FROM accident_narratives
  `),
};

function upsert(row) {
  const qs = computeQualityScore(row);
  stmts.upsert.run({
    ...row,
    quality_score: qs,
    indexable: qs >= INDEXABLE_THRESHOLD ? 1 : 0,
  });
}

function getBySlug(slug)   { return stmts.getBySlug.get(slug); }
function getById(id)       { return stmts.getById.get(id); }
function listIndexable({ limit = 500, offset = 0 } = {}) {
  return stmts.listIndexable.all({ limit, offset });
}
function slugTaken(slug, accidentId) {
  return !!stmts.slugTaken.get(slug, accidentId);
}
function finalSlug(candidate, accidentId) {
  if (!slugTaken(candidate, accidentId)) return candidate;
  for (let n = 2; n < 1000; n++) {
    const trimmed = candidate.slice(0, 78 - String(n).length);
    const attempt = `${trimmed}-${n}`;
    if (!slugTaken(attempt, accidentId)) return attempt;
  }
  throw new Error(`Slug dedup exhausted for ${candidate}`);
}
function statsByScore() {
  const r = stmts.statsByScore.get();
  return {
    '0-29': r.r0 || 0, '30-49': r.r30 || 0, '50-69': r.r50 || 0,
    '70-89': r.r70 || 0, '90-100': r.r90 || 0,
    total: r.total || 0, indexable: r.indexable_count || 0,
    by_source: { ntsb: r.by_ntsb || 0, wikidata: r.by_wikidata || 0 },
  };
}

module.exports = { upsert, getBySlug, getById, listIndexable, slugTaken, finalSlug, statsByScore };
