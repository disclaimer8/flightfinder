# Cloudflare proxy setup — manual steps

Backend (nginx + Express) is already prepared to sit behind Cloudflare:

- `nginx/himaxym.conf` includes `/etc/nginx/conf.d/cloudflare-ips.conf`
  for `set_real_ip_from` rewriting.
- `.github/workflows/deploy.yml` refreshes that file on every release
  from https://www.cloudflare.com/ips-v4 and `/ips-v6`, plus appends
  `real_ip_header CF-Connecting-IP` and `real_ip_recursive on`.
- `server/src/index.js` already has `app.set('trust proxy', 1)`, so
  Express reads the rewritten X-Forwarded-For correctly for the
  rate-limiter, Sentry, and CSRF middleware.

Once the four steps below are done, every browser hit terminates HTTP/3
at the CF edge, gets brotli + edge cache for free, and the origin keeps
running its current HTTP/2 + brotli_static stack.

## 1. Add the zone in Cloudflare

1. Sign in (or sign up) at https://dash.cloudflare.com/.
2. Click **Add a site** → enter `himaxym.com` → choose the **Free** plan.
3. Cloudflare scans existing DNS records — review them, keep the
   `A` / `AAAA` for `himaxym.com` and `www.himaxym.com` pointing at the
   Hetzner VPS (`178.104.32.46`). Both should have the **orange cloud
   (proxied)** toggle ON. MX / TXT records stay grey-cloud (DNS-only).
4. Click **Continue** at the bottom.

## 2. Switch nameservers at Namecheap

Cloudflare assigns two NS records like `<word1>.ns.cloudflare.com` and
`<word2>.ns.cloudflare.com`. Take those exactly as shown.

1. Sign in to Namecheap → **Domain List** → **Manage** next to `himaxym.com`.
2. **Nameservers** dropdown → pick **Custom DNS**.
3. Paste the two CF nameservers, save.
4. Wait. Propagation usually completes within 10–60 minutes; CF emails
   when it sees the switch.

## 3. SSL/TLS = Full (Strict)

In the CF dashboard for `himaxym.com`:

1. **SSL/TLS** → **Overview** → set encryption mode to **Full (strict)**.
   The origin already serves a valid Let's Encrypt certificate, so CF
   will accept it.
2. **SSL/TLS** → **Edge Certificates** → confirm **Always Use HTTPS** is on.
3. **HTTP/3 (with QUIC)** → on (default). This is the whole point — CF
   negotiates HTTP/3 with the browser even though origin stays on HTTP/2.
4. **Network** → confirm **0-RTT Connection Resumption** is on.

## 4. Page Rule for the SSE endpoint

Server-sent events break under CF Free's response buffering, so the
realtime aircraft search needs to bypass the proxy logic:

1. **Rules** → **Page Rules** → **Create Page Rule**.
2. URL: `*himaxym.com/api/flights/aircraft-search/stream*`
3. Settings:
   - **Cache Level**: Bypass
   - **Disable Performance**
   - **Disable Apps**
4. Save and Deploy.

(Free tier allows 3 page rules — plenty.)

## Verify

After NS propagation:

```sh
curl -sI --http3 https://himaxym.com/ | head -5
# expect: HTTP/3 200, server: cloudflare, cf-ray: <id>

curl -sI https://himaxym.com/ | grep -iE 'cf-ray|alt-svc|server'
# expect: cf-ray: ..., server: cloudflare
```

Browser-side: open DevTools → Network → reload → filter on protocol
column. Most requests should be `h3`.

## Rollback

If anything misbehaves:

1. CF dashboard → DNS → toggle the orange cloud OFF on
   `himaxym.com` / `www`. Traffic now goes straight to origin (still on
   HTTPS/2 + brotli, exactly like before CF).
2. Or revert NS at Namecheap to the previous values (the change is
   tracked in the registrar UI).
3. Origin nginx config keeps working with or without CF in front — the
   `cloudflare-ips.conf` include is harmless when no CF IPs are
   actually hitting the box.

## Why we needed code changes

| Layer | Change | Why |
|---|---|---|
| nginx | `include /etc/nginx/conf.d/cloudflare-ips.conf;` | Rewrites `$remote_addr` to the real client IP using CF-Connecting-IP. |
| deploy.yml | Auto-fetch `/ips-v4` + `/ips-v6` | CF rotates ranges. Hardcoding would silently rot — fetch on every deploy keeps the trusted set current. |
| Express | `app.set('trust proxy', 1)` (already in place) | Honours nginx's `X-Forwarded-For`, so rate-limiter and Sentry attribute traffic correctly. |

## Future considerations

- **Origin firewall**: once CF proxy is stable, optionally restrict
  port 443 inbound to CF IP ranges only (Hetzner cloud firewall or ufw).
  This hides the origin from direct DDoS attempts. Not done by default
  because misconfiguration would lock us out.
- **Always Use HTTPS Origin Pull (Authenticated)**: pin a CF-issued
  client cert that origin requires. Stops anyone bypassing CF by hitting
  the origin IP directly.
- **HTTP/3 to origin**: CF does h3 to browser regardless of origin
  protocol. If we ever upgrade origin nginx to mainline 1.27 with
  http_v3, CF can also speak h3 origin-side — but the user-perceived
  benefit (h3 to browser) is already done.
