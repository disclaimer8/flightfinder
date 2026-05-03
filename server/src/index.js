// Sentry must be required first so OpenTelemetry can auto-instrument
// http/express when those modules load below. instrument.js also loads
// .env internally.
require('./instrument');

// Load .env with override so PM2-cached env vars are replaced,
// but preserve NODE_ENV if already set (e.g. NODE_ENV=test in Jest).
const _savedNodeEnv = process.env.NODE_ENV;
require('dotenv').config({ path: require('path').join(__dirname, '../.env'), override: true });
if (_savedNodeEnv) process.env.NODE_ENV = _savedNodeEnv;

const Sentry  = require('@sentry/node');
const express = require('express');
const cors    = require('cors');
const helmet  = require('helmet');
const rateLimit = require('express-rate-limit');
const path    = require('path');

const app  = express();
const PORT = process.env.PORT || 5000;
const IS_DEV = process.env.NODE_ENV !== 'production';
// Bind to loopback in prod so nginx is the only ingress — no direct 5001 hits
// from the internet bypassing rate-limit/headers. Dev stays on 0.0.0.0 so the
// Vite proxy + Capacitor WebView can reach it from another machine/emulator.
const BIND_HOST = process.env.BIND_HOST || (IS_DEV ? '0.0.0.0' : '127.0.0.1');

// Trust nginx reverse proxy (needed for express-rate-limit + X-Forwarded-For)
app.set('trust proxy', 1);

// Hardened query parser — every req.query value is guaranteed to be a string
// (or undefined). The default Node `querystring.parse` returns arrays for
// repeated keys (?x=a&x=b → ['a','b']) and the legacy 'extended' parser also
// allows nested objects (?x[y]=1 → {y:'1'}); both create type-confusion
// vectors when validators do `value.length` / regex.test(value) without a
// typeof guard. CodeQL flagged middleware/validate.js:133 (familyName) for
// exactly this. URLSearchParams returns only string values; we keep the
// first occurrence on duplicates so an attacker can't use `?x=safe&x=evil`
// to route past a string check that ran on the first value.
app.set('query parser', (str) => {
  const out = Object.create(null);
  if (!str) return out;
  for (const [k, v] of new URLSearchParams(str)) {
    if (!(k in out)) out[k] = v;
  }
  return out;
});

// ─────────────────────────────────────────
//  Security headers
// ─────────────────────────────────────────
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'same-site' },
  // HSTS is owned by nginx (with preload flag) — see nginx/himaxym.conf.
  // Helmet's default would emit a duplicate header without `preload`,
  // and double Strict-Transport-Security headers are technically valid
  // but messy and risk one of them being chosen by older middleboxes.
  hsts: false,
  contentSecurityPolicy: {
    directives: {
      defaultSrc:     ["'self'"],
      scriptSrc:      ["'self'", 'https://www.googletagmanager.com'], // gtag only; Travelpayouts Drive widgets removed in subscription pivot
      styleSrc:       ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'], // Leaflet inline style= + TP Drive Google Fonts
      imgSrc:         ["'self'", 'data:', 'https:'], // CartoDB map tiles (loaded as <img> by Leaflet)
      connectSrc:     [
        "'self'",
        'https://www.google-analytics.com', 'https://region1.google-analytics.com', 'https://analytics.google.com', // GA beacons
        // No external Sentry endpoint — client errors POST to our own
        // /api/client-error which forwards to @sentry/node out-of-band.
      ],
      fontSrc:        ["'self'", 'data:', 'https://fonts.gstatic.com'], // TP Drive Google Fonts
      objectSrc:      ["'none'"],
      baseUri:        ["'self'"],
      formAction:     ["'self'"],
      frameAncestors: ["'none'"],               // disallow embedding in iframes
      upgradeInsecureRequests: [],
    },
  },
}));

// ─────────────────────────────────────────
//  CORS — restrict to own origin in prod
// ─────────────────────────────────────────
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : (IS_DEV ? ['http://localhost:3000', 'http://localhost:5173'] : []);

