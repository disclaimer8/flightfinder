module.exports = {
  apps: [
    {
      name: 'flightfinder',
      script: 'src/index.js',
      cwd: '/root/flightfinder/server',
      // Cluster mode with 2 instances → zero-downtime `pm2 reload`.
      // wait_ready makes PM2 wait for `process.send('ready')` from the app
      // (sent after app.listen) before killing the old worker — guarantees
      // a worker is always serving requests.
      // Background workers (adsbl/delay/fleet/tripAlert/etc.) are guarded
      // by IS_LEADER in index.js so they only run on instance 0; only
      // instance 0 writes to safety/observed_routes/etc. and fires alerts.
      // FR24 cache + content cache warm independently per worker (in-memory),
      // doubling FR24 credit burn — accepted trade-off (~10k/mo, well under
      // Explorer 30k budget).
      exec_mode: 'cluster',
      instances: 2,
      wait_ready: true,
      listen_timeout: 15000,
      kill_timeout: 10000,
      autorestart: true,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
        INDEXNOW_KEY: (() => {
          try {
            return require('fs').readFileSync('/etc/flightfinder/indexnow.key', 'utf8').trim();
          } catch {
            return undefined;
          }
        })(),
      },
    },
    {
      name: 'google-flights-sidecar',
      script: '/root/flightfinder/server/bin/google-flights-server',
      autorestart: true,
      // Bumped 300M → 800M after we caught the sidecar restart-storm
      // (45 restarts/day in prod) that made /api/flights randomly
      // return source:none for short-haul routes. The library buffers
      // big JSON trees from Google in-flight; on a busy concurrent
      // request the heap can spike past 300M briefly, PM2 kills the
      // process mid-handler, and the caller gets EOF / empty body.
      // 800M is well within Hetzner VPS budget and the steady-state
      // resident set is still ~13M, so the cap only fires on real
      // pathological growth.
      max_memory_restart: '800M',
      env: {
        PORT: '5002',
        LOG_LEVEL: 'warn',
      },
    },
    {
      // Read-only sidecar serving the global aviation accidents dataset
      // (5K+ rows from ASN/B3A/Wikidata). Bound to 127.0.0.1:5003; nginx
      // proxies it as /api/safety/global/*. No scrapers run in production
      // — the SQLite file at args[1] is a snapshot updated out-of-band.
      name: 'aircrash-sidecar',
      script: '/root/flightfinder/server/bin/aircrash-sidecar',
      args: '--addr 127.0.0.1:5003 --db /root/flightfinder/data/accidents.db',
      autorestart: true,
      max_memory_restart: '200M',
      env: {
        LOG_LEVEL: 'warn',
      },
    },
  ],
};
