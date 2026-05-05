'use strict';

const ntsb   = require('../services/safety/ntsbAdapter');
const safety = require('../models/safetyEvents');

const INITIAL_DELAY_MS  = 5 * 60 * 1000;         // 5 min after boot
const CYCLE_INTERVAL_MS = 24 * 60 * 60 * 1000;   // daily
const PAGE_SIZE         = 50;
const MAX_PAGES         = 20;                     // 1000 records/cycle ceiling

async function runCycle() {
  const sinceDays = Number(process.env.SAFETY_INGEST_DAYS || 30);
  let totalIn = 0, totalUpserted = 0, totalEnriched = 0;

  ntsb.resetDetailCircuitBreaker();

  for (let page = 0; page < MAX_PAGES; page++) {
    let pageOut;
    try {
      pageOut = await ntsb.fetchPage({ sinceDays, page, pageSize: PAGE_SIZE });
    } catch (err) {
      console.warn(`[safetyIngest] page=${page} fetch failed: ${err.message}`);
      return;
    }
    if (!pageOut.rows.length) break;
    totalIn += pageOut.rows.length;

    const observedAt = Date.now();
    const mapped = pageOut.rows.map(r => ntsb.mapToSafetyEvent(r, observedAt));
    const valid  = mapped.filter(Boolean);

    // Per-event detail-view enrichment (no-op when SAFETY_DETAIL_ENRICHMENT_ENABLED != '1')
    const enriched = [];
    for (const event of valid) {
      const beforeOperator = event.operator_iata;
      const result = await ntsb.enrichWithDetail(event);
      if (result.operator_iata && !beforeOperator) totalEnriched += 1;
      enriched.push(result);
    }

    totalUpserted += safety.upsertMany(enriched);

    if (!pageOut.hasMore) break;
  }
  console.log(`[safetyIngest] cycle done in=${totalIn} upserted=${totalUpserted} enriched=${totalEnriched}`);
}

exports.startSafetyIngestionWorker = () => {
  if (process.env.SAFETY_INGEST_ENABLED !== '1') {
    console.log('[safetyIngest] disabled (SAFETY_INGEST_ENABLED != 1)');
    return () => {};
  }

  let intervalTimer = null;
  const initialTimer = setTimeout(() => {
    runCycle().catch(err => console.warn('[safetyIngest] initial cycle failed:', err.message));
    intervalTimer = setInterval(() => {
      runCycle().catch(err => console.warn('[safetyIngest] cycle failed:', err.message));
    }, CYCLE_INTERVAL_MS);
  }, INITIAL_DELAY_MS);

  console.log(`[safetyIngest] scheduled (NTSB CAROL): first pull in ${INITIAL_DELAY_MS/1000}s, then every ${CYCLE_INTERVAL_MS/3600000}h`);
  return function stop() {
    clearTimeout(initialTimer);
    if (intervalTimer) clearInterval(intervalTimer);
  };
};

exports._runCycleForTest = runCycle;