// Native Capacitor WebView origins — iOS uses `capacitor://localhost`,
// Android uses `https://localhost` (Capacitor 7+ default androidScheme).
// Always allowed so the mobile apps reach the API regardless of prod ALLOWED_ORIGINS.
const NATIVE_ORIGINS = new Set(['capacitor://localhost', 'https://localhost']);

app.use(cors({
  origin: (origin, cb) => {
    // allow server-to-server (no origin), native WebViews, and allowed origins
    if (!origin || NATIVE_ORIGINS.has(origin) || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
      return cb(null, true);
    }
    cb(new Error('Not allowed by CORS'));
  },
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// ─────────────────────────────────────────
//  Body parsing
// ─────────────────────────────────────────
// Stripe webhook needs the raw body to verify the signature — must be mounted
// BEFORE express.json() which would consume and JSON-parse the body.
// Rate-limit: Stripe retries a failed event at most a few dozen times over
// ~72h, so 300/min/IP is far above legitimate traffic and well below what an
// attacker would need to DoS the signature-verify path. CodeQL flagged the
// previous unlimited route.
const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many webhook attempts' },
});
app.post(
  '/api/subscriptions/webhook',
  webhookLimiter,
  express.raw({ type: 'application/json' }),
  require('./controllers/subscriptionController').handleWebhook,
);

app.use(express.json({ limit: '16kb' }));
// cookieParser is intentionally NOT mounted globally. Only /api/auth/refresh
// and /api/auth/logout read req.cookies; both attach cookieParser locally
// (see routes/auth.js). Keeping it route-scoped means no other endpoint can
// silently grow a cookie-based code path that bypasses our header-based
// auth — CSRF surface stays minimal by construction.
//
// CSRF defense layers (still in place):
//   1. sameSite: 'strict' on the refresh cookie (browser blocks cross-site submission)
//   2. Access tokens sent via Authorization header (not cookies), not CSRF-vulnerable
//   3. csrfOriginCheck middleware on /refresh and /logout validates Origin/Referer
//      against ALLOWED_ORIGINS — see server/src/middleware/csrf.js
// csurf (deprecated 2023) is intentionally NOT used — unsuitable for JWT REST APIs.

// ─────────────────────────────────────────
//  Rate limiting
// ─────────────────────────────────────────
// Enrichment paths are skipped from the general + search limiters because a
// single FlightResults page may render 30+ cards and each card fires its own
// teaser/enriched request. They get a dedicated higher limit below.
//
// Use `req.originalUrl` rather than `req.path`: when a limiter is mounted at
// `/api` the inner `req.path` is `/flights/.../enriched/teaser` (mount prefix
// stripped), so a regex anchored to `/api/flights` never matches and the skip
// is silently a no-op. originalUrl preserves the full request path.
const isEnrichmentPath = (req) => /\/api\/flights\/[^/]+\/enriched/.test(req.originalUrl || req.url);

// General API limit: 120 req / 15 min per IP
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests, please try again later.' },
  skip: isEnrichmentPath,
});

// Tighter limit for expensive search endpoints (search, explore, calendar).
// Enrichment endpoints are skipped — see enrichLimiter below.
const searchLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Search rate limit exceeded, please wait a moment.' },
  skip: isEnrichmentPath,
});

// Enrichment endpoints are cheap, idempotent, and fan out N-per-page (one
// fetch per FlightCard mounted in the results list). Bump to 300/min so a
// page returning ~30 flights doesn't immediately exhaust the budget.
const enrichLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Enrichment rate limit exceeded.' },
});

app.use('/api', apiLimiter);
app.use('/api/flights', searchLimiter);
app.use('/api/flights', (req, res, next) => {
  if (isEnrichmentPath(req)) return enrichLimiter(req, res, next);
  next();
});

