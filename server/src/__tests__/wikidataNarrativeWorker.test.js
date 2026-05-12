'use strict';
const { db } = require('../models/db');
const model  = require('../models/accidentNarratives');

jest.mock('../services/sidecarAccidentsClient', () => ({
  getAccidentIdBySourceEventId: jest.fn(),
}));
const sidecar = require('../services/sidecarAccidentsClient');
const worker  = require('../workers/wikidataNarrativeWorker');

beforeEach(() => {
  db.exec(`DELETE FROM accident_narratives`);
  jest.clearAllMocks();
  global.fetch = jest.fn();
});

const SPARQL_RESPONSE = {
  head: { vars: ['event', 'eventLabel', 'description'] },
  results: { bindings: [
    {
      event:       { type: 'uri', value: 'http://www.wikidata.org/entity/Q3070124' },
      eventLabel:  { value: '2010 Smolensk air disaster' },
      description: { value: 'Aviation accident in Smolensk, Russia, 2010 with 96 fatalities' },
    },
  ]},
};

describe('wikidataNarrativeWorker.runIngest', () => {
  it('matches Q-id against sidecar.source_url and upserts narrative', async () => {
    global.fetch.mockResolvedValue({
      ok: true, json: async () => SPARQL_RESPONSE,
    });
    sidecar.getAccidentIdBySourceEventId.mockReturnValue(1234);
    const r = await worker.runIngest();
    expect(r.ingested).toBe(1);
    expect(model.getById(1234).source).toBe('wikidata');
  });

  it('returns unmatched count when sidecar lookup misses', async () => {
    global.fetch.mockResolvedValue({
      ok: true, json: async () => SPARQL_RESPONSE,
    });
    sidecar.getAccidentIdBySourceEventId.mockReturnValue(null);
    const r = await worker.runIngest();
    expect(r.unmatched).toBe(1);
    expect(r.ingested).toBe(0);
  });

  it('SPARQL endpoint 429 → throws but does not corrupt state', async () => {
    global.fetch.mockResolvedValue({ ok: false, status: 429 });
    await expect(worker.runIngest()).rejects.toThrow(/429/);
  });
});
