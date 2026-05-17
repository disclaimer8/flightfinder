# server/scripts

One-off and recurring sync scripts. Run directly with `node server/scripts/<name>.js`.

## sync-jonty.js

Mirrors https://github.com/Jonty/airline-route-data into `server/data/jonty.db`.

Run daily on VPS:
```
0 6 * * * cd /root/flightfinder && /usr/bin/node server/scripts/sync-jonty.js >> /root/flightfinder/logs/sync-jonty.log 2>&1
```

ETag-checked so daily cron is cheap when source hasn't refreshed (~weekly).

Database schema: `airports`, `routes`, `route_carriers`, `meta`. Indexed by IATA / country_code / dest_iata.
