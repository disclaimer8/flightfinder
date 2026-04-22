# Pre-launch smoke checklist (himaxym.com subscription pivot)

Run this before flipping `STRIPE_LIVE=1` on live Stripe keys. With test keys (current state) this is also the regression check after any Stripe-related change.

## Environment variables (prod)

Verified via GitHub → Settings → Secrets → Actions and PM2 env:

- [x] `STRIPE_SECRET_KEY` (sk_test_...)
- [x] `STRIPE_WEBHOOK_SECRET` (whsec_...)
- [x] `STRIPE_PRICE_MONTHLY` / `STRIPE_PRICE_ANNUAL` / `STRIPE_PRICE_LIFETIME` (all `price_...`)
- [x] `STRIPE_LIVE=1` (test keys — safe in this state)
- [x] `PUBLIC_WEB_ORIGIN=https://himaxym.com`
- [x] `ADMIN_TOKEN`
- [x] `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY`
- [ ] `OPENWEATHER_API_KEY` (optional — enables weather in enriched card)
- [ ] `INGEST_ENABLED=1` (optional — flips on delay ingestion for observations)

## Database migrations

- [x] PM2 restart runs idempotent migrations on module load (try/catch ALTERs + CREATE TABLE IF NOT EXISTS)
- [x] `GET /api/subscriptions/lifetime-status` returns `{taken, cap:500, available}`

## End-to-end subscription flow (Stripe test mode)

- [x] Create test account (`disclaimer8@gmail.com`) → `/auth/me` showed `subscription_tier: "free"` pre-purchase
- [x] Visit `/pricing` → 3 cards render, Lifetime shows "N slots left of 500"
- [x] Click Pro Monthly → redirected to Stripe checkout → pay with `4242 4242 4242 4242`
- [x] Redirected to `/subscribe/return?subscribe=success` → "Welcome to Pro" renders
- [x] `/auth/me` now returns `subscription_tier: "pro_monthly"`, `sub_valid_until` set, `has_stripe_customer: true`
- [x] `GET /api/flights/X:YYYY-MM-DD/enriched` as this user returns full 8-key payload
- [ ] Repeat for Pro Annual (optional — same flow)
- [ ] Repeat for Pro Lifetime → `lifetime-status.taken` incremented by 1
- [ ] Cancel subscription via billing portal → webhook updates tier via `subscription.updated`

## Webhook resilience

- [x] Invalid signature → 400
- [x] Valid signature + unknown event type → 200 `{received:true}` (default branch)
- [x] Duplicate event.id → 200 `{received:true, deduped:true}` (idempotency via webhook_events PK)
- [x] Handler throws → 500 AND event marker rolled back via deleteWebhookEvent so retry processes (integration test)

## Lifetime sold-out handling

- [ ] Manually `UPDATE lifetime_counter SET taken = 500` → `/pricing` shows "Sold out" disabled button → checkout POST returns 409 with `code: 'LIFETIME_SOLD_OUT'`
- [ ] Reset `UPDATE lifetime_counter SET taken = 0` after test

## Paywall

- [x] As `free` user, `GET /api/flights/X:YYYY-MM-DD/enriched` → 403 PAYWALL
- [x] As `free` user, `POST /api/trips` → 403 PAYWALL (requireTier)
- [x] Teaser endpoint `/enriched/teaser` returns shape with all-null fields → 200

## Trip ownership

- [x] User A creates trip `T1`
- [x] User B `GET /api/trips/T1` → 404 (integration test)
- [x] User B `DELETE /api/trips/T1` → 404 (integration test)
- [x] User A `GET /api/trips/T1` → 200 (integration test)

## Web-push

- [x] `GET /api/push/public-key` returns real VAPID public key
- [ ] Enable notifications in browser → push endpoint saved (manual UI test)
- [ ] Manually trigger `tripAlertWorker.runCycle()` via dev test route (or wait 15 min) → notification delivered
- [ ] Unsubscribe → endpoint deleted; next cycle does not attempt delivery

## Client bundles

- [x] `npm run build` in `client/` — no errors, no missing imports
- [ ] Lighthouse on `/pricing` — check LCP < 2.5s

## Legal

- [x] `/legal/terms` renders
- [x] `/legal/privacy` renders
- [x] Both linked from Pricing footer
- [ ] Email `support@himaxym.com` reaches a monitored inbox

## Capacitor (native app)

- [x] `isNativeApp()` returns false on web, true on native WebView
- [x] `/pricing` route renders "Manage on the web" notice on native
- [x] "Pricing" nav link hidden on native
- [ ] Build + run native — visually confirm (optional)

## Final flip (when ready for LIVE Stripe)

- [ ] Create live Stripe Products + Prices (same tiers, different IDs)
- [ ] Create live webhook endpoint → copy new `whsec_...`
- [ ] Update GH secrets: `STRIPE_SECRET_KEY=sk_live_...`, `STRIPE_WEBHOOK_SECRET=<new>`, all 3 `STRIPE_PRICE_*` price IDs
- [ ] Confirm `automatic_tax` enabled in Stripe dashboard → Settings → Tax
- [ ] Empty commit + push to trigger deploy
- [ ] Real-card smoke: buy one Monthly subscription, refund via dashboard
