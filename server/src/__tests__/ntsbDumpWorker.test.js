'use strict';
const { db } = require('../models/db');
const model  = require('../models/accidentNarratives');

// Mock external dependencies BEFORE requiring the worker.
jest.mock('node:child_process', () => ({
  execFileSync: jest.fn(),
}));
jest.mock('node:fs', () => {
  const real = jest.requireActual('node:fs');
  return {
    ...real,
    mkdtempSync: jest.fn(() => '/tmp/ntsb-mock'),
    readFileSync: jest.fn(),
    rmSync: jest.fn(),
    writeFileSync: jest.fn(),
    existsSync: jest.fn(() => true),
    openSync: real.openSync,
  };
});
jest.mock('../services/sidecarAccidentsClient', () => ({
  getAccidentIdBySourceEventId: jest.fn(),
}));

const fs = require('node:fs');
const sidecar = require('../services/sidecarAccidentsClient');
const worker  = require('../workers/ntsbDumpWorker');

beforeEach(() => {
  db.exec(`DELETE FROM accident_narratives`);
  jest.clearAllMocks();
});

describe('ntsbDumpWorker.runIngest (offline path)', () => {
  it('parses MDB CSVs and upserts narratives for matched sidecar accidents', async () => {
    fs.readFileSync.mockImplementation((p) => {
      const name = String(p).split('/').pop();
      if (name === 'events.csv') return 'ev_id,ev_date,ev_city\nE1,2026-04-25,Minneapolis\n';
      if (name === 'narratives.csv') return 'ev_id,narr_accp,narr_cause\nE1,' +
        '"' + 'x'.repeat(400) + '","' + 'y'.repeat(150) + '"\n';
      if (name === 'findings.csv') return 'ev_id,finding_description,modifier_code\nE1,Loss of power,C\n';
      if (name === 'occurrence.csv') return 'ev_id,occurrence_code,phase_no\nE1,CRZ,550\n';
      if (name === 'weather.csv') return 'ev_id,wx_cond_basic,wind_vel_kts,wind_dir_deg,vis_sm\nE1,VMC,9,270,10\n';
      if (name === 'aircraft.csv') return 'ev_id,acft_make,acft_model,regis_no\nE1,BEECH,F33A,N12345\n';
      return '';
    });
    sidecar.getAccidentIdBySourceEventId.mockReturnValue(5564);

    const result = await worker.runIngest({ skipDownload: true, mdbPath: '/tmp/mock.mdb' });

    expect(result.ingested).toBe(1);
    expect(result.unmatched).toBe(0);
    const row = model.getById(5564);
    expect(row.narrative_text.length).toBeGreaterThan(300);
    expect(row.quality_score).toBeGreaterThanOrEqual(50);
    expect(row.indexable).toBe(1);
  });

  it('counts unmatched events when sidecar has no record for ev_id', async () => {
    fs.readFileSync.mockImplementation((p) => {
      const name = String(p).split('/').pop();
      if (name === 'events.csv') return 'ev_id,ev_date\nE1,2026-04-25\n';
      if (name === 'narratives.csv') return 'ev_id,narr_accp,narr_cause\nE1,N,C\n';
      return 'ev_id\n';
    });
    sidecar.getAccidentIdBySourceEventId.mockReturnValue(null);
    const result = await worker.runIngest({ skipDownload: true, mdbPath: '/tmp/mock.mdb' });
    expect(result.ingested).toBe(0);
    expect(result.unmatched).toBe(1);
  });

  it('idempotent: empty input → 0 ingested', async () => {
    fs.readFileSync.mockImplementation(() => 'ev_id\n');
    const r = await worker.runIngest({ skipDownload: true, mdbPath: '/tmp/mock.mdb' });
    expect(r.ingested).toBe(0);
  });

  it('handles multi-line quoted narrative (real NTSB shape)', async () => {
    const multilineNarr = 'On approach the crew noticed engine roughness.\n' +
                          'The aircraft was operating at FL280 when the event began.\n' +
                          'See FAA report for further investigation details.';
    fs.readFileSync.mockImplementation((p) => {
      const name = String(p).split('/').pop();
      if (name === 'events.csv') return 'ev_id,ev_date,ev_city\nE1,2026-04-25,X\n';
      if (name === 'narratives.csv') return `ev_id,narr_accp,narr_cause\nE1,"${multilineNarr}","Engine failure due to manufacturing defect that escaped quality control inspection at the factory."\n`;
      return 'ev_id\n';
    });
    sidecar.getAccidentIdBySourceEventId.mockReturnValue(7777);
    const r = await worker.runIngest({ skipDownload: true, mdbPath: '/tmp/mock.mdb' });
    expect(r.ingested).toBe(1);
    const row = model.getById(7777);
    expect(row.narrative_text).toContain('engine roughness');
    expect(row.narrative_text).toContain('FL280');
    expect(row.narrative_text).toContain('FAA report');
  });
});
