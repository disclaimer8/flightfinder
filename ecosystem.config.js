module.exports = {
  apps: [
    {
      name: 'flightfinder',
      script: 'src/index.js',
      cwd: '/root/flightfinder/server',
      instances: 1,
      autorestart: true,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
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
