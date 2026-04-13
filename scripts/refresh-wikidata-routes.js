#!/usr/bin/env node
'use strict';

/**
 * Fetches airline routes from Wikidata SPARQL and writes
 * server/src/data/wikidata-routes.json  (format: { IATA: [IATA, ...] })
 *
 * Run manually:  node scripts/refresh-wikidata-routes.js
 * Runs weekly:   .github/workflows/wikidata-routes-refresh.yml
 */

const https = require('https');
const fs    = require('fs');
const path  = require('path');

const OUT_FILE = path.join(__dirname, '../server/src/data/wikidata-routes.json');

// SPARQL: all flight route items (Q1248784 = airline route) with IATA codes on both endpoints.
// P197 = adjacent station (both departure and arrival airports are adjacent stations of a route).
// P238 = IATA airport code.
const QUERY = `
SELECT DISTINCT ?srcIATA ?dstIATA WHERE {
  ?route wdt:P31 wd:Q1248784 ;
         wdt:P197 ?src ;
         wdt:P197 ?dst .
  ?src wdt:P238 ?srcIATA .
  ?dst wdt:P238 ?dstIATA .
  FILTER(?src != ?dst)
}
`.trim();

function sparqlFetch(query) {
  return new Promise((resolve, reject) => {
    const url = 'https://query.wikidata.org/sparql?query=' + encodeURIComponent(query) + '&format=json';
    const options = { headers: { 'User-Agent': 'FlightFinderRouteRefresh/1.0 (https://github.com/disclaimer8/flightfinder)' } };
    https.get(url, options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`SPARQL HTTP ${res.statusCode}: ${body.slice(0, 200)}`));
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

async function main() {
  console.log('[wikidata-refresh] Querying Wikidata SPARQL...');
  const json = await sparqlFetch(QUERY);
  const bindings = json?.results?.bindings ?? [];
  console.log(`[wikidata-refresh] Got ${bindings.length} route bindings`);

  const routes = {};
  for (const row of bindings) {
    const src = row.srcIATA?.value?.toUpperCase();
    const dst = row.dstIATA?.value?.toUpperCase();
    if (!src || src.length !== 3 || !dst || dst.length !== 3) continue;
    if (!routes[src]) routes[src] = [];
    if (!routes[src].includes(dst)) routes[src].push(dst);
  }

  const airportCount = Object.keys(routes).length;
  const routeCount   = Object.values(routes).reduce((s, a) => s + a.length, 0);
  console.log(`[wikidata-refresh] ${airportCount} origin airports, ${routeCount} total routes`);

  fs.writeFileSync(OUT_FILE, JSON.stringify(routes, null, 2));
  console.log(`[wikidata-refresh] Written to ${OUT_FILE}`);
}

main().catch(err => {
  console.error('[wikidata-refresh] FAILED:', err.message);
  process.exit(1);
});
