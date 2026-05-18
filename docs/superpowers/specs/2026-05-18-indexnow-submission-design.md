# IndexNow URL Submission — Design

**Status:** Draft 2026-05-18
**Prerequisites:** SEO Phase 2 shipped (`[[project_flightfinder-seo-phase2]]`), ~3K indexable URLs across home + airport + airline + alliance + country + route + accident + matrix families.

## Goal

Push URL change notifications to IndexNow-supporting search engines (Bing, Yandex, Naver, Seznam) so they re-crawl FlightFinder pages faster than passive sitemap discovery. Ship in two trigger modes:

1. **Deploy mode** — every push to main triggers an immediate submit of the full enumerated URL set after pm2 restart succeeds
2. **Full mode** — daily cron at 03:00 UTC submits the same URL set as scheduled re-validation

## Non-goals

- Google indexing (Indexing API doesn't support general pages, only Job Postings + Broadcast Events schemas)
- IndexNow batching across multiple submissions per trigger (single POST per trigger, ~3K URLs fits well under 10K-per-POST limit)
- Diff-based URL detection (Approach C from brainstorm) — full submit is simpler, IndexNow dedupes server-side
- Per-engine fan-out (we submit to the shared `api.indexnow.org` endpoint which forwards to all engines)
- Per-URL retry logic (failures logged, next cron picks up — engines also re-index periodically)
- Submission of pages with `noindex` robots meta — exclude before POST

## Approach: full submit on every deploy + daily cron

**Why not subset on deploy:** Curating a "hot URL" list adds judgment-call complexity. 3K URLs is one ~150KB POST — well within all known limits. If Bing's soft daily limit (~10K URLs) is hit, IndexNow returns 429 and we log + continue. Next cron picks up.

**Why not diff-based:** Deriving "which URLs changed" from git diff is fragile (depends on file → URL family mapping). The IndexNow protocol explicitly says "submit anytime, we dedupe." Trust the server.

**Skip guard:** Deploy-mode skips submission if no SEO-affecting paths changed in `HEAD~1..HEAD`. Watches `server/src/services/seo*`, `server/src/services/jonty*`, `server/src/services/*Builder.js`, `server/src/routes/seo.js`, `server/src/data/*.json`, `server/scripts/sync-jonty.js`, `server/src/data/airlines.dat`. Cron mode always runs.

---

## Architecture

```
.github/workflows/deploy.yml
  └── after pm2 restart + healthcheck:
      └── ssh run: node server/scripts/submit-indexnow.js --mode=deploy

Hetzner cron (root crontab)
  └── 0 3 * * * cd /root/flightfinder
                && export INDEXNOW_KEY=$(cat /etc/flightfinder/indexnow.key)
                && /root/.nvm/versions/node/v24.14.0/bin/node server/scripts/submit-indexnow.js --mode=full
                >> /var/log/flightfinder/indexnow.log 2>&1

server/scripts/submit-indexnow.js
  ├── reads INDEXNOW_KEY from env
  ├── enumerates URLs via seoUrlEnumerator + sitemap route (single source of truth)
  ├── filters out noindex/dev/test URLs
  ├── POSTs to https://api.indexnow.org/indexnow
  └── exit 0 on success or recoverable failure; exit 1 only on misconfig

server/src/index.js (registration block)
  └── At app boot, if INDEXNOW_KEY env is valid hex 16-128 chars:
      app.get(`/${KEY}.txt`, ...) serves the key as text/plain.
      Single specific route — no wildcard, no fall-through ambiguity.

ecosystem.config.js
  └── env block reads INDEXNOW_KEY from /etc/flightfinder/indexnow.key on app start
```

**Single key, two surfaces:**
- The script POSTs `{host, key, keyLocation, urlList}` to IndexNow
- The route serves the key.txt file Bing fetches to verify ownership

**Key storage (NOT in git):**
- Hetzner: `/etc/flightfinder/indexnow.key` (chmod 640, owner root, readable by app + cron)
- GH Actions: `INDEXNOW_KEY` secret
- ecosystem.config.js reads the file at pm2 start, injects into process env

---

## Components

### 1. Key generation and provisioning

**Generate once locally:**
```bash
node -e "console.log(require('crypto').randomBytes(16).toString('hex'))"
# Example: a1b2c3d4e5f67890fedcba9876543210
```

**Store:**
- Locally: paste into 1Password / preferred secret manager
- GitHub: Settings → Secrets and variables → Actions → `INDEXNOW_KEY` (new repo secret)
- Hetzner: `ssh hetzner 'mkdir -p /etc/flightfinder && echo "<KEY>" > /etc/flightfinder/indexnow.key && chmod 640 /etc/flightfinder/indexnow.key'`

### 2. Express handler for key validation file

The handler must serve `https://himaxym.com/<KEY>.txt` returning the key, but MUST NOT compete with legitimate routes like `/airline`, `/sitemap.xml`, etc. Mounting a wildcard `/:filename` would intercept everything — wrong.

**Approach:** register a single specific route at app boot based on the env-loaded key. No wildcard, no fall-through ambiguity. In `server/src/index.js`, near other route registrations:

```js
const indexNowKey = process.env.INDEXNOW_KEY;
if (indexNowKey && /^[a-f0-9]{16,128}$/i.test(indexNowKey)) {
  app.get(`/${indexNowKey}.txt`, (_req, res) => {
    res.type('text/plain').send(indexNowKey);
  });
} else if (process.env.NODE_ENV !== 'test') {
  console.warn('[seo] INDEXNOW_KEY missing or malformed — IndexNow validation route not registered');
}
```

Registration is gated by:
- Key presence (env var loaded)
- Format validation (hex 16-128 chars per IndexNow spec)

If either fails, route is not registered → Bing's ownership check 404s → submissions fail at IndexNow side. Visible failure mode. App keeps running for everything else.

Test environment skips the warning so test runs don't pollute output.

### 3. `server/scripts/submit-indexnow.js`

Standalone Node script. CLI args:
- `--mode=deploy` — exit 0 immediately if `git diff HEAD~1 HEAD --name-only` shows no SEO-affecting paths; otherwise submit full set
- `--mode=full` — always submit full set
- `--mode=dry-run` — build URL set, log first 20 + count, exit without POST

Steps:
1. Read `INDEXNOW_KEY` from env; exit 1 if missing (misconfig)
2. Skip-on-no-SEO-change check (deploy mode only)
3. Build URL set:
   - Reuse `seoUrlEnumerator.enumerateSeoUrls()` plus the additional pushes in `server/src/routes/seo.js` (safety events, aircraft-route grid, airline-aircraft matrix, route matrix, accidents, P1 jonty families, alliance, country)
   - Filter out non-indexable URLs (anything resolver-marked `noindex` — use `seoMetaService.resolve()` to check robots)
   - Normalize to absolute URLs (`https://himaxym.com${path}`)
   - Lowercase paths (match sitemap canonical form)
   - Dedupe
4. POST in single batch (or split into 9K chunks if >10K — safety):
   ```js
   const body = {
     host: 'himaxym.com',
     key: process.env.INDEXNOW_KEY,
     keyLocation: `https://himaxym.com/${process.env.INDEXNOW_KEY}.txt`,
     urlList: urls
   };
   const res = await fetch('https://api.indexnow.org/indexnow', {
     method: 'POST',
     headers: { 'Content-Type': 'application/json' },
     body: JSON.stringify(body),
   });
   ```
5. Log result:
   - 200/202 → log `[indexnow] submitted N URLs successfully`
   - 422 (duplicate) → log + exit 0 (recoverable)
   - 429 (rate limit) → log + exit 0 (next cron picks up)
   - 4xx other → log error body + exit 1 (probably misconfig — bad key, bad URL)
   - 5xx → log + exit 0 (transient, retry next time)
6. Exit 0 on success or recoverable failure; 1 only on misconfig

**Output format:**
- stdout: structured log with timestamp + mode + count + status
- Example: `[2026-05-18T16:42:00Z] [indexnow] mode=deploy count=3142 status=200 ok=true`

### 4. ecosystem.config.js update

Inject the key into the app process env at pm2 start so the route handler has access:

```js
module.exports = {
  apps: [{
    name: 'flightfinder',
    // ... existing config ...
    env: {
      // ... existing ...
      INDEXNOW_KEY: require('fs').existsSync('/etc/flightfinder/indexnow.key')
        ? require('fs').readFileSync('/etc/flightfinder/indexnow.key', 'utf8').trim()
        : undefined,
    },
  }],
};
```

If the file is missing, the route silently 404s — Bing's ownership check fails, but the app still runs.

### 5. `.github/workflows/deploy.yml` update

After the existing healthcheck loop succeeds, add:

```yaml
- name: Submit URLs to IndexNow
  uses: appleboy/ssh-action@<version>
  with:
    host: origin.himaxym.com
    username: root
    key: ${{ secrets.SSH_PRIVATE_KEY }}
    envs: INDEXNOW_KEY
    script: |
      export PATH=/root/.nvm/versions/node/v24.14.0/bin:$PATH
      cd /root/flightfinder
      INDEXNOW_KEY="${INDEXNOW_KEY}" node server/scripts/submit-indexnow.js --mode=deploy
  env:
    INDEXNOW_KEY: ${{ secrets.INDEXNOW_KEY }}