// ─────────────────────────────────────────
//  Routes
// ─────────────────────────────────────────
// Tag every Sentry transaction by high-level feature group so dashboards can
// slice error rate + latency per product area instead of per raw path.
app.use((req, _res, next) => {
  if (!req.path) return next();
  let tag = 'other';
  if (req.path.startsWith('/api/subscriptions')) tag = 'subscriptions';
  else if (req.path.startsWith('/api/trips') || req.path.startsWith('/api/push')) tag = 'trips';
  else if (req.path.match(/^\/api\/flights\/[^/]+\/enriched/)) tag = 'enriched';
  else if (req.path.startsWith('/api/flights')) tag = 'flights';
  else if (req.path.startsWith('/api/map') || req.path.startsWith('/api/aircraft')) tag = 'map';
  else if (req.path.startsWith('/api/safety')) tag = 'safety';
  else if (req.path.startsWith('/api/auth')) tag = 'auth';
  else if (req.path.startsWith('/api/config')) tag = 'config';
  try {
    const scope = Sentry.getCurrentScope?.();
    scope?.setTag?.('route_group', tag);
  } catch { /* noop — Sentry optional */ }
  next();
});

app.use('/api/auth',          require('./routes/auth'));
app.use('/api/flights',       require('./routes/flights'));
app.use('/api/flights',       require('./routes/enrichment'));
app.use('/api/aircraft',      require('./routes/aircraft'));
app.use('/api/map',           require('./routes/map'));
app.use('/api/subscriptions', require('./routes/subscriptions'));
app.use('/api/config',        require('./routes/config'));
app.use('/api/safety',        require('./routes/safety'));
app.use('/api/client-error',  require('./routes/clientError'));
app.use('/api/admin/ingest-status', require('./routes/ingestStatus'));
if (process.env.TRIPS_ENABLED !== '0') {
  app.use('/api/trips',       require('./routes/trips'));
  app.use('/api/push',        require('./routes/push'));
}
app.use('/',                  require('./routes/seo'));            // /sitemap.xml

// ─────────────────────────────────────────
//  Health check
// ─────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', env: process.env.NODE_ENV || 'development' });
});

// ─────────────────────────────────────────
//  Debug endpoints — development only
// ─────────────────────────────────────────
if (IS_DEV) {
  const cacheService   = require('./services/cacheService');
  const amadeusService = require('./services/amadeusService');

  app.get('/api/debug/cache', (_req, res) => res.json(cacheService.stats()));
  app.delete('/api/debug/cache', (_req, res) => {
    cacheService.flush();
    res.json({ ok: true });
  });

  app.get('/api/debug/amadeus', async (req, res) => {
    if (!process.env.AMADEUS_CLIENT_ID || !process.env.AMADEUS_CLIENT_SECRET) {
      return res.status(400).json({ ok: false, message: 'Amadeus credentials not configured' });
    }
    try {
      const raw = await amadeusService.searchFlights({
        departure_airport: 'LIS',
        arrival_airport:   'JFK',
        departure_date: new Date(Date.now() + 86400000).toISOString().split('T')[0],
        passengers: 1,
      });
      res.json({ ok: true, offerCount: raw?.data?.length ?? 0 });
    } catch (err) {
      // Never forward raw API errors outside dev
      res.status(500).json({ ok: false, message: 'Amadeus test failed', hint: err.message });
    }
  });
}

