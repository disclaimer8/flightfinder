module.exports = {
  apps: [
    {
      name: 'flightfinder',
      script: 'src/index.js',
      cwd: './server',
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
  ],
};