```

This runs AFTER pm2 restart succeeds. If the IndexNow submit fails, the workflow does NOT fail (script exits 0 on recoverable failures).

### 6. Hetzner cron

```bash
# Add via ssh hetzner 'crontab -e'
0 3 * * * cd /root/flightfinder && /root/.nvm/versions/node/v24.14.0/bin/node server/scripts/submit-indexnow.js --mode=full >> /var/log/flightfinder/indexnow.log 2>&1
```

The script reads `INDEXNOW_KEY` from env. For cron we need to source `/etc/flightfinder/indexnow.key` — wrap the command:

```bash
0 3 * * * export INDEXNOW_KEY=$(cat /etc/flightfinder/indexnow.key) && cd /root/flightfinder && /root/.nvm/versions/node/v24.14.0/bin/node server/scripts/submit-indexnow.js --mode=full >> /var/log/flightfinder/indexnow.log 2>&1
```

Log rotation: add `/var/log/flightfinder/indexnow.log` to existing logrotate config (or create one with 14-day retention).

---

## Data flow

```
git push origin main
  → GH Actions deploy.yml
      → git fetch + reset + pm2 startOrRestart + healthcheck
      → ssh exec submit-indexnow.js --mode=deploy
          → reads INDEXNOW_KEY env
          → git diff check: SEO files touched? (skip if not)
          → enumerate URLs (same logic as sitemap.xml route)
          → filter noindex
          → POST to api.indexnow.org
          → log result, exit 0
  → bots crawl /<KEY>.txt to verify ownership
  → engines queue re-crawl of submitted URLs

