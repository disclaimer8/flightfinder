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
      max_memory_restart: '300M',
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
