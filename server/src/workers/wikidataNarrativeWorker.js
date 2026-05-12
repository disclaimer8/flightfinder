'use strict';

const model   = require('../models/accidentNarratives');
const sidecar = require('../services/sidecarAccidentsClient');
const { parseWikidataResponse } = require('../services/wikidataParse');
const { buildAccidentSlugCandidate } = require('../utils/accidentSlug');

const SPARQL_URL = 'https://query.wikidata.org/sparql';

const SPARQL = `
SELECT ?event ?eventLabel ?description ?date ?causeLabel WHERE {
  ?event wdt:P31/wdt:P279* wd:Q744913 .
  OPTIONAL { ?event schema:description ?description FILTER (LANG(?description) = "en") }
  OPTIONAL { ?event wdt:P585 ?date }
  OPTIONAL { ?event wdt:P1196 ?cause }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
LIMIT 5000
`.trim();

async function fetchSparql() {
  const res = await fetch(`${SPARQL_URL}?query=${encodeURIComponent(SPARQL)}`, {
    headers: {
      Accept: 'application/sparql-results+json',
      'User-Agent': 'FlightFinder/1.0 (https://himaxym.com)',
    },
  });
  if (!res.ok) throw new Error(`Wikidata SPARQL ${res.status}`);
  return res.json();
}

async function runIngest() {
  const json = await fetchSparql();
  const records = parseWikidataResponse(json);

  const NOW = Math.floor(Date.now() / 1000);
  let ingested = 0;
  let unmatched = 0;

  for (const rec of records) {
    const accId = sidecar.getAccidentIdBySourceEventId(rec.q_id, 'wikidata');
    if (!accId) { unmatched++; continue; }

    const candidate = buildAccidentSlugCandidate({
      normalized_date: rec.date ? rec.date.slice(0, 10) : 'unknown',
      aircraft_model:  rec.label || '',
      operator:        '',
      location:        '',
    });
    const finalSlug = model.finalSlug(candidate, accId);

    model.upsert({
      accident_id:     accId,
      source:          'wikidata',
      source_event_id: rec.q_id,
      source_url:      `https://www.wikidata.org/wiki/${rec.q_id}`,
      slug:            finalSlug,
      narrative_text:  rec.narrative_text,
      probable_cause:  rec.probable_cause,
      factors_json:    null,
      phase_of_flight: null,
      weather_summary: null,
      fetched_at:      NOW,
      ingested_at:     NOW,
      updated_at:      NOW,
    });
    ingested++;
  }
  return { ingested, unmatched };
}

function start() {
  const intervalMs = 7 * 24 * 3600 * 1000;
  const run = async () => {
    try {
      const r = await runIngest();
      console.log(`[wikidataNarrativeWorker] ingested=${r.ingested} unmatched=${r.unmatched}`);
    } catch (e) {
      console.error('[wikidataNarrativeWorker] failed:', e.message);
    }
  };
  setTimeout(run, 90_000);
  setInterval(run, intervalMs);
}

module.exports = { start, runIngest };