Daily 03:00 UTC
  → cron triggers submit-indexnow.js --mode=full
  → same enumeration + POST flow
  → log
```

---

## Error handling

| Scenario | Script behavior | Workflow behavior |
|---|---|---|
| `INDEXNOW_KEY` env missing | Log error, exit 1 | Deploy fails on this step (visible) |
| Git diff finds no SEO changes (deploy mode) | Log "skip — no SEO files changed", exit 0 | Deploy succeeds |
| URL enumeration throws (DB unavailable, etc) | Log error, exit 1 | Deploy fails |
| IndexNow returns 200/202 | Log success, exit 0 | Deploy succeeds |
| IndexNow returns 422 (duplicate) | Log warning, exit 0 | Deploy succeeds |
| IndexNow returns 429 (rate limit) | Log warning, exit 0 | Deploy succeeds (next cron will retry) |
| IndexNow returns other 4xx | Log error body, exit 1 | Deploy fails (likely misconfig) |
| IndexNow returns 5xx | Log warning, exit 0 | Deploy succeeds (transient) |
| Network timeout (>30s) | Log warning, exit 0 | Deploy succeeds |

The "exit 0 even on most failures" choice is intentional: IndexNow is a best-effort discovery aid, not a critical deploy path. Engines also re-index on their own schedule.

---

## Testing

### Unit tests (`server/src/__tests__/submitIndexNow.test.js`)

Test the URL filtering and batching logic without making real network calls. Mock `fetch` and `enumerator`:

1. **enumerates all URL families and dedupes** — feed a fixture with overlap, assert dedupe
2. **filters noindex URLs** — feed a fixture with a noindex resolver result, assert exclusion
3. **lowercases paths to match sitemap canonical** — assert `/airline/BA` → `/airline/ba`
4. **batches at 9K when set exceeds 10K** — feed fixture with 12K URLs, assert 2 POSTs
5. **exits 0 on 422 response** — mock fetch returning 422, assert exit code 0
6. **exits 0 on 429 response** — mock fetch returning 429, assert exit code 0
7. **exits 1 on 401/403 response** — mock fetch returning 401, assert exit code 1
8. **dry-run mode doesn't call fetch** — assert fetch mock not called

### Integration (post-deploy smoke)

1. After first deploy with feature: check `/var/log/flightfinder/indexnow.log` for success entry
2. Curl `https://himaxym.com/<KEY>.txt` returns the key plaintext (200)
3. Curl `https://himaxym.com/random-other-file.txt` returns 404 (route doesn't false-positive)
4. Manually trigger `--mode=dry-run` and inspect URL count vs sitemap.xml URL count (should match within ~10)

### IndexNow validation

After first real submission, check Bing Webmaster Tools (one-time setup of the property in BWT shows IndexNow submissions in the dashboard) — confirms URLs are received.

---

## Risks

| Risk | Mitigation |
|---|---|
| Key leak via Express route 404 fingerprinting | Route returns 404 (next()) for non-matching filenames — identical to any unmatched route. No fingerprint. |
| Key leak via Bing's keyLocation fetch logged elsewhere | Bing's bot is identified; the URL is fetched once during verification. Not a meaningful leak channel. |
| Spam submissions by attacker with leaked key | IndexNow dedupes server-side; impact is engines re-crawl URLs we already control. Low impact unless attacker submits non-existent URLs (engines see 404 and de-rank). Rotate key if leak detected. |
| 3K URLs exceeds 10K daily soft limit after ~3 same-day deploys | Script exits 0 on 429; next cron at 03:00 UTC retries. No data loss. |
| Cron runs before pm2 restart finishes after manual restart | Cron is independent of pm2 state; script doesn't need the app running, just DB access. Hetzner DBs are local files; pm2 doesn't gate them. |
| ecosystem.config.js fails to find key file at pm2 start | Falls back to undefined; route 404s; submit script also fails-loud. Deploy step catches this via exit 1. |
| Future URL family added without updating script | Script reuses `enumerateSeoUrls()` + the sitemap.xml route's other pushes. Single source of truth — adding to sitemap auto-adds to IndexNow. Document this contract in the script comment. |

---

## Open questions

1. **Skip-guard SEO-files list** — current list watches services + routes + data + scripts. Should it also watch `client/public/sitemap.xml` (if it ever becomes static)? No — sitemap is dynamic via Express route, no static file to watch. Skip-guard list locked.
2. **Rate limit visibility** — should we surface 429 counts to a dashboard? Defer — log + occasional grep is enough at FF scale.
3. **Should we also ping Yandex's separate endpoint?** No. `api.indexnow.org` forwards to all member engines (Bing, Yandex, Naver, Seznam, IndexNow.org). Single endpoint is correct.

---

## Success criteria

- After deploy, IndexNow log line shows `submitted N URLs status=200` (or 422/429 recoverable)
- `https://himaxym.com/<KEY>.txt` returns 200 with key body
- After 7 days of operation: Bing Webmaster Tools dashboard shows IndexNow submissions
- After 14 days: Search Console for non-Bing engines also shows uptick in re-crawl rate (indirect signal — Yandex/Bing rebroadcast via discovery)
- No deploy failures due to IndexNow step (exit 0 on recoverable failures)
- Cron log shows daily successful submission for >7 consecutive days
