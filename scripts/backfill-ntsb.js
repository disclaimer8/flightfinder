#!/usr/bin/env node
'use strict';

// One-time backfill: downloads avall.zip (full NTSB aviation history)
// and ingests narratives for every sidecar accident that matches.
//
// Usage: NODE_ENV=production node scripts/backfill-ntsb.js
//   or:  npm run backfill-ntsb (after wiring into package.json)

process.env.NODE_ENV = process.env.NODE_ENV || 'production';

(async () => {
  const worker = require('../server/src/workers/ntsbDumpWorker');
  console.log('[backfill] starting full NTSB ingest from avall.zip…');
  const start = Date.now();
  try {
    const r = await worker.runIngest({});
    const elapsedSec = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`[backfill] DONE in ${elapsedSec}s — ingested=${r.ingested} unmatched=${r.unmatched}`);
    process.exit(0);
  } catch (err) {
    console.error('[backfill] FAILED:', err.message, err.stack);
    process.exit(1);
  }
})();
