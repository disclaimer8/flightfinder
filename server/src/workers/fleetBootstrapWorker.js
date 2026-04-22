'use strict';

const mictronics = require('../services/mictronicsService');
const fleetModel = require('../models/fleet');

async function runBootstrap() {
  if (mictronics.isEnabled()) {
    let n = 0;
    for await (const r of mictronics.fetch()) {
      fleetModel.upsert({
        icao24: r.icao24?.toLowerCase(),
        registration: r.registration || null,
        icao_type: r.icaoType || null,
        operator_iata: r.operatorIata || null,
        build_year: r.buildYear || null,
      });
      n++;
      if (n % 10000 === 0) console.log(`[fleetBootstrap] mictronics ${n} rows…`);
    }
    console.log(`[fleetBootstrap] mictronics done: ${n} rows upserted`);
  } else {
    console.log('[fleetBootstrap] mictronics disabled (no data file)');
  }
}

exports.startFleetBootstrapWorker = () => {
  if (process.env.FLEET_BOOTSTRAP !== '1') {
    console.log('[fleetBootstrap] disabled (FLEET_BOOTSTRAP != 1)');
    return () => {};
  }
  // Run once after 10s, then stop — monthly refresh is triggered by re-setting the env var.
  const t = setTimeout(() => {
    runBootstrap().catch(err => console.warn('[fleetBootstrap] failed:', err.message));
  }, 10 * 1000);
  return function stop() { clearTimeout(t); };
};

exports._runBootstrapForTest = runBootstrap;
