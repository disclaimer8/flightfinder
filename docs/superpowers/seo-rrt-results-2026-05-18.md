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

## B3 — route_carriers(carrier_iata, origin_iata) composite index

- sync-jonty.js updated: yes (line 53) — inline in `SCHEMA` template literal, matching style of sibling `idx_airports_country` (line 35) and `idx_routes_dest` (line 44).
- Production rollout: `DROP INDEX idx_route_carriers_carrier; CREATE INDEX idx_route_carriers_carrier ON route_carriers(carrier_iata, origin_iata);` on `/var/lib/flightfinder/data/jonty.db`. Total time **87ms** (atomic for traffic purposes).
- Index name preserved (`idx_route_carriers_carrier`) — column list changed only. Name is intentionally not renamed despite being technically misleading (now composite, name implies single-col); rename would break grep continuity across docs/memory + require coordinated rebuild.
- Choice rationale: composite serves both `WHERE carrier_iata = ?` (via leftmost-prefix) AND `WHERE carrier_iata = ? AND origin_iata = ?` (full match). The latter pattern dominates lazy bakes for /airline/:iata/from/:airport (more URLs than /airline/:iata alone — predicate in `airlineAirportBuilder.js:20`).
- Write cost during sync: accepted — bulk insert inside single transaction; index update cost is low-seconds on ~50K-100K rows; deferred-index pattern rejected (adds failure modes for marginal savings).
- Auto-restart witness for composite-upgrade push (commit `0fd191d`): pm2 worker ids `19, 20` → `21, 22`, uptime ~2m post-deploy, restart counter `0` (correct full-respawn signature). Confirms B7 fix is still functioning under feature pushes.

### EXPLAIN QUERY PLAN — `WHERE carrier_iata = ?`
```
QUERY PLAN
`--SEARCH route_carriers USING INDEX idx_route_carriers_carrier (carrier_iata=?)
```

### EXPLAIN QUERY PLAN — `WHERE carrier_iata = ? AND origin_iata = ?`
```
QUERY PLAN
`--SEARCH route_carriers USING INDEX idx_route_carriers_carrier (carrier_iata=? AND origin_iata=?)
```

