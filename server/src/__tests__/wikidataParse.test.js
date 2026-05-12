'use strict';
const { parseWikidataResponse, extractQId } = require('../services/wikidataParse');

describe('extractQId', () => {
  it('strips wikidata URI prefix', () => {
    expect(extractQId('http://www.wikidata.org/entity/Q3070124')).toBe('Q3070124');
  });
  it('handles plain Q-id', () => {
    expect(extractQId('Q123')).toBe('Q123');
  });
  it('returns null on garbage', () => {
    expect(extractQId('not-a-qid')).toBeNull();
  });
});

describe('parseWikidataResponse', () => {
  const SPARQL_FIXTURE = {
    head: { vars: ['event', 'eventLabel', 'description', 'date', 'causeLabel'] },
    results: { bindings: [
      {
        event:       { type: 'uri', value: 'http://www.wikidata.org/entity/Q3070124' },
        eventLabel:  { 'xml:lang': 'en', type: 'literal', value: 'Polish Air Force Tu-154 crash' },
        description: { 'xml:lang': 'en', type: 'literal', value: 'Aviation accident in Smolensk, Russia, 2010' },
        date:        { type: 'literal', value: '2010-04-10T00:00:00Z' },
        causeLabel:  { 'xml:lang': 'en', type: 'literal', value: 'controlled flight into terrain' },
      },
      {
        event:       { type: 'uri', value: 'http://www.wikidata.org/entity/Q999' },
        eventLabel:  { 'xml:lang': 'en', type: 'literal', value: 'Other event' },
      },
    ]},
  };

  it('extracts q_id and narrative-equivalent text per binding', () => {
    const out = parseWikidataResponse(SPARQL_FIXTURE);
    expect(out).toHaveLength(2);
    expect(out[0].q_id).toBe('Q3070124');
    expect(out[0].narrative_text).toBe('Aviation accident in Smolensk, Russia, 2010');
    expect(out[0].label).toBe('Polish Air Force Tu-154 crash');
    expect(out[0].probable_cause).toBe('controlled flight into terrain');
  });

  it('handles missing optional fields as null', () => {
    const out = parseWikidataResponse(SPARQL_FIXTURE);
    expect(out[1].narrative_text).toBeNull();
    expect(out[1].probable_cause).toBeNull();
  });

  it('skips bindings with missing event URI', () => {
    const out = parseWikidataResponse({
      head: { vars: [] },
      results: { bindings: [{ eventLabel: { value: 'orphan' } }] },
    });
    expect(out).toHaveLength(0);
  });
});
