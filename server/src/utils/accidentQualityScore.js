'use strict';

const INDEXABLE_THRESHOLD = 50;

function computeQualityScore(row) {
  let score = 0;
  if (row.narrative_text && row.narrative_text.length >= 300) score += 30;
  if (row.probable_cause && row.probable_cause.length >= 100) score += 20;
  if (row.factors_json) {
    try {
      const arr = JSON.parse(row.factors_json);
      if (Array.isArray(arr) && arr.length >= 1) score += 20;
    } catch { /* invalid JSON = no points */ }
  }
  if (row.weather_summary) score += 15;
  if (row.phase_of_flight) score += 15;
  return score;
}

module.exports = { computeQualityScore, INDEXABLE_THRESHOLD };
