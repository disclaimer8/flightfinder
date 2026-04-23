'use strict';
const path = require('path');
const fs   = require('fs');
const { parseMasterCsv } = require('../services/faaRegistryService');
const faaRegistry = require('../models/faaRegistry');

const FIXTURE = fs.readFileSync(
  path.join(__dirname, 'fixtures/faa-master-sample.txt'),
  'utf8'
);

describe('parseMasterCsv', () => {
  test('parses fixture into 20 rows', () => {
    const rows = parseMasterCsv(FIXTURE);
    expect(rows.length).toBe(20);
  });

  test('first row has N-prefixed n_number', () => {
    const rows = parseMasterCsv(FIXTURE);
    const first = rows[0];
    expect(first.n_number).toMatch(/^N/);
    expect(first.updated_at).toBeGreaterThan(0);
  });

  test('year_built is parsed as integer', () => {
    const rows = parseMasterCsv(FIXTURE);
    const row = rows[0];
    expect(typeof row.year_built).toBe('number');
    expect(row.year_built).toBe(2015);
  });

  test('owner_name is extracted', () => {
    const rows = parseMasterCsv(FIXTURE);
    expect(rows[0].owner_name).toBe('AMERICAN AIRLINES INC');
  });

  test('icao24_hex is lowercased when present, null when missing', () => {
    const rows = parseMasterCsv(FIXTURE);
    // Row with hex
    const withHex = rows.find(r => r.icao24_hex !== null);
    expect(withHex).toBeTruthy();
    expect(withHex.icao24_hex).toBe(withHex.icao24_hex.toLowerCase());
    // Row 000JJ has empty hex — should be null
    const noHex = rows.find(r => r.n_number === 'N000JJ');
    expect(noHex).toBeTruthy();
    expect(noHex.icao24_hex).toBeNull();
  });

  test('empty input → empty array', () => {
    expect(parseMasterCsv('').length).toBe(0);
  });

  test('manufacturer+model come from ACFTREF map when provided', () => {
    const acftRefMap = new Map([
      ['0001138', { manufacturer: 'BOEING', model: '737-800' }],
    ]);
    const rows = parseMasterCsv(FIXTURE, acftRefMap);
    // rows[0] uses MFR MDL CODE 0001138
    const boeingRow = rows.find(r => r.n_number === 'N12345');
    expect(boeingRow).toBeTruthy();
    expect(boeingRow.manufacturer).toBe('BOEING');
    expect(boeingRow.model).toBe('737-800');
  });
});

describe('faaRegistry model round-trip', () => {
  beforeAll(() => {
    const rows = parseMasterCsv(FIXTURE);
    faaRegistry.upsertMany(rows);
  });

  test('getByNNumber returns the upserted row', () => {
    const row = faaRegistry.getByNNumber('N12345');
    expect(row).toBeTruthy();
    expect(row.n_number).toBe('N12345');
    expect(row.year_built).toBe(2015);
    expect(row.owner_name).toBe('AMERICAN AIRLINES INC');
  });

  test('getByNNumber without N prefix also works', () => {
    const row = faaRegistry.getByNNumber('12345');
    expect(row).toBeTruthy();
    expect(row.n_number).toBe('N12345');
  });

  test('getByNNumber returns null for unknown tail', () => {
    const row = faaRegistry.getByNNumber('NZZZZZZ');
    expect(row).toBeNull();
  });

  test('size() returns 20 after fixture upsert', () => {
    expect(faaRegistry.size()).toBe(20);
  });

  test('isFresh() returns true after upsert', () => {
    expect(faaRegistry.isFresh()).toBe(true);
  });
});
