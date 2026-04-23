'use strict';
const axios   = require('axios');
const AdmZip  = require('adm-zip');
const faaRegistry = require('../models/faaRegistry');

const FAA_URL = 'https://registry.faa.gov/database/ReleasableAircraft.zip';

/**
 * Parse ACFTREF.txt into an in-memory Map.
 * Columns (FAA schema): CODE, MFR, MODEL, TYPE-ACFT, TYPE-ENG, AC-CAT, BUILD-CERT-IND,
 *   NO-ENG, NO-SEATS, AC-WEIGHT, SPEED, TC-DATA-SHEET, TC-DATA-HOLDER
 * Returns Map<CODE, { manufacturer, model }>
 *
 * @param {string} csv  raw text content of ACFTREF.txt
 * @returns {Map<string, {manufacturer: string, model: string}>}
 */
function parseAcftRef(csv) {
  const map = new Map();
  if (!csv) return map;
  const lines = csv.split('\n');
  if (!lines.length) return map;
  const headerLine = lines.shift();
  // Strip comment lines (synthetic fixture has # headers)
  const filteredLines = lines.filter(l => !l.startsWith('#'));
  const header = headerLine.split(',').map(s => s.replace(/^"|"$/g, '').trim());
  const idx = Object.fromEntries(header.map((h, i) => [h, i]));

  for (const line of filteredLines) {
    if (!line.trim()) continue;
    const fields = line.split(',').map(f => f.replace(/^"|"$/g, '').trim());
    const code = fields[idx['CODE']] || fields[0] || '';
    if (!code) continue;
    const mfr   = fields[idx['MFR']]   || fields[1] || '';
    const model = fields[idx['MODEL']] || fields[2] || '';
    if (mfr || model) {
      map.set(code.trim(), { manufacturer: mfr.trim(), model: model.trim() });
    }
  }
  return map;
}

/**
 * Parse MASTER.txt CSV into row objects suitable for faaRegistry.upsertMany().
 * Optionally accepts an ACFTREF map for manufacturer/model enrichment.
 *
 * MASTER.txt format: quoted fixed-width CSV with trailing comma.
 * Key columns: N-NUMBER, MFR MDL CODE, YEAR MFR, NAME, MODE S CODE HEX
 *
 * @param {string} csv          raw text content of MASTER.txt
 * @param {Map}    [acftRefMap] optional Map from parseAcftRef(); fills manufacturer+model
 * @returns {Array<object>}
 */
function parseMasterCsv(csv, acftRefMap = null) {
  const lines = csv.split('\n');
  // Strip leading comment lines (synthetic fixture has # headers)
  while (lines.length && lines[0].startsWith('#')) lines.shift();
  if (!lines.length) return [];
  const headerLine = lines.shift();
  if (!headerLine || !headerLine.trim()) return [];
  const header = headerLine.split(',').map(s => s.replace(/^"|"$/g, '').trim());
  const idx = Object.fromEntries(header.map((h, i) => [h, i]));

  const now = Date.now();
  const rows = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    // FAA CSV: quoted fields with trailing comma. Strip quotes + trim.
    const fields = line.split(',').map(f => f.replace(/^"|"$/g, '').trim());
    const n_raw = fields[idx['N-NUMBER']] || '';
    if (!n_raw) continue;

    const mfrMdlCode = fields[idx['MFR MDL CODE']] || '';
    let manufacturer = null;
    let model = null;
    if (acftRefMap && mfrMdlCode && acftRefMap.has(mfrMdlCode)) {
      const ref = acftRefMap.get(mfrMdlCode);
      manufacturer = ref.manufacturer || null;
      model        = ref.model        || null;
    }

    const hexRaw = fields[idx['MODE S CODE HEX']] || '';
    const icao24_hex = hexRaw ? hexRaw.toLowerCase() : null;

    rows.push({
      n_number:    `N${n_raw}`,
      icao24_hex:  icao24_hex || null,
      manufacturer,
      model,
      year_built:  Number(fields[idx['YEAR MFR']]) || null,
      owner_name:  fields[idx['NAME']] || null,
      updated_at:  now,
    });
  }
  return rows;
}

/**
 * Download + parse the FAA Releasable Aircraft Database and populate faa_registry.
 * Gated by FAA_REGISTRY_BOOTSTRAP=1. Idempotent (skips if table is fresh within 24h).
 *
 * @returns {Promise<{upserted?: number, skipped?: boolean}>}
 */
async function bootstrap() {
  if (process.env.FAA_REGISTRY_BOOTSTRAP !== '1') {
    console.log('[faaRegistry] bootstrap disabled (FAA_REGISTRY_BOOTSTRAP != 1)');
    return { skipped: true };
  }
  if (faaRegistry.isFresh()) {
    console.log('[faaRegistry] already fresh, skipping bootstrap');
    return { skipped: true };
  }
  console.log('[faaRegistry] downloading ReleasableAircraft.zip...');
  const res = await axios.get(FAA_URL, {
    responseType: 'arraybuffer',
    timeout: 120_000,
    headers: { 'User-Agent': 'Mozilla/5.0 (FlightFinder/1.0)' },
  });

  const zip = new AdmZip(Buffer.from(res.data));

  // Parse ACFTREF.txt first to build MFR MDL CODE → manufacturer/model map
  let acftRefMap = null;
  const acftEntry = zip.getEntry('ACFTREF.txt') || zip.getEntry('acftref.txt');
  if (acftEntry) {
    const acftCsv = acftEntry.getData().toString('utf8');
    acftRefMap = parseAcftRef(acftCsv);
    console.log(`[faaRegistry] parsed ${acftRefMap.size} ACFTREF entries`);
  } else {
    console.warn('[faaRegistry] ACFTREF.txt not found in zip — manufacturer/model will be null');
  }

  // Parse MASTER.txt with enrichment from ACFTREF
  const masterEntry = zip.getEntry('MASTER.txt') || zip.getEntry('master.txt');
  if (!masterEntry) throw new Error('MASTER.txt missing from FAA zip');
  const masterCsv = masterEntry.getData().toString('utf8');
  const rows = parseMasterCsv(masterCsv, acftRefMap);
  if (!rows.length) {
    console.warn('[faaRegistry] MASTER.txt yielded 0 parseable rows');
    return { upserted: 0 };
  }

  const n = faaRegistry.upsertMany(rows);
  console.log(`[faaRegistry] bootstrap complete — upserted ${n} rows`);
  return { upserted: n };
}

module.exports = { bootstrap, parseMasterCsv, parseAcftRef };
