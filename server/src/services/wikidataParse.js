'use strict';

function extractQId(uri) {
  if (!uri || typeof uri !== 'string') return null;
  const m = uri.match(/Q\d+$/);
  return m ? m[0] : null;
}

function val(binding, key) {
  if (!binding[key]) return null;
  const v = binding[key].value;
  return (v && v.trim()) ? v : null;
}

function parseWikidataResponse(json) {
  const bindings = json?.results?.bindings || [];
  const out = [];
  for (const b of bindings) {
    const q_id = extractQId(b.event?.value);
    if (!q_id) continue;
    out.push({
      q_id,
      label:           val(b, 'eventLabel'),
      narrative_text:  val(b, 'description'),
      probable_cause:  val(b, 'causeLabel'),
      date:            val(b, 'date'),
    });
  }
  return out;
}

module.exports = { extractQId, parseWikidataResponse };