// ─────────────────────────────────────────
//  Serve React build in production
// ─────────────────────────────────────────
if (!IS_DEV) {
  const fs = require('fs');
  const clientBuild = path.join(__dirname, '../../client/dist');
  const spaFallbackLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 120, // limit each IP to 120 requests per window
    standardHeaders: true,
    legacyHeaders: false,
  });
  // Disable static's automatic index.html so that GET '/' falls through to our
  // SPA handler below, which injects a canonical tag and noindex for query-
  // parameter variants (SearchAction URLs like ?from=LHR&to=JFK would otherwise
  // register as duplicate-content URLs in Google's index).
  app.use(express.static(clientBuild, {
    // ETag is enabled (default) so /content/landing/*.json — which doesn't
    // carry a content hash in the filename — gets strong revalidation via
    // 304 responses. Hashed assets in /assets/* stay immutable so they
    // never round-trip; ETag generation cost on first response is trivial.
    index: false,
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('index.html')) {
        res.setHeader('Cache-Control', 'no-cache, must-revalidate');
      } else if (filePath.includes('/content/landing/')) {
        // Path-stable static content. Re-validate hourly so copy edits
        // propagate within an hour, with stale-while-revalidate so users
        // never block on the network when a refresh is needed.
        res.setHeader('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');
      } else {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      }
    },
  }));

  // Cache index.html in memory — deploy rebuilds the file and pm2 restarts the
  // process, so a single read per boot is safe and avoids per-request fs calls.
  const indexHtmlPath = path.join(clientBuild, 'index.html');
  let indexHtmlCached = null;
  const readIndexHtml = () => {
    if (indexHtmlCached == null) indexHtmlCached = fs.readFileSync(indexHtmlPath, 'utf8');
    return indexHtmlCached;
  };

  // Per-route SEO metadata injector — rewrites <title>, <meta description>,
  // canonical, OG/Twitter cards, and the static H1/subtitle fallback so each
  // known URL (/, /by-aircraft, /map, /aircraft/:slug, /routes/:from-:to) is
  // indexable with correct content even without JS rendering.
  const seoMeta = require('./services/seoMetaService');

  const spaFallback = (req, res) => {
    const meta = seoMeta.resolve(req.path);
    let html = seoMeta.inject(readIndexHtml(), meta);
    const q = req.query || {};
    // Query-string variants collapse to the route's canonical — otherwise
    // ?utm=… and SearchAction links would create duplicate-content copies
    // for every landing page.
    if (Object.keys(q).length > 0) {
      // HTML-escape the canonical URL even though meta.canonical is derived
      // from a whitelist (known slugs / validated IATA pairs) and cannot
      // currently carry user input — static analyzers (CodeQL js/reflected-xss)
      // follow req.path all the way here and can't prove the runtime
      // whitelist, and this defends against any future kind/resolver that
      // forgets to sanitize.
      html = html.replace(
        /<link rel="canonical" href="[^"]*"\s*\/?>/i,
        `<link rel="canonical" href="${seoMeta.esc(meta.canonical)}" />`
      );
    }
    // Email verification link (/ ?action=verify&token=…) should never be indexed.
    if (q.action === 'verify') {
      html = html.replace(
        /<meta name="robots" content="[^"]*"\s*\/?>/i,
        '<meta name="robots" content="noindex, nofollow" />'
      );
    }
    res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    // Vary: User-Agent — Slack/Discord/Twitter/LinkedIn OG bots fetch the
    // same URL multiple times and choke on missing Vary, occasionally
    // serving stale OG previews. Cheap defensive header.
    res.setHeader('Vary', 'User-Agent');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    // Return a real 404 for unknown /aircraft/:slug and /routes/:pair URLs
    // so crawlers stop wasting budget on typos and bot-fuzz. The HTML body
    // still ships the React app so a human visitor sees the in-app
    // "not found" screen instead of a raw error.
    const status = meta.kind === 'not-found' ? 404 : 200;
    res.status(status).send(html);
  };

  app.get('/',      spaFallbackLimiter, spaFallback);
  app.get('*path',  spaFallbackLimiter, spaFallback);
}

// ─────────────────────────────────────────
//  Sentry Express error capture — must come BEFORE our handler so Sentry
//  sees the error but AFTER all routes. No-op if DSN isn't set.
// ─────────────────────────────────────────
if (process.env.SENTRY_DSN) {
  Sentry.setupExpressErrorHandler(app);
}

// ─────────────────────────────────────────
//  Global error handler
// ─────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  const status = err.status || 500;
  // Never leak stack traces to client
  const message = IS_DEV ? err.message : 'Internal server error';
  res.status(status).json({ success: false, message });
});

