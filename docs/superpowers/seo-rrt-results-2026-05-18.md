# SEO Phase 2 — Validation Evidence (Wave 0+, 2026-05-18)

## A.1 — Rich Results Test for Phase 1 URLs

(Pending — user runs manually in Wave 0)

## A.2 — Sitemap submission

(Pending — user runs manually in Wave 0)

## A.3 — Baseline impressions

(Pending — user runs manually in Wave 0)

## B2 coverage SQL result

(Pending — Task 1.3)

## B7 — Deploy webhook fix

- Handler location: `.github/workflows/deploy.yml` (GitHub Actions, push-on-main → `appleboy/ssh-action` to `origin.himaxym.com` as root). No server-side webhook script; deploy is driven by the workflow itself.
- Gap found: `reload→restart`. Line 327 used `pm2 startOrReload ecosystem.config.js --update-env`. `startOrReload` performs a graceful reload, which keeps the Node `require()` module cache alive across the process swap — so updated modules (e.g. `server/src/services/seoContentBuilders.js`) ship stale until a manual `pm2 restart`. PATH was already fine (workflow sources nvm via `$NVM_DIR/nvm.sh`, putting pm2 on PATH).
- Fix applied: yes — changed `pm2 startOrReload` → `pm2 startOrRestart` in `.github/workflows/deploy.yml` (commit `410ff9a`), with an inline comment explaining why, citing the Phase 1 SEO ship lesson + memory notes. Full process respawn invalidates the require() cache.
- Verified: pushes to `origin/main` now trigger full pm2 restart without manual intervention.
  - **Before fix:** cluster worker ids `9, 10`, uptime `18h`, restart counter `0`.
  - **After fix push (commit `410ff9a`):** worker ids `11, 12`, uptime `13s`, restart counter `0` (new processes, not incremented existing — this is the correct restart-vs-reload signature: reload would have kept ids 9+10 and bumped `↺` to 1; restart deletes+recreates).
  - **After empty-commit verification push (commit `cf57499`):** worker ids `13, 14`, uptime `15s`. Confirms repeatable auto-restart on each push.
  - `curl https://himaxym.com/sitemap.xml` returns valid XML after both deploys (no 502).
- GitHub Actions deploy run times: 25s and 24s for the two pushes (down from previous ~70s, npm cache warm).

## B3 — route_carriers(carrier_iata) index

- sync-jonty.js updated: yes (line 53 — `CREATE INDEX IF NOT EXISTS idx_route_carriers_carrier ON route_carriers(carrier_iata);` added inline in `SCHEMA` block immediately after the `CREATE TABLE route_carriers` statement, matching the existing pattern used for `idx_airports_country` (line 35) and `idx_routes_dest` (line 44)).
- Production immediately applied: yes — `sqlite3 /var/lib/flightfinder/data/jonty.db "CREATE INDEX IF NOT EXISTS idx_route_carriers_carrier ON route_carriers(carrier_iata);"` returned in <1s.
- EXPLAIN QUERY PLAN output:

```
QUERY PLAN
`--SEARCH route_carriers USING INDEX idx_route_carriers_carrier (carrier_iata=?)
```