// ─────────────────────────────────────────
//  Start
// ─────────────────────────────────────────
if (require.main === module) {
  app.listen(PORT, BIND_HOST, () => {
    console.log(`Server running on ${BIND_HOST}:${PORT} [${process.env.NODE_ENV || 'development'}]`);
  });

  // Background workers.
  //   adsblol         — observed-routes write-through (opt-in via ADSBLOL_ENABLED=1)
  //   delayIngestion  — AeroDataBox departures → flight_observations (INGEST_ENABLED=1)
  //   fleetBootstrap  — one-shot Mictronics → aircraft_fleet (FLEET_BOOTSTRAP=1)
  const { startAdsbLolWorker }        = require('./workers/adsblolWorker');
  const { startDelayIngestionWorker } = require('./workers/delayIngestionWorker');
  const { startFleetBootstrapWorker } = require('./workers/fleetBootstrapWorker');
  const { startTripAlertWorker }      = require('./workers/tripAlertWorker');
  const { startOurAirportsRefreshWorker }  = require('./workers/ourAirportsRefreshWorker');
  const { startSafetyIngestionWorker }     = require('./workers/safetyIngestionWorker');
  const { startFaaRegistryRefreshWorker }  = require('./workers/faaRegistryRefreshWorker');
  const stopAdsbLolWorker      = startAdsbLolWorker();
  const stopDelayIngest        = startDelayIngestionWorker();
  const stopFleetBootstrap     = startFleetBootstrapWorker();
  const stopTripAlertWorker    = startTripAlertWorker();
  const stopOurAirportsRefresh = startOurAirportsRefreshWorker();
  const stopSafetyIngest       = startSafetyIngestionWorker();
  const stopFaaRegistryRefresh = startFaaRegistryRefreshWorker();

  // Load airline amenities seed on boot (cheap, idempotent).
  try {
    require('./services/amenitiesService').loadSeedIntoDb();
  } catch (err) {
    console.warn('[amenities] seed failed:', err.message);
  }

  // Load OurAirports if its CSV is present (downloaded by ourAirportsRefreshWorker,
  // or shipped via data dir). Then run a one-shot diff audit against OpenFlights.
  try {
    const pth = require('path');
    const loaded = require('./services/ourAirportsService').loadFromCsv(
      pth.resolve(__dirname, '../data/ourairports.csv'),
    );
    if (loaded) {
      console.log(`[ourairports] loaded ${loaded} airports`);
      require('./services/airportValidation').runAudit();
    } else {
      console.log('[ourairports] CSV not present — skipping');
    }
  } catch (err) {
    console.warn('[ourairports] load failed:', err.message);
  }

  const shutdown = () => {
    try { stopAdsbLolWorker();       } catch { /* noop */ }
    try { stopDelayIngest();         } catch { /* noop */ }
    try { stopFleetBootstrap();      } catch { /* noop */ }
    try { stopTripAlertWorker();     } catch { /* noop */ }
    try { stopOurAirportsRefresh();  } catch { /* noop */ }
    try { stopSafetyIngest();        } catch { /* noop */ }
    try { stopFaaRegistryRefresh();  } catch { /* noop */ }
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT',  shutdown);

  // Fire-and-forget: populate local aircraft_db (hex → ICAO type) for AeroDataBox
  // enrichment. First boot downloads ~28MB; subsequent boots are no-ops.
  require('./services/aircraftDbService')
    .bootstrap()
    .catch((err) => console.warn('[aircraftdb] bootstrap failed:', err.message));

  // Fire-and-forget: populate faa_registry (N-number → MFR/MODEL) for NTSB safety
  // event enrichment. Gated by FAA_REGISTRY_BOOTSTRAP=1. ~30-40MB download, ~300k rows.
  require('./services/faaRegistryService')
    .bootstrap()
    .catch((err) => console.warn('[faaRegistry] bootstrap failed:', err.message));
}

module.exports = app; // export for tests
